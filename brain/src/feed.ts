// The brain's public feed log (core/src/feed.ts): every step of the brain's work that a reader may
// see, as one JSON line in var/control/feed.jsonl, and the step running now in feed-now.json. The
// ticks, research sessions, the evaluator, the security watch and the lab write here; the daemon
// reads it on every sync and sends the site a BrainFeed built from it.
//
// Only public facts go in: published claim ids, public topic slugs, counts. Anything about an
// unpublished candidate is a count, never its text. Every line is checked against FeedEvent before
// it is written, so a bad caller fails here rather than on the site.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DaemonState } from "@blocklore/core/control";
import {
  type Activity,
  type BrainFeed,
  dayCounts,
  FEED_EVENTS,
  FeedEvent,
} from "@blocklore/core/feed";
import { CONTROL_DIR, KNOWLEDGE } from "./env.ts";

const LOG = () => path.join(CONTROL_DIR, "feed.jsonl");
const NOW = () => path.join(CONTROL_DIR, "feed-now.json");
/** The log is cut back to this many lines when it grows past twice as many. */
const KEEP = 2000;

export interface FeedNow {
  kind: Activity;
  text: string;
  since: string;
  topic?: string;
}

/** A topic slug only when that topic is published; a new agenda topic stays private. */
export function publicTopic(slug: string | null | undefined): string | undefined {
  if (!slug) return undefined;
  return existsSync(path.join(KNOWLEDGE, "topics", `${slug}.yaml`)) ? slug : undefined;
}

/** Appends one event. Never throws: the feed must not stop the work it describes. */
export function feedEvent(e: Omit<FeedEvent, "at"> & { at?: string }): void {
  try {
    const event = FeedEvent.parse({ ...e, at: e.at ?? new Date().toISOString() });
    mkdirSync(CONTROL_DIR, { recursive: true });
    appendFileSync(LOG(), `${JSON.stringify(event)}\n`);
    const lines = readFileSync(LOG(), "utf8").split("\n").filter(Boolean);
    if (lines.length > 2 * KEEP) writeFileSync(LOG(), `${lines.slice(-KEEP).join("\n")}\n`);
  } catch (err) {
    console.error(`feed: event not recorded: ${err instanceof Error ? err.message : err}`);
  }
}

/** The events of the last day and the newest FEED_EVENTS, newest first. */
export function feedEvents(now: Date): FeedEvent[] {
  if (!existsSync(LOG())) return [];
  const since = now.getTime() - 86_400_000;
  const all = readFileSync(LOG(), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      const p = FeedEvent.safeParse(JSON.parse(l));
      return p.success ? [p.data] : [];
    })
    .reverse();
  return all.filter((e, i) => i < FEED_EVENTS || Date.parse(e.at) >= since);
}

/** Marks the step running now; `feedDone` clears it. */
export function feedNow(kind: Activity, text: string, topic?: string): void {
  try {
    mkdirSync(CONTROL_DIR, { recursive: true });
    const now: FeedNow = {
      kind,
      text,
      since: new Date().toISOString(),
      ...(topic ? { topic } : {}),
    };
    writeFileSync(NOW(), JSON.stringify(now));
  } catch {
    // the feed must not stop the work
  }
}

export function feedDone(): void {
  try {
    writeFileSync(NOW(), "null");
  } catch {
    // nothing to clear
  }
}

/** The step running now, if one marked itself and is younger than three hours. */
export function readFeedNow(now: Date): FeedNow | null {
  try {
    const v = JSON.parse(readFileSync(NOW(), "utf8")) as FeedNow | null;
    if (!v || now.getTime() - Date.parse(v.since) > 3 * 3600_000) return null;
    return v;
  } catch {
    return null;
  }
}

const TICK_NEXT: Record<"hourly" | "daily" | "weekly", { kind: Activity; text: string }> = {
  hourly: { kind: "ingest", text: "Read the upstream feeds and the BIP index" },
  daily: {
    kind: "recheck",
    text: "Check the stalest facts again, then seal an edition in Bitcoin",
  },
  weekly: { kind: "recheck", text: "Measure how well search finds what the store knows" },
};

const RESEARCH_PHASE: Record<string, Activity> = {
  research: "research",
  repair: "research",
  verify: "verify",
  publishing: "publish",
};

/** Whether new research runs, said plainly; reading the feeds and rechecking go on regardless. */
export function researchState(state: DaemonState): NonNullable<BrainFeed["research"]> {
  const s = state.settings;
  if (s.paused) return { state: "paused", text: "Paused by the owner" };
  if (!state.subscription.token)
    return {
      state: "paused",
      text: "New research is paused; reading the feeds and rechecking facts go on",
    };
  if (state.subscription.limitedUntil)
    return {
      state: "limited",
      text: "New research waits for its plan's usage limit to reset",
      until: state.subscription.limitedUntil,
    };
  if (s.research.mode === "off")
    return {
      state: "manual",
      text: "New research runs when the owner starts a session; reading the feeds and rechecking facts go on",
    };
  const n = s.research.maxRunsPerDay;
  return s.research.mode === "daily"
    ? {
        state: "scheduled",
        text: `New research runs on its own once a day at ${String(s.research.dailyAt).padStart(2, "0")}:00 UTC`,
      }
    : {
        state: "scheduled",
        text: `New research runs on its own, up to ${n} session${n === 1 ? "" : "s"} a day`,
      };
}

/** The public feed from the daemon's state: what it does now, what comes next, what it did. */
export function buildFeed(
  state: DaemonState,
  current: { topic: string; phase: string } | null,
  now: Date,
): BrainFeed {
  const events = feedEvents(now);
  const step = readFeedNow(now);
  const a = state.activity;
  let current_: BrainFeed["now"];
  if (a.kind === "paused")
    current_ = { kind: "paused", text: "Paused by the owner", since: a.since };
  else if (a.kind === "research" && current) {
    const topic = publicTopic(current.topic);
    current_ = {
      kind: RESEARCH_PHASE[current.phase] ?? "research",
      text:
        current.phase === "verify"
          ? "The verifier is trying to falsify what research drafted"
          : current.phase === "publishing"
            ? "Publishing what survived the checks"
            : `Researching ${topic ? topic.replace(/-/g, " ") : "a new topic"}: reading primary sources`,
      since: a.since,
      ...(topic ? { topic } : {}),
    };
  } else if (step) current_ = step;
  else current_ = { kind: "idle", text: "Waiting for the next scheduled step", since: a.since };

  const next: BrainFeed["next"] = [];
  for (const t of state.ticks)
    if (t.enabled && t.next && !state.settings.paused)
      next.push({ ...TICK_NEXT[t.tick], at: t.next });
  const r = state.research.next;
  if (r.at && state.settings.research.mode !== "off" && !state.settings.paused) {
    const topic = publicTopic(r.topic);
    next.push({
      kind: "research",
      text: `Research ${topic ? topic.replace(/-/g, " ") : "the topic with the most open gaps"}`,
      at: r.at,
    });
  }
  next.sort((x, y) => x.at.localeCompare(y.at));

  return {
    v: 1,
    at: now.toISOString(),
    now: current_,
    next: next.slice(0, 8),
    research: researchState(state),
    events: events.slice(0, FEED_EVENTS),
    day: dayCounts(events, now),
  };
}
