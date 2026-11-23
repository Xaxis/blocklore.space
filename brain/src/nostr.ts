// The Nostr channel on the devbox (ORANGECHECK.md, "The Nostr channel"). People follow it: the
// daily digest as a long-form article, each edition once a Bitcoin block seals it, and the security
// watch's changes and lab runs. core/src/nostr.ts builds every note from the store and the bundle;
// no model writes any of it, and the disclosure screen there stops anything embargoed.
//
// The channel key is HKDF from the publisher key under its own label (brain/src/orangecheck.ts), a
// sibling of the key that carries OrangeCheck records. The owner turns posting on and off in the
// admin (`nostr.post`); while it is off nothing is sent, and the OrangeCheck records keep their own
// publishing. A note counts as published once two relays serve it back. var/nostr/published.json
// keeps each signed event, and the hourly tick resends the same event until two relays hold it.
//
//   pnpm brain nostr status     the key, the switch, the relays, what went out
//   pnpm brain nostr preview    the next notes exactly as they would go out; nothing is sent
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  advisoryIds,
  type ChannelNote,
  canonicalJson,
  channelNotes,
  compile,
  type HeldNote,
  isLoopbackRelay,
  NOSTR_PER_TICK,
  NOSTR_QUORUM,
  type NostrChannel,
  NostrView,
  noteScreen,
  npub,
  OC_RELAYS,
  type Store,
  secondTime,
} from "@blocklore/core";
import type { NostrSettings } from "@blocklore/core/control";
import { loadStore, storeMoment } from "@blocklore/core/node";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  getEventHash,
  type NostrEvent,
  type PublishResult,
  publishEvent,
  queryEvents,
} from "@orangecheck/nostr-core";
import { readSettings, writeJsonAtomic } from "./control.ts";
import { KNOWLEDGE, ROOT, SITE, VAR } from "./env.ts";
import { feedEvent } from "./feed.ts";
import { commitAsOwner } from "./git.ts";
import { type Publisher, publisherFrom } from "./orangecheck.ts";
import { type EmbargoItem, listEmbargo } from "./security/embargo.ts";
import { disclosureContext, RELEASED } from "./security/gate.ts";

export const NOSTR_DIR = process.env.BLOCKLORE_NOSTR_DIR || path.join(VAR, "nostr");
const logFile = () => path.join(NOSTR_DIR, "published.json");
const recordFile = () => path.join(KNOWLEDGE, "nostr.json");

/** The relays the channel posts to: OrangeCheck's, or BLOCKLORE_NOSTR_RELAYS (a local stub). */
export function channelRelays(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.BLOCKLORE_NOSTR_RELAYS?.trim();
  return raw
    ? raw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : [...OC_RELAYS];
}

const devSite = (site: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(site);

/**
 * Why the channel may not post to these relays from here, or null. A test, and a development
 * daemon (its site is on this machine), reach only relays on this machine, so a test key never
 * reaches a public relay; production posts only to wss:// relays.
 */
export function relayProblem(
  relays: readonly string[],
  opts: { site: string; test: boolean },
): string | null {
  if (!relays.length) return "no relays";
  const bad = relays.find((r) => !/^wss?:\/\/\S+$/.test(r));
  if (bad) return `${bad} is not a relay address`;
  const local = relays.every(isLoopbackRelay);
  if (opts.test) return local ? null : "a test may reach only relays on this machine";
  if (devSite(opts.site))
    return local
      ? null
      : "a development daemon (its site is on this machine) may reach only relays on this machine";
  return relays.some((r) => !r.startsWith("wss://"))
    ? "the channel posts only to wss:// relays"
    : null;
}

interface LogEntry {
  label: string;
  /** The event as signed the first time; resent unchanged until enough relays hold it. */
  event: NostrEvent;
  /** Relays that served it back, each asked alone. */
  relays: string[];
  first: string;
  last: string;
}
export type ChannelLog = Record<string, LogEntry>;

export const readLog = (file = logFile()): ChannelLog =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ChannelLog) : {};

export const isPublished = (e: LogEntry | undefined) => (e?.relays.length ?? 0) >= NOSTR_QUORUM;

/** When the log last changed, so the daemon rebuilds the admin's preview after a send. */
export const channelLogStamp = (): string => {
  const f = logFile();
  return existsSync(f) ? String(statSync(f).mtimeMs) : "none";
};

