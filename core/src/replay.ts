// The time machine's engine: a claim, or a topic, as the brain stated it at a moment. The claim's
// top-level fields are its current state; walking its revisions backwards and restoring each
// `before` rebuilds any earlier one (CLAIMS.md, "Revisions").
import type { Claim, Revision, Section, Stamp, Topic } from "./schema.ts";

/** A moment by wall time (ISO 8601, UTC) or by block height. */
export type Moment = { time: string } | { height: number };

/**
 * A past moment a reader asked for, parsed at the edge by `parseAsOf`: a block height, or a UTC
 * day, which means the end of that day (`time` is its last millisecond). Either one is a Moment.
 */
export type AsOf = { height: number } | { date: string; time: string };

/** Whether `at` comes after `m`: a later height, or a later time. A stamp at the moment is in it. */
export function isAfter(at: Stamp, m: Moment): boolean {
  return "time" in m ? Date.parse(at.time) > Date.parse(m.time) : at.height > m.height;
}

/** The claim as its first `n` revisions left it: later ones undone, each `before` restored. */
export function claimAtRevision<C extends Claim>(claim: C, n: number): C {
  if (n >= claim.revisions.length) return claim;
  let state: C = claim;
  for (let i = claim.revisions.length - 1; i >= n; i--) {
    const before = claim.revisions[i]?.before;
    if (before) state = { ...state, ...before } as C;
  }
  const kept = claim.revisions.slice(0, n);
  return { ...state, revisions: kept, run: (kept[kept.length - 1] as Revision).run };
}

/**
 * The claim as it stood at `m`, or null when it did not exist yet. Revisions are in time order (the
 * validator refuses any other), so the ones in force at `m` are a prefix of the log.
 */
export function claimAsOf<C extends Claim>(claim: C, m: Moment): C | null {
  const n = claim.revisions.filter((r) => !isAfter(r.at, m)).length;
  return n === 0 ? null : claimAtRevision(claim, n);
}

/** One revision as a change event, for the Pulse and the changelogs. */
export interface ChangeEvent {
  claim: string;
  topics: string[];
  rev: number;
  change: Revision["change"];
  at: Revision["at"];
  run: string;
  note?: string;
  statement: string;
  before?: Revision["before"];
}

export function changeEvents(claim: Claim): ChangeEvent[] {
  return claim.revisions.map((r, i) => {
    const state = claimAtRevision(claim, i + 1);
    return {
      claim: claim.id,
      topics: state.topics,
      rev: r.rev,
      change: r.change,
      at: r.at,
      run: r.run,
      note: r.note,
      statement: state.statement,
      before: r.before,
    };
  });
}

// Reading a moment. Every surface (the pages, the API, the MCP tools) parses through here, so a
// moment means the same thing everywhere and the same text is refused everywhere.

/** What a valid moment looks like, for error messages. */
export function asOfHelp(latest: Stamp): string {
  return `A moment is a block height in digits, up to ${latest.height}, or a UTC date written YYYY-MM-DD, up to ${latest.time.slice(0, 10)}, which means the end of that day.`;
}

/**
 * A moment from a reader's text, refused when it is not one or when it lies past `latest`, the
 * store's newest stamp (its compiled edition): the store cannot say what it has not seen yet.
 * Refusals never repeat text that was not a height or a date.
 */
export function parseAsOf(text: string, latest: Stamp): { asOf: AsOf } | { error: string } {
  const t = text.trim();
  const help = asOfHelp(latest);
  if (/^\d{1,10}$/.test(t)) {
    const height = Number(t);
    if (height > latest.height)
      return {
        error: `Block ${height} is past block ${latest.height}, the newest one Blocklore's store has seen. ${help}`,
      };
    return { asOf: { height } };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const start = Date.parse(`${t}T00:00:00Z`);
    if (Number.isNaN(start) || new Date(start).toISOString().slice(0, 10) !== t)
      return { error: `${t} is not a date on the calendar. ${help}` };
    if (t > latest.time.slice(0, 10))
      return {
        error: `${t} is after ${latest.time.slice(0, 10)}, the newest day in Blocklore's store. ${help}`,
      };
    return { asOf: { date: t, time: `${t}T23:59:59.999Z` } };
  }
  return { error: `That is not a moment. ${help}` };
}

