// What the evaluator's code held research's claims back on lately, told to the next research run so
// it stops writing claims that cannot publish. Only code's own reasons are used: they are exact, and
// a verifier's words are a model's. Canaries, the wrong claims the evaluator plants to test itself,
// are left out.
import { type Decision, EVALUATOR_RULES } from "@blocklore/core";

export interface HeldBack {
  rule: string;
  count: number;
  /** The latest failure of the rule, as code recorded it. */
  detail: string;
  claim: string;
}

const RULE_START = new RegExp(
  `(?:^|; )(${EVALUATOR_RULES.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}): `,
  "g",
);

/** A failed rules stage's detail, back into its rules. A rule's own text may hold "; ". */
export function brokenRules(detail: string): { rule: string; detail: string }[] {
  const starts = [...detail.matchAll(RULE_START)];
  return starts.map((m, i) => ({
    rule: m[1] as string,
    detail: detail
      .slice((m.index ?? 0) + m[0].length, starts[i + 1]?.index ?? detail.length)
      .trim(),
  }));
}

/** The rules broken in the last `recent` decisions, most often broken first. */
export function heldBack(
  decisions: Pick<Decision, "id" | "canary" | "stages">[],
  recent = 80,
): HeldBack[] {
  const by = new Map<string, HeldBack>();
  for (const d of decisions.slice(-recent)) {
    if (d.canary) continue;
    const failed = d.stages.find((s) => s.stage === "rules" && !s.ok);
    if (!failed) continue;
    for (const b of brokenRules(failed.detail)) {
      const cur = by.get(b.rule);
      by.set(b.rule, { rule: b.rule, count: (cur?.count ?? 0) + 1, detail: b.detail, claim: d.id });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

/** The task's section on them; empty when nothing was held back. */
export function heldBackSection(rules: HeldBack[]): string[] {
  if (!rules.length) return [];
  return [
    "## What the evaluator held back lately",
    "",
    'Code applied these rules (context/EDITORIAL.md, "The evaluator", and context/CLAIMS.md) to recent claims and held them back before any verifier read them. Each line is a rule, how many claims broke it, and its latest failure. A claim that breaks one never publishes, so write claims that pass them.',
    "",
    ...rules.map((r) => `- ${r.rule} (${r.count}): ${r.detail} (${r.claim})`),
    "",
  ];
}