/** Everything the embargo holds that a note must never name: ids, CVE and GHSA ids, test names. */
export function embargoNeedles(items: readonly EmbargoItem[]): string[] {
  const out = new Set<string>();
  for (const it of items) {
    out.add(it.id);
    const d = (it.detail ?? {}) as {
      candidate?: { id?: string; statement?: string; sources?: { url?: string; title?: string }[] };
      run?: { tests?: { name: string; ok: boolean }[] };
    };
    if (d.candidate?.id) out.add(d.candidate.id);
    const text = [
      it.title,
      d.candidate?.statement ?? "",
      ...(d.candidate?.sources ?? []).map((s) => `${s.title ?? ""} ${s.url ?? ""}`),
    ].join("\n");
    for (const id of advisoryIds(text)) out.add(id);
    for (const t of d.run?.tests ?? []) if (!t.ok) out.add(t.name);
  }
  return [...out];
}

export interface ChannelState {
  at: string;
  publisher: Publisher | null;
  /** Why the channel has no key, when it has none. */
  problem: string | null;
  settings: NostrSettings;
  relays: string[];
  /** Every note the channel would send now, screened, in order. */
  notes: ChannelNote[];
  held: HeldNote[];
  log: ChannelLog;
}

/** What the channel would do now: the key, the switch, the notes, the log. Reads, never sends. */
export function channelState(
  opts: {
    at?: Date;
    store?: Store;
    settings?: NostrSettings;
    env?: Record<string, string | undefined>;
    embargo?: EmbargoItem[];
    log?: ChannelLog;
  } = {},
): ChannelState {
  const at = secondTime(opts.at ?? new Date());
  const env = opts.env ?? process.env;
  const settings = opts.settings ?? readSettings().nostr;
  let publisher: Publisher | null = null;
  let problem: string | null = null;
  try {
    publisher = publisherFrom(env);
    if (!publisher) problem = "no publisher key on the devbox yet (pnpm brain orangecheck keygen)";
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  const relays = channelRelays(env);
  const store = opts.store ?? loadStore(KNOWLEDGE).store;
  const { bundle } = compile(store, storeMoment(store));
  const screen = noteScreen({
    disclosure: disclosureContext(store),
    embargoed: embargoNeedles(opts.embargo ?? listEmbargo()),
    released: (c) => c.review?.reasons.includes(RELEASED) ?? false,
  });
  // While it is off, the preview shows what turning it on now would send.
  const since = settings.post && settings.changed ? settings.changed : at;
  const { notes, held } = channelNotes({ bundle, relays, at, since, screen });
  return { at, publisher, problem, settings, relays, notes, held, log: opts.log ?? readLog() };
}

export const pendingNotes = (s: ChannelState): ChannelNote[] =>
  s.notes.filter((n) => !isPublished(s.log[n.id]));

const sameNote = (e: NostrEvent, n: ChannelNote) =>
  e.kind === n.kind && e.content === n.content && canonicalJson(e.tags) === canonicalJson(n.tags);

/** A note as a NIP-01 event signed by the channel key. */
export function signNote(n: ChannelNote, key: Publisher["channel"], createdAt: number): NostrEvent {
  const unsigned = {
    kind: n.kind,
    tags: n.tags,
    content: n.content,
    pubkey: key.pubkey,
    created_at: createdAt,
  };
  const id = getEventHash(unsigned);
  return {
    ...unsigned,
    id,
    sig: Buffer.from(schnorr.sign(Buffer.from(id, "hex"), key.secret)).toString("hex"),
  };
}

/** Relays that serve the event back, each asked alone by its id (signature and id checked). */
async function readBackFromRelays(e: NostrEvent, relays: readonly string[]): Promise<string[]> {
  const answers = await Promise.all(
    relays.map(async (relay) => {
      const r = await queryEvents({ ids: [e.id] }, [relay], 4000);
      return r.events.some((x) => x.id === e.id) ? relay : null;
    }),
  );
  return answers.filter((r): r is string => r !== null);
}

export interface PostDeps {
  send?: (e: NostrEvent, relays: readonly string[]) => Promise<PublishResult[]>;
  readBack?: (e: NostrEvent, relays: readonly string[]) => Promise<string[]>;
  logFile?: string;
  now?: () => Date;
  max?: number;
  /** The site this daemon syncs with: a development one reaches only local relays. */
  site?: string;
}

/**
 * Sends the notes not yet on NOSTR_QUORUM relays, at most `max`, and keeps the log. Sends nothing
 * while the switch is off. A note signed before is resent as the same event, so a follower never
 * sees it twice; one whose content changed since (the screen now holds part of it) is signed anew.
 */
export async function postPending(
  s: ChannelState,
  deps: PostDeps = {},
): Promise<{ off: boolean; published: string[]; waiting: string[]; left: number }> {
  if (!s.settings.post) return { off: true, published: [], waiting: [], left: 0 };
  if (!s.publisher) throw new Error(s.problem ?? "no publisher key");
  const problem = relayProblem(s.relays, {
    site: deps.site ?? SITE,
    test: !!process.env.NODE_TEST_CONTEXT,
  });
  if (problem) throw new Error(`refusing to post: ${problem}`);
  const send = deps.send ?? ((e, r) => publishEvent(e, r, 8000));
  const readBack = deps.readBack ?? readBackFromRelays;
  const file = deps.logFile ?? logFile();
  const log: ChannelLog = { ...s.log };
  const pending = s.notes.filter((n) => !isPublished(log[n.id]));
  const todo = pending.slice(0, deps.max ?? NOSTR_PER_TICK);
  const published: string[] = [];
  const waiting: string[] = [];
  for (const note of todo) {
    const now = deps.now?.() ?? new Date();
    const prior = log[note.id];
    const again = prior && sameNote(prior.event, note);
    const event = again
      ? prior.event
      : signNote(note, s.publisher.channel, Math.floor(now.getTime() / 1000));
    // Kept before sending, so a crash between here and the log never makes a second event.
    log[note.id] = {
      label: note.label,
      event,
      relays: again ? prior.relays : [],
      first: again ? prior.first : now.toISOString(),
      last: now.toISOString(),
    };
    writeJsonAtomic(file, log);
    let results: PublishResult[] = [];
    try {
      results = await send(event, s.relays);
    } catch {
      results = [];
    }
    const served = await readBack(event, s.relays).catch(() => [] as string[]);
    const entry = log[note.id] as LogEntry;
    entry.relays = [...new Set([...entry.relays, ...served])].sort();
    writeJsonAtomic(file, log);
    (isPublished(entry) ? published : waiting).push(note.id);
    console.log(
      `nostr: ${note.id} kind ${event.kind}: ${results.filter((r) => r.ok).length} of ${s.relays.length} relays took it, ${entry.relays.length} serve it back`,
    );
  }
  return { off: false, published, waiting, left: pending.length - todo.length };
}

/** What knowledge/nostr.json should say, or null before the owner first switched the channel. */
export function desiredRecord(s: ChannelState): NostrChannel | null {
  if (!s.publisher || !s.settings.changed) return null;
  return {
    pubkey: s.publisher.channel.pubkey,
    records: s.publisher.nostr.pubkey,
    relays: s.relays,
    posting: s.settings.post,
    changed: s.settings.changed,
  };
}

/**
 * Brings knowledge/nostr.json in line with the switch and commits it as the owner when the
 * checkout is on main (the ticks' rule). Returns what it did, or null when nothing changed.
 */
export function syncRecord(s: ChannelState, opts: { commit?: boolean } = {}): string | null {
  const want = desiredRecord(s);
  if (!want) return null;
  const file = recordFile();
  const text = `${JSON.stringify(want, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, "utf8") === text) return null;
  writeFileSync(file, text);
  const rel = path.relative(ROOT, file);
  if (opts.commit === false) return `wrote ${rel}`;
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (branch !== "main") return `wrote ${rel}; not committed, the checkout is on ${branch}`;
  commitAsOwner(
    [rel],
    want.posting
      ? "Turn on Blocklore's Nostr channel, as the owner asked in the admin, so people can follow it and NIP-05 names its key."
      : "Turn off Blocklore's Nostr channel, as the owner asked in the admin. Its key still resolves, so what it posted stays checkable.",
    false,
  );
  return `recorded ${rel}: posting ${want.posting ? "on" : "off"}`;
}

/** Sends what waits, when the switch is on; the words for the owner. */
export async function channelPost(s: ChannelState, deps?: PostDeps): Promise<string> {
  if (!s.settings.post) return "posting is off, so nothing was sent";
  if (!s.publisher) return s.problem ?? "no publisher key";
  const r = await postPending(s, deps);
  if (r.published.length)
    feedEvent({
      kind: "publish",
      text: `Posted ${r.published.length} note(s) to Blocklore's Nostr channel`,
      outcome: "ok",
    });
  if (!r.published.length && !r.waiting.length) return "nothing new to post";
  return `${r.published.length} note(s) now on two relays, ${r.waiting.length} not yet${r.left ? `, ${r.left} for the next tick` : ""}`;
}

