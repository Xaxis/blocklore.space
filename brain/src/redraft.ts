// The drafts on one topic that the evaluator's code rejected by rule, told to the next research run
// on that topic, so a claim that failed for a reason the sources can fix (a named person with no
// link to where they said it, safety advice with one source) is drafted again instead of lost. As
// in heldback.ts only code's reasons are used, never a verifier's words. The statement is research's
// own earlier draft, which passed the schema and style checks: not fetched text, not a verifier's.
import type { Decision } from "@blocklore/core";
import { brokenRules } from "./heldback.ts";

export interface Rejected {
  id: string;
  statement: string;
  at: string;
  rules: { rule: string; detail: string }[];
}

/** At most this many drafts are listed, newest first, each statement cut to this many characters. */
const MAX = 8;
const STATEMENT = 300;

/**
 * Each id on the topic whose latest real (not canary) decision was a rejection by the rules stage,
 * leaving out ids that are published or waiting again (`taken`): those were drafted again already.
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
    if (!failed) continue;
    const rules = brokenRules(failed.detail);
    if (!rules.length) continue;
    out.push({ id: d.id, statement: d.statement, at: d.at, rules });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, MAX);
}

/** The task's section on them; empty when there are none. */
export function rejectedSection(rejected: Rejected[]): string[] {
  if (!rejected.length) return [];
  const cut = (s: string) =>
    s.length > STATEMENT ? `${s.slice(0, STATEMENT - 3).trimEnd()}...` : s;
  return [
    "## Drafts on this topic the evaluator rejected by rule",
    "",
    "Code rejected these earlier drafts for the rules named, before any verifier read them; they are not published and not waiting. Where your sources can meet the rule, you may draft the claim again under the same id with the fix. Where they cannot, leave it.",
    "",
    ...rejected.flatMap((r) => [
      `- \`${r.id}\`: ${cut(r.statement)}`,
      ...r.rules.map((b) => `  - ${b.rule}: ${b.detail}`),
    ]),
    "",
  ];
}
