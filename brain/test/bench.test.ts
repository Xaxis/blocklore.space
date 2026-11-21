import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScorecard, type RetrievalRow, retrievalStats } from "../src/bench.ts";

const r = (id: string, kind: RetrievalRow["kind"], rank: number | null, must = true) => ({
  id,
  kind,
  rank,
  must,
  top: [],
});

test("retrieval stats count ranks per kind, with every kind first as all", () => {
  const rows = [
    r("g001", "covered", 1),
    r("g002", "covered", 3),
    r("g003", "covered", null, false),
    r("g004", "covered", 8),
    r("g005", "value", 2),
  ];
  const [all, covered, value, ...rest] = retrievalStats(rows);
  assert.deepEqual(all, {
    kind: "all",
    n: 5,
    hit1: 0.2,
    hit5: 0.6,
    hit12: 0.8,
    must12: 0.8,
    mrr: 0.3917,
  });
  assert.equal(covered?.n, 4);
  assert.equal(covered?.hit5, 0.5);
  assert.equal(value?.hit1, 0);
  assert.deepEqual(rest, []);
});

test("the scorecard measures retrieval only: no model answers anything", () => {
  const at = { time: "2026-11-20T20:55:43Z", height: 976783 };
  const golden = "a".repeat(64);
  const questions = ["g001", "g002", "g003"].map((id) => ({
    id,
    q: `question ${id}?`,
    kind: "covered" as const,
    expect: [],
  }));
  const rows = [r("g003", "covered", null), r("g001", "covered", 1), r("g002", "covered", 7)];
  const card = buildScorecard({ at, golden, questions, claims: 10, rows });
  assert.deepEqual(
    card.misses.map((m) => [m.id, m.rank]),
    [
      ["g002", 7],
      ["g003", null],
    ],
  );
  assert.equal(card.claims, 10);
  assert.equal(card.ask, null);
});
