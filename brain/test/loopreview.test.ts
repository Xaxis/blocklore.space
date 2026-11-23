import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "@blocklore/core/control";
import { compileLoopReview } from "@blocklore/core/loopreview";
import {
  latestLoopReview,
  loopReviewStamp,
  reviewText,
  runLogs,
  writeLoopReview,
} from "../src/loopreview.ts";

const review = (week: string, at: string) =>
  compileLoopReview({
    week,
    at,
    sessions: [],
    runs: [],
    decisions: [],
    rechecks: {},
    reports: [],
    agenda: [{ slug: "segwit", title: "SegWit" }],
    gaps: [],
    pending: [],
    claims: [],
    subscription: true,
    settings: { ...DEFAULT_SETTINGS, research: { ...DEFAULT_SETTINGS.research, mode: "daily" } },
  });

test("run logs are read as the review needs them, and a broken one is skipped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bl-runs-"));
  mkdirSync(path.join(dir, "2026"));
  writeFileSync(
    path.join(dir, "2026", "2026-11-20-seed-segwit.yaml"),
    [
      "id: 2026-11-20-seed-segwit",
      "kind: seed",
      "started:",
      "  time: 2026-11-20T17:33:05Z",
      "  height: 976761",
      "finished:",
      "  time: 2026-11-20T18:01:23Z",
      "  height: 976764",
      "published: [segwit.a, segwit.b]",
      "revised: []",
      "rejected:",
      "  - statement: x",
      "    reason: the verifier said no",
      "gated:",
      "  - topic: segwit",
      "    count: 2",
      "    reasons: [contested]",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(dir, "2026", "2026-11-21-broken.yaml"), "id: [unclosed\n");
  const runs = runLogs(dir);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0]?.started, { time: "2026-11-20T17:33:05Z" });
  assert.deepEqual(runs[0]?.published, ["segwit.a", "segwit.b"]);
  assert.equal(runs[0]?.gated[0]?.count, 2);
  assert.deepEqual(runLogs(path.join(dir, "none")), []);
});

test("the latest week's review is the one the daemon carries, and writing one changes the stamp", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bl-reviews-"));
  assert.equal(latestLoopReview(dir), null);
  assert.equal(loopReviewStamp(dir), "");
  writeLoopReview(review("2026-11-09", "2026-11-16T05:10:00Z"), dir);
  const first = loopReviewStamp(dir);
  writeLoopReview(review("2026-11-16", "2026-11-23T05:10:00Z"), dir);
  assert.notEqual(loopReviewStamp(dir), first);
  const latest = latestLoopReview(dir);
  assert.equal(latest?.week, "2026-11-16");
  assert.equal(latest?.findings[0]?.code, "research.starved");
  writeFileSync(path.join(dir, "2026-11-23.json"), '{"v": 1}\n');
  assert.throws(() => latestLoopReview(dir), /is not a LoopReview/);
});

test("the text names each finding, its evidence and its proposal", () => {
  const text = reviewText(review("2026-11-16", "2026-11-23T05:10:00Z")).join("\n");
  assert.match(text, /^Weekly review of the loop: the week of 2026-11-16 \(to 2026-11-23\)/);
  assert.match(text, /Research {4}0 sessions this week, 0 failed; none has ever run/);
  assert.match(text, /1\. \[research\.starved\] No research session has run\./);
  assert.match(
    text,
    /proposal: Start a research session now, on the planner's pick \(research\.start/,
  );
  assert.match(text, /2\. \[agenda\.stale\] 1 of 1 agenda topics has had no research session/);
});
