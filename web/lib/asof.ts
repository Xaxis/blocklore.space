import "server-only";
import {
  type AsOf,
  asOfPath,
  type BundleClaim,
  bundleClaimAsOf,
  detectSecrets,
  heightDay,
  isAfter,
  ladder,
  momentText,
  parseAsOf,
  SECRET_LABEL,
  type Stamp,
  topicAsOf,
} from "@blocklore/core";
import { bundle, eventsFor, getClaim, getWithdrawn } from "./data";
import { date, height } from "./format";

// The time machine's reads: a topic or a claim as Blocklore stated it at a past block height or UTC
// date (core/src/replay.ts). The pages, the API and the MCP tools all parse moments here, against
// the edition the bundle was compiled at, so a moment means the same thing on every surface.

/** The newest moment the store knows: nothing after it can be shown. */
export const LATEST: Stamp = bundle.generated;

/**
 * A moment from reader text (a URL segment, a query, a tool argument), refused when it looks like
 * a secret (never echoed or kept), is not a height or a date, or lies past the store's edition.
 */
export function readAsOf(text: string | null | undefined): { asOf: AsOf } | { error: string } {
  const t = text ?? "";
  const secrets = detectSecrets(t);
  if (secrets.length)
    return {
      error: `That looks like ${secrets.map((s) => SECRET_LABEL[s.kind]).join(" and ")}, not a moment. Blocklore never accepts seeds, keys or addresses, and it did not keep this. If it is real, treat it as exposed.`,
    };
  return parseAsOf(t, LATEST);
}

/** A claim by id, current or withdrawn. */
export const anyClaim = (id: string): BundleClaim | undefined => getClaim(id) ?? getWithdrawn(id);

/** A claim as it stood at the moment, or null when it was not published yet. */
export function claimAt(id: string, a: AsOf): BundleClaim | null | undefined {
  const c = anyClaim(id);
  return c && bundleClaimAsOf(c, a);
}

/** A topic's claims as they stood at the moment, its ladder then and its newest change by then. */
export function topicAt(slug: string, a: AsOf) {
  // The topic as written in the store, withdrawn claims and all.
  const topic = bundle.writtenTopics.find((t) => t.slug === slug);
  if (!topic) return undefined;
  const view = topicAsOf(topic, anyClaim, a, bundleClaimAsOf);
  let updated: Stamp | null = null;
  for (const c of view.claims) {
    const at = c.revisions[c.revisions.length - 1]?.at;
    if (at && (!updated || at.time > updated.time)) updated = at;
  }
  return { topic, ...view, ladder: ladder(view.claims), updated };
}

/** A claim's revisions after the moment: what changed in it since. */
export function changesSince(id: string, a: AsOf) {
  return eventsFor(id).filter((e) => isAfter(e.at, a));
}

/** Every stamp the store holds, for telling which day a block came on (`heightDay`). */
const STAMPS: Stamp[] = [
  bundle.generated,
  ...bundle.events.map((e) => e.at),
  ...bundle.runs.flatMap((r) => [r.started, r.finished]),
  ...bundle.snapshots.map((s) => s.at),
];

/** "block 976,771" or "21 Nov 2026". */
export function asOfName(a: AsOf): string {
  return "date" in a ? date(a.date) : `block ${height(a.height)}`;
}

/**
 * The moment in a sentence's opening: "As of block 976,771, 20 Nov 2026", with the day the store's
 * own stamps place the block on, or "As of the end of 21 Nov 2026 (UTC)".
 */
export function asOfTitle(a: AsOf): string {
  if ("date" in a) return `As of the end of ${date(a.date)} (UTC)`;
  const day = heightDay(a.height, STAMPS);
  const when = !day
    ? ""
    : "on" in day
      ? `, ${date(day.on)}`
      : "between" in day
        ? `, between ${date(day.between[0])} and ${date(day.between[1])}`
        : `, before ${date(day.before)}`;
  return `As of block ${height(a.height)}${when}`;
}

/** The moment as JSON for the API and the MCP tools, with the page that shows it. */
export function asOfJson(a: AsOf, page: string) {
  return { ...a, at: asOfPath(a), url: page };
}

/** Where a reader's typed moment goes: `<base>/at/<moment>`, or back to `base` when it is empty. */
export function asOfTarget(base: string, typed: string | null): string {
  const t = momentText(typed ?? "").slice(0, 40);
  return t ? `${base}/at/${encodeURIComponent(t)}` : base;
}
