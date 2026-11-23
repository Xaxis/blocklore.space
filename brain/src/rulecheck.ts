// The evaluator's code rules, told to research while it can still repair (ARCHITECTURE.md, "Data
// flow of one claim"). The evaluator rejects a gated claim that breaks one of the rules in
// core/src/evaluate.ts, and that rejection is final for the draft. Research's own checks used to
// cover only quotes, chain and code, so a draft that named a person without a link, or gave safety
// advice from one publisher, passed every check, waited for the evaluator, and was thrown away.
//
// checkRun adds these as errors to the check report research repairs from. They never decide
// anything: a draft that still breaks a rule after the repairs goes on as before, and the gate and
// the evaluator (or the owner, when they hold gated claims for themselves) decide it.
import { gate, type Issue, scrutinyOf, structuralRules } from "@blocklore/core";
import type { ClaimReport } from "./check.ts";
import { gateTopics } from "./publish.ts";
import type { Candidate } from "./staging.ts";
import type { Policy } from "./store.ts";

export const RULES_WHERE = "evaluator rules";

/** The rules a candidate would break once the gate marks it, as errors for the check report. */
export function ruleIssues(c: Candidate, policy: Policy): Issue[] {
  const reasons = gate(c, gateTopics(policy, c.topics), policy.contested_terms);
  if (!reasons.length) return [];
  return structuralRules(c, scrutinyOf(reasons))
    .filter((r) => !r.ok)
    .map((r) => ({
      level: "error" as const,
      where: RULES_WHERE,
      message: `${r.rule}: ${r.detail}. The gate marks this claim (${reasons.map((x) => x.text).join("; ")}), and the evaluator rejects a marked claim that breaks this rule: fix it, or delete the claim.`,
    }));
}

/** Whether a report passes every check but the evaluator's rules, which only the evaluator applies. */
export function passesChecks(r: ClaimReport): boolean {
  return (
    r.issues.every((i) => i.level !== "error" || i.where === RULES_WHERE) &&
    r.sources.every((s) => s.ok) &&
    r.checks.every((k) => k.ok)
  );
}
