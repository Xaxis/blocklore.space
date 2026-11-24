// The drafts on one topic that the evaluator rejected for a reason the sources can fix, told to the
// next research run on that topic, so they are drafted again instead of lost: those code rejected by
// rule (a named person with no link to where they said it, safety advice with one source), and those
// a verifier judged fixable (its verdict "revise") with none rejecting them outright. As in
// heldback.ts only code's reasons are used, never a verifier's words: of a verifier, only which of
// the three verdicts code knows it chose, and the section explains a "revise" in code's own words. A
// verifier reads fetched pages, so its reason could carry what a page told it. The statement is
// research's own earlier draft, which passed the schema and style checks: not fetched text.
import { brokenRules, type Decision } from "@blocklore/core";

export interface Rejected {
  id: string;
  statement: string;
  at: string;
  /** The rules code found broken; empty for a draft a verifier judged fixable. */
  rules: { rule: string; detail: string }[];
  /** Set when verifiers, not rules, rejected it, and every one that failed it said "revise". */
  revise?: true;
}

/** The verdict a verifier stage records (`verdictStage`), never the reason after it. */
const verdictOf = (detail: string) => /^(accept|revise|reject):/.exec(detail)?.[1] ?? null;

/**
 * At most this many drafts of each kind (by rule, judged fixable) are listed, newest first, each
 * statement cut to this many characters.
 */
const MAX = 8;
const STATEMENT = 300;

/**
 * Each id on the topic whose latest real (not canary) decision was a rejection by the rules stage, or
 * by verifiers that each said "revise" (none "reject"), leaving out ids that are published or
 * waiting again (`taken`): those were drafted again already.
 */
export function rejectedOnTopic(
  decisions: readonly Pick<
    Decision,
    "id" | "topic" | "statement" | "at" | "canary" | "outcome" | "stages"
  >[],
  slug: string,
  taken: ReadonlySet<string>,
): Rejected[] {
  const last = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) if (!d.canary && d.topic === slug) last.set(d.id, d);
  const out: Rejected[] = [];
  for (const d of last.values()) {
    if (d.outcome !== "reject" || taken.has(d.id)) continue;
    const failed = d.stages.find((s) => s.stage === "rules" && s.ok === false);
    if (!failed) {
      const said = d.stages
        .filter((s) => s.stage.startsWith("verifier") && s.ok === false)
        .map((s) => verdictOf(s.detail));
      if (said.length && said.every((v) => v === "revise"))
        out.push({ id: d.id, statement: d.statement, at: d.at, rules: [], revise: true });
      continue;
    }
    const rules = brokenRules(failed.detail);
    if (!rules.length) continue;
    out.push({ id: d.id, statement: d.statement, at: d.at, rules });
  }
  out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return [
    ...out.filter((r) => !r.revise).slice(0, MAX),
    ...out.filter((r) => r.revise).slice(0, MAX),
  ];
}

/** The task's sections on them; empty when there are none. */
export function rejectedSection(rejected: Rejected[]): string[] {
  const cut = (s: string) =>
    s.length > STATEMENT ? `${s.slice(0, STATEMENT - 3).trimEnd()}...` : s;
  const byRule = rejected.filter((r) => !r.revise);
  const fixable = rejected.filter((r) => r.revise);
  return [
    ...(byRule.length
      ? [
          "## Drafts on this topic the evaluator rejected by rule",
          "",
          "Code rejected these earlier drafts for the rules named, before any verifier read them; they are not published and not waiting. Where your sources can meet the rule, you may draft the claim again under the same id with the fix. Where they cannot, leave it.",
          "",
          ...byRule.flatMap((r) => [
            `- \`${r.id}\`: ${cut(r.statement)}`,
            ...r.rules.map((b) => `  - ${b.rule}: ${b.detail}`),
          ]),
          "",
        ]
      : []),
    ...(fixable.length
      ? [
          "## Drafts on this topic a verifier judged fixable",
          "",
          "Two verifiers on other models read these earlier drafts against their sources. At least one judged each fixable but not supported as worded, and none rejected it outright; they are not published and not waiting. The usual faults are saying more than the quoted passages do (a generalization, or an added date, number or cause) and naming something wrong, such as a BIP number. Read the sources again: you may draft one again under the same id if every part of it is in a passage you quote. Otherwise leave it.",
          "",
          ...fixable.map((r) => `- \`${r.id}\`: ${cut(r.statement)}`),
          "",
        ]
      : []),
  ];
}
