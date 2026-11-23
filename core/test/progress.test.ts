import assert from "node:assert/strict";
import { test } from "node:test";
import { monthProgress, type ProgressInput, progressMonths } from "../src/progress.ts";
import type { ChangeEvent } from "../src/replay.ts";
import type { Run } from "../src/schema.ts";
import type { LabRun } from "../src/security.ts";

const at = (time: string, height: number) => ({ time, height });
const ev = (
  claim: string,
  change: ChangeEvent["change"],
  time: string,
  height: number,
  topic = "segwit",
) =>
  ({
    claim,
    topics: [topic],
    rev: 1,
    change,
    at: at(time, height),
    run: "r",
    statement: claim,
  }) as ChangeEvent;
const run = (id: string, time: string, read: string[], extra: Partial<Run> = {}) =>
  ({
    id,
    kind: "seed",
    started: at(time, 1),
    finished: at(time, 2),
    agent: "agent",
    summary: "a run for the test",
    read: read.map((url) => ({ url })),
    published: ["a.b"],
    revised: [],
    rejected: [],
    gated: [{ topic: "segwit", count: 2, reasons: ["contested"] }],
    open: [],
    injections: [],
    ...extra,
  }) as Run;
const lab = (atTime: string, oks: boolean[]) =>
  ({
    at: atTime,
    version: "32.1",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 8, signers: 40 },
    jobs: 3,
    seconds: 10,
    tests: oks.map((ok, i) => ({ name: `t${i}.py`, ok, seconds: 1 })),
  }) as unknown as LabRun;

const input: ProgressInput = {
  events: [
    ev("segwit.a", "created", "2026-11-20T10:00:00Z", 976700),
    ev("segwit.b", "created", "2026-11-21T10:00:00Z", 976800),
    ev("taproot.c", "created", "2026-11-22T10:00:00Z", 976900, "taproot"),
    ev("segwit.a", "corrected", "2026-11-25T10:00:00Z", 977300),
    ev("segwit.b", "sources", "2026-11-26T10:00:00Z", 977400),
    ev("taproot.c", "withdrawn", "2026-11-27T10:00:00Z", 977500, "taproot"),
    ev("segwit.d", "created", "2026-12-01T00:00:00Z", 978000),
  ],
  runs: [
    run("2026-11-20-seed-segwit", "2026-11-20T09:00:00Z", ["https://x/1", "https://x/2"]),
    run("2026-11-24-daily", "2026-11-24T09:00:00Z", ["https://x/2", "https://x/3"], {
      kind: "daily",
      published: [],
      gated: [],
    }),
    run("2026-10-31-seed-old", "2026-10-31T23:59:59Z", ["https://x/9"]),
  ],
  evaluatorDays: [
    { day: "2026-11-23", published: 2, held: 1, rejected: 5, canaries: 7, caught: 7 },
    { day: "2026-11-24", published: 1, held: 0, rejected: 0, canaries: 3, caught: 2 },
    { day: "2026-12-01", published: 9, held: 9, rejected: 9, canaries: 9, caught: 9 },
  ],
  editions: [
    {
      n: 1,
      at: at("2026-11-20T18:50:11Z", 976771),
      count: 228,
      proof: { blocks: [{ height: 976779 }, { height: 976778 }] },
      signature: { ok: true },
    },
    { n: 2, at: at("2026-11-28T00:00:00Z", 977600), count: 240, proof: null, signature: null },
  ],
  bipChanges: [
    { at: at("2026-11-20T20:50:02Z", 976783) },
    { at: at("2026-12-02T00:00:00Z", 978100) },
  ],
  labRuns: [lab("2026-11-22T00:57:50Z", [true, true, false]), lab("2026-10-01T00:00:00Z", [true])],
  advisories: [
    { published: "2026-11-10T05:00:00Z", matches: [{ threat: "block-stalling" }] },
    { published: "2026-11-20T05:00:00Z", matches: [] },
    { published: "2024-10-08T00:00:00Z", matches: [{ threat: "block-stalling" }] },
  ],
};

test("months with any work, newest first", () => {
  assert.deepEqual(progressMonths(input), ["2026-12", "2026-11", "2026-10"]);
});

test("a month counts its own claims by change, and nothing from the next month", () => {
  const m = monthProgress(input, "2026-11");
  assert.deepEqual(m.claims, { created: 3, corrected: 1, revised: 1, withdrawn: 1 });
  assert.deepEqual(m.heights, { from: 976700, to: 977500 });
  assert.deepEqual(m.topics, [
    { slug: "segwit", created: 2, changed: 2 },
    { slug: "taproot", created: 1, changed: 1 },
  ]);
  assert.deepEqual(
    m.corrections.map((e) => e.claim),
    ["segwit.a"],
  );
});

test("runs are the month's, oldest first, and pages read count once", () => {
  const m = monthProgress(input, "2026-11");
  assert.deepEqual(
    m.runs.map((r) => [r.id, r.published, r.held, r.read]),
    [
      ["2026-11-20-seed-segwit", 1, 2, 2],
      ["2026-11-24-daily", 0, 0, 2],
    ],
  );
  assert.equal(m.read, 3);
});

test("the evaluator's decisions and test claims add up over the month's days", () => {
  assert.deepEqual(monthProgress(input, "2026-11").evaluator, {
    published: 3,
    held: 1,
    rejected: 5,
    canaries: 10,
    caught: 9,
  });
  assert.equal(monthProgress(input, "2026-10").evaluator, null);
});

test("editions show the first block that holds their proof and whether they are signed", () => {
  assert.deepEqual(
    monthProgress(input, "2026-11").editions.map((e) => [e.n, e.block, e.signed]),
    [
      [1, 976778, true],
      [2, null, false],
    ],
  );
});

test("BIP changes and lab runs belong to their month", () => {
  const m = monthProgress(input, "2026-11");
  assert.equal(m.bips, 1);
  assert.deepEqual(m.lab, [
    { at: "2026-11-22T00:57:50Z", version: "32.1", passed: 2, tests: 3, sha256: true },
  ]);
});

test("a month counts the advisories published in it, and how many are filed under a threat", () => {
  assert.deepEqual(monthProgress(input, "2026-11").advisories, { published: 2, filed: 1 });
  // An advisory from years ago never makes a month of its own: it is not Blocklore's work then.
  assert.deepEqual(progressMonths(input).includes("2024-10"), false);
  assert.deepEqual(monthProgress(input, "2026-12").advisories, { published: 0, filed: 0 });
});

test("a month with nothing in it is empty, not an error", () => {
  const m = monthProgress(input, "2027-01");
  assert.deepEqual(m.claims, { created: 0, corrected: 0, revised: 0, withdrawn: 0 });
  assert.equal(m.heights, null);
  assert.deepEqual([m.runs, m.editions, m.lab, m.topics], [[], [], [], []]);
});