/** The hourly tick's step: the record, then what waits. Nothing is sent while the switch is off. */
export async function nostrChannelStep(): Promise<string | undefined> {
  const s = channelState();
  const rec = syncRecord(s);
  if (!s.settings.post) return `posting is off${rec ? `; ${rec}` : ""}`;
  if (!s.publisher) return s.problem ?? "no publisher key";
  const r = await postPending(s);
  if (r.published.length)
    feedEvent({
      kind: "publish",
      text: `Posted ${r.published.length} note(s) to Blocklore's Nostr channel`,
      outcome: "ok",
    });
  return r.waiting.length || r.left
    ? `${r.waiting.length} note(s) not yet on two relays, ${r.left} for the next tick`
    : rec || undefined;
}

/** The channel as the admin shows it under the switch. */
export function nostrView(s: ChannelState, site = SITE): NostrView {
  const pending = pendingNotes(s);
  const shown = pending.slice(0, 60);
  const pubkey = s.publisher?.channel.pubkey ?? null;
  const published = Object.entries(s.log).filter(([, e]) => isPublished(e));
  return NostrView.parse({
    at: s.at,
    posting: s.settings.post,
    changed: s.settings.changed,
    pubkey,
    npub: pubkey ? npub(pubkey) : null,
    relays: s.relays,
    problem: s.problem ?? relayProblem(s.relays, { site, test: false }),
    next: shown.map((n) => {
      const e = s.log[n.id];
      const same = e && sameNote(e.event, n);
      return {
        id: n.id,
        kind: n.kind,
        label: n.label.slice(0, 300),
        at: n.at,
        tags: n.tags,
        content: n.content,
        relays: same ? e.relays : [],
        event: same ? e.event.id : null,
      };
    }),
    more: pending.length - shown.length,
    held: s.held.slice(0, 60).map((h) => ({
      id: h.id.slice(0, 200),
      label: h.label.slice(0, 300),
      reasons: h.reasons.slice(0, 10).map((r) => r.slice(0, 300)),
    })),
    published: published.length,
    recent: published
      .sort(([, a], [, b]) => b.last.localeCompare(a.last))
      .slice(0, 10)
      .map(([id, e]) => ({
        id,
        kind: e.event.kind,
        label: e.label.slice(0, 300),
        at: secondTime(new Date(e.last)),
        event: e.event.id,
        relays: e.relays,
      })),
    perTick: NOSTR_PER_TICK,
  });
}

