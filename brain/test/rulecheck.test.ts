// The evaluator's rules in research's check report (brain/src/rulecheck.ts): a draft the gate will
// mark learns which rule it breaks while research can still repair it, and nothing else changes.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim } from "@blocklore/core";
import { claim } from "../../core/test/fixtures.ts";
import type { ClaimReport } from "../src/check.ts";
import { passesChecks, RULES_WHERE, ruleIssues } from "../src/rulecheck.ts";
import type { Candidate } from "../src/staging.ts";
import type { Policy } from "../src/store.ts";

const policy: Policy = {
  topics: {
    "p2p-network": { contested: false, safety: false },
    "self-custody": { contested: false, safety: true },
  },
  contested_terms: ["CTV"],
};

const draft = (over: Partial<Claim>): Candidate =>
  claim({ id: "p2p-network.addrman", topics: ["p2p-network"], ...over }) as unknown as Candidate;

const rules = (c: Candidate) => ruleIssues(c, policy).map((i) => i.message.split(":")[0]);

test("a draft the gate does not mark gets no rule issues", () => {
  assert.deepEqual(ruleIssues(draft({}), policy), []);
});

test("naming a person without a link is the rule the evaluator rejected most last week", () => {
  const c = draft({
    statement: "Pieter Wuille wrote the first version of the address manager in 2012.",
    people: ["Pieter Wuille"],
  });
  assert.ok(rules(c).includes("person attributed"));
  const issue = ruleIssues(c, policy)[0];
  assert.equal(issue?.level, "error");
  assert.equal(issue?.where, RULES_WHERE);
  assert.match(issue?.message ?? "", /names Pieter Wuille/);
  assert.match(issue?.message ?? "", /fix it, or delete the claim/);
  // attributed with a link to a cited source in their words: nothing left to repair
  const fixed = draft({
    statement: "Pieter Wuille wrote the first version of the address manager in 2012.",
    people: ["Pieter Wuille"],
    attributed_to: [
      {
        name: "Pieter Wuille",
        url: "https://github.com/bitcoin/bitcoin/blob/0123456789abcdef0123456789abcdef01234567/src/validation.cpp#L1",
      },
    ],
  });
  assert.ok(!rules(fixed).includes("person attributed"));
});

test("safety advice from one publisher breaks the independent sources rule", () => {
  const c = draft({ id: "self-custody.backup", topics: ["self-custody"] });
  assert.ok(rules(c).includes("independent sources"));
});

test("a topic the policy does not list is treated as contested, as the publisher treats it", () => {
  const settled = draft({ id: "script.opcodes", topics: ["script"] });
  // a plain fact on a contested topic breaks no rule
  assert.deepEqual(ruleIssues(settled, policy), []);
  // a predicted outcome does, and only because the unlisted topic counts as contested
  const predicted = draft({
    id: "script.op-cat",
    topics: ["script"],
    statement: "OP_CAT will be activated on mainnet.",
  });
  const issues = ruleIssues(predicted, policy);
  assert.deepEqual(
    issues.map((i) => i.message.split(":")[0]),
    ["no predicted outcome"],
  );
  assert.match(issues[0]?.message ?? "", /contested topic: script/);
  assert.deepEqual(ruleIssues({ ...predicted, topics: ["p2p-network"] }, policy), []);
});

const report = (over: Partial<ClaimReport>): ClaimReport => ({
  id: "p2p-network.addrman",
  ok: false,
  issues: [],
  sources: [{ index: 0, ok: true, quoteFound: true, injections: [] }],
  checks: [],
  method: "quotes 1/1",
  ...over,
});

test("a draft that breaks only an evaluator rule still goes on to the verifier and the evaluator", () => {
  const ruled = report({
    issues: [{ level: "error", where: RULES_WHERE, message: "person attributed: no link" }],
  });
  assert.equal(passesChecks(ruled), true);
  assert.equal(
    passesChecks(
      report({ issues: [{ level: "warning", where: "statement", message: "a hedge word" }] }),
    ),
    true,
  );
  assert.equal(
    passesChecks(
      report({
        issues: ruled.issues,
        sources: [{ index: 0, ok: false, quoteFound: false, injections: [], error: "not found" }],
      }),
    ),
    false,
  );
  assert.equal(
    passesChecks(
      report({ issues: [{ level: "error", where: "schema", message: "missing depth" }] }),
    ),
    false,
  );
});
