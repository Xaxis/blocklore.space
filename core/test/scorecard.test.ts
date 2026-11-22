import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compile } from "../src/bundle.ts";
import { loadStore } from "../src/node/load.ts";

const card = {
  at: { time: "2026-11-20T20:55:43Z", height: 976783 },
  golden: "b".repeat(64),
  questions: 200,
  claims: 0,
  retrieval: [{ kind: "all", n: 1, hit1: 1, hit5: 1, hit12: 1, must12: null, mrr: 1 }],
  misses: [],
  ask: null,
};

test("knowledge/bench.json reaches the bundle as the scorecard, and a bad one is an error", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "blocklore-scorecard-"));
  try {
    const knowledge = path.join(dir, "knowledge");
    mkdirSync(knowledge, { recursive: true });
    assert.equal(compile(loadStore(knowledge).store, card.at).bundle.scorecard, null);
    writeFileSync(path.join(knowledge, "bench.json"), JSON.stringify(card));
    const { store, issues } = loadStore(knowledge);
    assert.deepEqual(
      issues.filter((i) => i.level === "error"),
      [],
    );
    assert.deepEqual(compile(store, card.at).bundle.scorecard, card);
    writeFileSync(path.join(knowledge, "bench.json"), JSON.stringify({ ...card, golden: "x" }));
    const bad = loadStore(knowledge);
    assert.ok(bad.issues.some((i) => i.file === "knowledge/bench.json" && i.level === "error"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