/** The moment as it is written in a URL: the height, or the date. */
export function asOfPath(a: AsOf): string {
  return "date" in a ? a.date : String(a.height);
}

/**
 * Reader input for a moment made URL-ready: spaces, commas and underscores dropped, so "976,771"
 * and "block 976 771" both become 976771. The result is parsed like any other text.
 */
export function momentText(input: string): string {
  return input
    .trim()
    .replace(/^block\s*/i, "")
    .replace(/[\s,_]/g, "");
}

/**
 * When block `height` came, as far as the store's own stamps tell: each stamp records the tip the
 * brain saw at a time, so the block came after the last stamp below its height and no later than
 * the first stamp at or above it. One UTC day when both fall on it, else the two days; `before`
 * when the block is older than every stamp; null with no stamp at or above it.
 */
export function heightDay(
  height: number,
  stamps: Stamp[],
): { on: string } | { between: [string, string] } | { before: string } | null {
  const ms = (s: Stamp) => Date.parse(s.time);
  let below: Stamp | null = null;
  let above: Stamp | null = null;
  for (const s of stamps) {
    if (s.height < height) {
      if (!below || ms(s) > ms(below)) below = s;
    } else if (!above || ms(s) < ms(above)) above = s;
  }
  if (!above) return null;
  const to = above.time.slice(0, 10);
  if (!below) return { before: to };
  const from = below.time.slice(0, 10);
  if (from === to) return { on: to };
  return { between: from < to ? [from, to] : [to, from] };
}

/** A topic as it stood at a moment, with what has changed in it since. */
export interface TopicAsOf<C extends Claim> {
  /** The opening claim then: the topic's lede, or its first claim when the lede was not shown yet. */
  lede: C | null;
  /** The sections that held a claim then, each with its claims as they stood, in reading order. */
  sections: (Omit<Section, "claims"> & { claims: C[] })[];
  /** Every claim the sections showed then, each once, in reading order. */
  claims: C[];
  /** Claim ids, by what happened to them after the moment. */
  since: { added: string[]; revised: string[]; withdrawn: string[] };
}

/**
 * A topic's claims as they stood at `m`. A claim created after the moment is absent, one revised
 * later shows the revision in force then, one withdrawn before it is absent and one withdrawn after
 * it shows as it was. The topic's titles and order are the ones written now: topics hold no prose
 * and keep no revision log, so only their claims travel back. Pass the topic as written in the store,
 * withdrawn claims and all; `find` looks a claim up, current or withdrawn, and `rewind` rebuilds one
 * (claimAsOf, or a richer one for compiled claims).
 */
export function topicAsOf<C extends Claim>(
  topic: Pick<Topic, "lede" | "sections">,
  find: (id: string) => C | undefined,
  m: Moment,
  rewind: (c: C, m: Moment) => C | null = claimAsOf,
): TopicAsOf<C> {
  const then = new Map<string, C>();
  const since: TopicAsOf<C>["since"] = { added: [], revised: [], withdrawn: [] };
  const ids = [...new Set([topic.lede, ...topic.sections.flatMap((s) => s.claims)])];
  for (const id of ids) {
    const now = find(id);
    if (!now) continue;
    const past = rewind(now, m);
    const shownThen = past !== null && past.status !== "withdrawn";
    const shownNow = now.status !== "withdrawn";
    if (shownThen) then.set(id, past);
    if (past === null && shownNow) since.added.push(id);
    else if (shownThen && !shownNow) since.withdrawn.push(id);
    else if (shownThen && now.revisions.length > past.revisions.length) since.revised.push(id);
  }
  const sections = topic.sections
    .map((s) => ({ ...s, claims: s.claims.flatMap((id) => then.get(id) ?? []) }))
    .filter((s) => s.claims.length > 0);
  const claims = [...new Map(sections.flatMap((s) => s.claims.map((c) => [c.id, c]))).values()];
  const lede = then.get(topic.lede) ?? sections[0]?.claims[0] ?? null;
  return { lede, sections, claims, since };
}
