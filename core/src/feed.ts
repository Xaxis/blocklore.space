// The brain's public feed: what any reader may see of what the brain is doing, live. The daemon
// builds it from its own state and sends it with every sync; the site keeps the latest copy and
// serves it at /api/v1/brain, where the landing view and the scene read it.
//
// It is a projection, never a copy: nothing in it names an unpublished claim, quotes the owner's
// focus or lessons, or carries a run folder path. A candidate that is not public yet appears only
// as a count on a public topic.
import { z } from "zod";
import { claimId, slug } from "./schema.ts";

const iso = z.iso.datetime({ offset: false });
/** Short plain text for readers: no line breaks, bounded. */
const line = z
  .string()
  .max(160)
  .regex(/^[^\n\r]*$/);

/** What the brain can be doing. Each has a plain-words label on the site. */
export const Activity = z.enum([
  "idle",
  "ingest", // reading feeds: mailing lists, repositories, BIPs, advisories
  "research", // a research session drafting claims on a topic
  "verify", // the verifier trying to falsify what research drafted
  "evaluate", // the evaluator deciding what publishes
  "recheck", // re-fetching sources and re-running checks on published claims
  "watch", // the security watches reading the chain and the advisories
  "lab", // replaying known attacks against the current Bitcoin Core in regtest
  "snapshot", // sealing an edition in a Bitcoin block
  "publish", // shipping a new edition of the store
  "paused",
]);
export type Activity = z.infer<typeof Activity>;

export const FeedEvent = z.strictObject({
  at: iso,
  kind: Activity,
  text: line,
  topic: slug.optional(),
  /** Published claims this event touched (the scene lights them). */
  claims: z.array(claimId).max(40).optional(),
  /** A threat id from the security watch, when the event is about one. */
  threat: slug.optional(),
  /** How it ended, when it has: ok, or found something. */
  outcome: z.enum(["ok", "changed", "failed"]).optional(),
  /**
   * How many things the event covers, counted into the day's numbers by its kind (`dayCounts`):
   * ingest, upstream items read; recheck, claims checked again; research, candidates drafted;
   * publish, claims published; verify or evaluate with outcome failed, candidates rejected.
   */
  n: z.number().int().min(0).max(100_000).optional(),
});
export type FeedEvent = z.infer<typeof FeedEvent>;

export const FEED_EVENTS = 60;

export const BrainFeed = z.strictObject({
  v: z.literal(1),
  /** When the daemon built this copy. */
  at: iso,
  now: z.strictObject({
    kind: Activity,
    text: line,
    since: iso,
    topic: slug.optional(),
  }),
  /** What is scheduled next, soonest first. */
  next: z.array(z.strictObject({ kind: Activity, text: line, at: iso })).max(8),
  /**
   * Whether new research runs, in a reader's words: on its own, only when the owner starts it,
   * paused, or waiting for the plan's usage limit (`until`). Absent from older daemons.
   */
  research: z
    .strictObject({
      state: z.enum(["scheduled", "manual", "paused", "limited"]),
      text: line,
      until: iso.optional(),
    })
    .optional(),
  /** Newest first. */
  events: z.array(FeedEvent).max(FEED_EVENTS),
  /** Counts over the last 24 hours (`dayCounts`). */
  day: z.strictObject({
    read: z.number().int().min(0), // upstream items read: commits, posts, proposals, advisories
    rechecked: z.number().int().min(0), // published claims checked again against their sources
    drafted: z.number().int().min(0), // candidates research drafted
    published: z.number().int().min(0),
    rejected: z.number().int().min(0),
    sessions: z.number().int().min(0), // research sessions that finished
  }),
});
export type BrainFeed = z.infer<typeof BrainFeed>;

/** The feed is stale when the daemon has not sent one for this long: the brain is offline. */
export const FEED_STALE_MS = 5 * 60_000;

export type DayCounts = BrainFeed["day"];

/**
 * The day's numbers from the events of the 24 hours before `now`. A research session counts once,
 * on the event that closes it (a research event with an outcome).
 */
export function dayCounts(events: readonly FeedEvent[], now: Date): DayCounts {
  const since = now.getTime() - 86_400_000;
  const day: DayCounts = {
    read: 0,
    rechecked: 0,
    drafted: 0,
    published: 0,
    rejected: 0,
    sessions: 0,
  };
  for (const e of events) {
    if (Date.parse(e.at) < since) continue;
    const n = e.n ?? 0;
    if (e.kind === "ingest") day.read += n;
    else if (e.kind === "recheck") day.rechecked += n;
    else if (e.kind === "research") {
      day.drafted += n;
      if (e.outcome) day.sessions += 1;
    } else if (e.kind === "publish") day.published += n;
    else if ((e.kind === "verify" || e.kind === "evaluate") && e.outcome === "failed")
      day.rejected += n;
  }
  return day;
}
