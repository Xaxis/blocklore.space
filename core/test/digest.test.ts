import assert from "node:assert/strict";
import { test } from "node:test";
import { digestDays } from "../src/digest.ts";
import type { ChangeEvent } from "../src/replay.ts";
import type { BipChange, Run } from "../src/schema.ts";

const ev = (
  claim: string,
  topic: string,
  change: ChangeEvent["change"],
  time: string,
  height: number,
  rev = 1,
): ChangeEvent => ({
  claim,
  topics: [topic],
  rev,
  change,
  at: { time, height },
  run: "2026-11-20-seed-x",
  statement: `${claim} says something.`,
});

const run = (id: string, time: string, published: string[], held: number): Run => ({
  id,
  kind: "seed",
  started: { time, height: 1 },
  finished: { time, height: 2 },
  agent: "test agent",
  summary: "A test run that did a thing.",
  read: [],
  published,
  revised: [],
  rejected: [],
  gated: held ? [{ topic: "segwit", count: held, reasons: ["contested"] }] : [],
  open: [],
  injections: [],
});

test("a day groups new claims by topic order, corrections first, BIP moves and runs", () => {
  const events = [
    ev("segwit.a", "segwit", "created", "2026-11-20T10:00:00Z", 976700),
    ev("halvings.b", "halvings", "created", "2026-11-20T09:00:00Z", 976690),
    ev("halvings.c", "halvings", "corrected", "2026-11-20T12:00:00Z", 976720, 2),
    ev("halvings.d", "halvings", "sources", "2026-11-20T11:00:00Z", 976710, 2),
    ev("segwit.e", "segwit", "created", "2026-11-19T23:59:59Z", 976600),
  ];
  const bip: BipChange = {
    n: 360,
    title: "P2MR",
    field: "status",
    before: "Draft",
    after: "Complete",
    commit: "a".repeat(40),
    at: { time: "2026-11-20T13:00:00Z", height: 976730 },
  };
  const days = digestDays(
    events,
    [run("2026-11-20-seed-segwit", "2026-11-20T10:30:00Z", ["segwit.a"], 3)],
    [bip],
    ["halvings", "segwit"],
  );
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-11-20", "2026-11-19"],
  );
  const [d] = days;
  assert.deepEqual(d?.heights, { from: 976690, to: 976730 });
  assert.deepEqual(
    d?.corrections.map((e) => e.claim),
    ["halvings.c"],
  );
  assert.deepEqual(
    d?.revisions.map((e) => e.claim),
    ["halvings.d"],
  );
  assert.deepEqual(
    d?.created.map((g) => [g.topic, g.events.map((e) => e.claim)]),
    [
      ["halvings", ["halvings.b"]],
      ["segwit", ["segwit.a"]],
    ],
  );
  assert.equal(d?.bips[0]?.n, 360);
  assert.deepEqual(d?.runs, [{ id: "2026-11-20-seed-segwit", published: 1, revised: 0, held: 3 }]);
});

test("a day with only a BIP index change still has a digest", () => {
  const bip: BipChange = {
    n: 3,
    title: "T",
    field: "added",
    after: "Draft",
    commit: "b".repeat(40),
    at: { time: "2026-11-21T01:00:00Z", height: 976800 },
  };
  const [d] = digestDays([], [], [bip], []);
  assert.equal(d?.date, "2026-11-21");
  assert.deepEqual(d?.heights, { from: 976800, to: 976800 });
  assert.equal(d?.created.length, 0);
});
