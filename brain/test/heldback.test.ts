import assert from "node:assert/strict";
import { test } from "node:test";
import { brokenRules, heldBack } from "@blocklore/core";
import { heldBackSection } from "../src/heldback.ts";

const decision = (id: string, rules: string | null, canary: unknown = null) => ({
  id,
  canary: canary as never,
  stages: [
    { stage: "recheck" as const, ok: true, detail: "found again" },
    ...(rules === null ? [] : [{ stage: "rules" as const, ok: false, detail: rules }]),
  ],
});

test("a recorded failure splits back into its rules, even where a rule's own text holds '; '", () => {
  assert.deepEqual(
    brokenRules(
      "independent sources: safety advice needs two independent sources supporting it; it has 1 (github.com/bitcoin); person attributed: Murch: not attributed with a link to where they said or did it",
    ),
    [
      {
        rule: "independent sources",
        detail:
          "safety advice needs two independent sources supporting it; it has 1 (github.com/bitcoin)",
      },
      {
        rule: "person attributed",
        detail: "Murch: not attributed with a link to where they said or did it",
      },
    ],
  );
  assert.deepEqual(brokenRules("held: primary evidence, dated"), []);
});

test("the rules research broke lately, most often first, with canaries and passes left out", () => {
  const rules = heldBack([
    decision("a.one", "person attributed: Ittay Eyal: not attributed with a link"),
    decision("a.two", "person attributed: Suhas Daftuar: not attributed with a link"),
    decision("a.three", "not settled: a argument is contested, never established"),
    decision("a.canary", "dated: a position is dated", { kind: "number" }),
    decision("a.passed", null),
  ]);
  assert.deepEqual(
    rules.map((r) => [r.rule, r.count, r.claim]),
    [
      ["person attributed", 2, "a.two"],
      ["not settled", 1, "a.three"],
    ],
  );
  const section = heldBackSection(rules).join("\n");
  assert.match(section, /^## What the evaluator held back lately/);
  assert.match(
    section,
    /- person attributed \(2\): Suhas Daftuar: not attributed with a link \(a\.two\)/,
  );
  assert.doesNotMatch(section, /canary|a\.canary/);
  assert.deepEqual(heldBackSection([]), []);
});
