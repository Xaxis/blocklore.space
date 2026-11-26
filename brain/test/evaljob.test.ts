// The evaluator's session runs batch after batch (brain/src/evaljob.ts): these are the limits that
// stop it, so a long queue drains inside the owner's minutes and nothing repeats a failure.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "@blocklore/core/control";

const ROOT = mkdtempSync(path.join(tmpdir(), "bl-evaljob-"));
process.env.BLOCKLORE_CONTROL_DIR = path.join(ROOT, "control");
process.env.BLOCKLORE_EVALUATOR_DIR = path.join(ROOT, "evaluator");
const { stopAfter } = await import("../src/evaljob.ts");

const batch = (over: Partial<{ publishing: boolean; trouble: string | null }> = {}) => ({
  batch: "2026-11-26-evaluate-0123456789",
  message: "2026-11-26-evaluate-0123456789: 3 to publish, 0 held, 5 rejected",
  decisions: [],
  publishing: true,
  trouble: null,
  ...over,
});
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const go = { settings: settings(), outcome: batch(), applied: true, elapsed: 20, longest: 15 };

test("a session runs another batch while claims are due and one fits in its minutes", () => {
  assert.equal(stopAfter(go), null);
  // 75 minutes by default: at 59 with batches of 15 one more fits, at 61 it does not.
  assert.equal(stopAfter({ ...go, elapsed: 59 }), null);
  assert.equal(
    stopAfter({ ...go, elapsed: 61 }),
    "another batch would not finish inside the 75 minutes a session may take",
  );
  const short = settings({ usage: { ...DEFAULT_SETTINGS.usage, sessionMinutes: 30 } });
  assert.match(stopAfter({ ...go, settings: short }) ?? "", /inside the 30 minutes/);
});

test("a session stops on what another batch would only repeat, or when the owner steps in", () => {
  const none = { batch: null, message: "nothing waits for the evaluator", decisions: [] as [] };
  assert.equal(stopAfter({ ...go, outcome: none }), "nothing waits for the evaluator");
  assert.equal(stopAfter({ ...go, applied: false }), "the batch did not apply");
  assert.equal(
    stopAfter({ ...go, outcome: batch({ trouble: "the opus session ended error_max_turns" }) }),
    "the opus session ended error_max_turns",
  );
  assert.match(stopAfter({ ...go, outcome: batch({ publishing: false }) }) ?? "", /paused/);
  assert.equal(
    stopAfter({ ...go, settings: settings({ paused: true }) }),
    "the owner paused the brain",
  );
  const owner = settings({ evaluator: { ...DEFAULT_SETTINGS.evaluator, decides: "owner" } });
  assert.equal(stopAfter({ ...go, settings: owner }), "the owner now decides gated claims");
});