// --- the CLI -------------------------------------------------------------------------------------

export async function nostr(args: string[]): Promise<number> {
  const [sub] = args;
  if (sub !== "status" && sub !== "preview") {
    console.error("usage: pnpm brain nostr <status | preview>");
    return 2;
  }
  const s = channelState();
  const v = nostrView(s);
  if (sub === "status") {
    console.log(`channel key  ${v.npub ?? "none"}${v.pubkey ? ` (${v.pubkey})` : ""}`);
    console.log(
      `posting      ${v.posting ? "on" : "off"}${v.changed ? ` since ${v.changed}` : ""}`,
    );
    console.log(`relays       ${v.relays.join(", ")}`);
    if (v.problem) console.log(`problem      ${v.problem}`);
    console.log(
      `notes        ${v.published} on two relays, ${v.next.length + v.more} waiting, ${v.held.length} held by the screen`,
    );
    return 0;
  }
  for (const n of v.next) {
    console.log(`--- kind ${n.kind}  ${n.id}  ${n.label}`);
    if (n.tags.length) console.log(`tags ${JSON.stringify(n.tags)}`);
    console.log(n.content);
  }
  for (const h of v.held) console.log(`held  ${h.id}: ${h.reasons.join("; ")}`);
  console.log(
    `preview: ${v.next.length + v.more} note(s) would go out${v.posting ? "" : " if posting were on now"}, at most ${v.perTick} an hour; nothing was sent`,
  );
  return 0;
}
