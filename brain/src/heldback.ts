// What the evaluator's code held research's claims back on lately, told to the next research run so
// it stops writing claims that cannot publish. The counting is `heldBack` in core/src/evaluate.ts
// (the weekly review of the loop reads the same); this is the task's wording of it.
import type { HeldBack } from "@blocklore/core";

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
