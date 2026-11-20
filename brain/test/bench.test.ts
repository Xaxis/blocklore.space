import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scorecard } from "@blocklore/core";
import {
  type AskRow,
  askStats,
  buildScorecard,
  type RetrievalRow,
  retrievalStats,
} from "../src/bench.ts";

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

const a = (id: string, kind: AskRow["kind"], pass: boolean | null, verdict: string | null) =>
  ({
    id,
    kind,
    q: `question ${id}?`,
    mode: verdict ? "answer" : "model_declined",
    verdict,
    cites: [],
    pass,
    grounded: kind === "covered" ? pass : null,
    must: null,
    micros: 1000,
    ms: Number(id.slice(1)) * 100,
    text: "",
  }) as AskRow;

test("answer stats leave value questions unscored and count verdicts", () => {
  const rows = [
    a("g001", "covered", true, "answered"),
    a("g002", "covered", false, "partial"),
    a("g003", "value", null, "answered"),
    a("g004", "refuse", true, null),
  ];
  const [all, covered, value, refuse] = askStats(rows);
  assert.equal(all?.pass, 0.6667);
  assert.deepEqual(all?.verdicts, { answered: 2, model_declined: 1, partial: 1 });
  assert.equal(covered?.grounded, 0.5);
  assert.equal(value?.pass, null);
  assert.equal(refuse?.pass, 1);
});

test("the scorecard keeps the last scored answers until a full run replaces them", () => {
  const at = { time: "2026-11-20T20:55:43Z", height: 976783 };
  const golden = "a".repeat(64);
  const questions = ["g001", "g002", "g003"].map((id) => ({
    id,
    q: `question ${id}?`,
    kind: "covered" as const,
    expect: [],
  }));
  const rows = [r("g003", "covered", null), r("g001", "covered", 1), r("g002", "covered", 7)];
  const scored = buildScorecard({
    at,
    golden,
    questions,
    claims: 10,
    rows,
    ask: {
      ran: "2026-11-20T21:30:00Z",
      usd: 3.456,
      rows: [a("g002", "covered", false, "partial"), a("g001", "covered", true, "answered")],
    },
    previous: null,
  });
  assert.deepEqual(
    scored.misses.map((m) => [m.id, m.rank]),
    [
      ["g002", 7],
      ["g003", null],
    ],
  );
  assert.equal(scored.ask?.usd, 3.46);
  assert.deepEqual(scored.ask?.failed, [
    { id: "g002", kind: "covered", q: "question g002?", got: "partial" },
  ]);
  assert.match(scored.ask?.ask ?? "", /^[0-9a-f]{64}$/);

  const later = { time: "2026-11-27T05:10:00Z", height: 977800 };
  const weekly: Scorecard = buildScorecard({
    at: later,
    golden,
    questions,
    claims: 12,
    rows,
    ask: null,
    previous: scored,
  });
  assert.equal(weekly.claims, 12);
  assert.deepEqual(weekly.at, later);
  assert.deepEqual(weekly.ask, scored.ask);
  assert.equal(
    buildScorecard({ at, golden, questions, claims: 1, rows, ask: null, previous: null }).ask,
    null,
  );
});
