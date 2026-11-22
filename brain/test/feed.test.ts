import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type DaemonState, DEFAULT_SETTINGS } from "@blocklore/core/control";
import { BrainFeed, dayCounts, type FeedEvent } from "@blocklore/core/feed";

// The feed log lives in the control folder, which env.ts reads once at import.
process.env.BLOCKLORE_CONTROL_DIR = mkdtempSync(path.join(tmpdir(), "blocklore-feed-"));
const { buildFeed, feedDone, feedEvent, feedEvents, feedNow, publicTopic } = await import(
  "../src/feed.ts"
);

const NOW = new Date("2026-11-21T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const state = (over: Partial<DaemonState> = {}): DaemonState =>
  ({
    at: NOW.toISOString(),
    started: at(600),
    host: "devbox",
    head: "a".repeat(40),
    live: null,
    activity: { kind: "idle", label: "waiting", since: at(30), run: null },
    settings: DEFAULT_SETTINGS,
    usage: { today: { sessions: 0, minutes: 0, turns: 0 }, days: [] },
    ticks: [
      { tick: "hourly", enabled: true, last: null, next: at(-14) },
      { tick: "daily", enabled: false, last: null, next: at(-300) },
      { tick: "weekly", enabled: true, last: null, next: at(-3000) },
    ],
    research: { runsToday: 0, next: { at: null, topic: null, why: "" } },
    runs: [],
    agenda: [],
    review: { count: 0, topics: [] },
    subscription: { token: false, limitedUntil: null, limitedWhy: null },
    results: [],
    ...over,
  }) as DaemonState;

test("only published topics reach the feed; a new agenda topic stays private", () => {
  assert.equal(publicTopic("lightning"), "lightning");
  assert.equal(publicTopic("a-topic-nobody-published"), undefined);
  assert.equal(publicTopic(null), undefined);
});

test("events are validated, kept newest first, and a bad one is dropped without throwing", () => {
  feedEvent({ kind: "ingest", text: "Read 11 upstream feeds: 42 new items", n: 42, at: at(50) });
  feedEvent({ kind: "recheck", text: "Checked 30 facts", n: 30, at: at(40), outcome: "ok" });
  feedEvent({ kind: "ingest", text: "a line\nwith a break", at: at(30) });
  feedEvent({ kind: "research", text: "x", claims: ["not a claim id"], at: at(30) });
  const events = feedEvents(NOW);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["recheck", "ingest"],
  );
});

test("the day counts each kind once, and a research session counts when it closes", () => {
  const e = (kind: FeedEvent["kind"], n: number, minutesAgo: number, outcome?: "ok" | "failed") =>
    ({ at: at(minutesAgo), kind, text: kind, n, ...(outcome ? { outcome } : {}) }) as FeedEvent;
  const day = dayCounts(
    [
      e("ingest", 40, 10),
      e("ingest", 2, 25 * 60), // older than a day
      e("recheck", 30, 60),
      e("research", 6, 90),
      e("research", 0, 30, "ok"),
      e("publish", 4, 31),
      e("verify", 2, 80, "failed"),
      e("evaluate", 1, 20, "failed"),
      e("evaluate", 3, 20, "ok"),
    ],
    NOW,
  );
  assert.deepEqual(day, {
    read: 40,
    rechecked: 30,
    drafted: 6,
    published: 4,
    rejected: 3,
    sessions: 1,
  });
});

test("the feed says what runs now, what comes next, and parses as the site expects", () => {
  feedNow("recheck", "Checking the least recently verified facts against their sources");
  const busy = buildFeed(state(), null, NOW);
  assert.equal(busy.now.kind, "recheck");
  assert.deepEqual(
    busy.next.map((n) => n.kind),
    ["ingest", "recheck"],
    "the daily tick is off, so only hourly and weekly are next, soonest first",
  );
  assert.ok(BrainFeed.safeParse(busy).success);
  feedDone();
  assert.equal(buildFeed(state(), null, NOW).now.kind, "idle");

  const researching = buildFeed(
    state({
      activity: { kind: "research", label: "", since: at(5), run: "r" },
      settings: { ...DEFAULT_SETTINGS, research: { ...DEFAULT_SETTINGS.research, mode: "daily" } },
      research: { runsToday: 0, next: { at: at(-60), topic: "secret-new-topic", why: "" } },
    }),
    { topic: "secret-new-topic", phase: "research" },
    NOW,
  );
  assert.equal(researching.now.kind, "research");
  assert.equal(researching.now.topic, undefined);
  assert.doesNotMatch(JSON.stringify(researching), /secret-new-topic/);
  assert.equal(
    buildFeed(
      state({ activity: { kind: "paused", label: "", since: at(1), run: null } }),
      null,
      NOW,
    ).now.kind,
    "paused",
  );
});

test("a stale running marker is ignored", () => {
  writeFileSync(
    path.join(process.env.BLOCKLORE_CONTROL_DIR as string, "feed-now.json"),
    JSON.stringify({ kind: "lab", text: "old", since: at(4 * 60) }),
  );
  assert.equal(buildFeed(state(), null, NOW).now.kind, "idle");
});
