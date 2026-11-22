// The gate (EDITORIAL.md, "The evaluator"). Code decides, not a model: it classifies each claim,
// and its reasons choose how much scrutiny the claim gets before it publishes. A claim with no
// reason publishes after the research run's checks and verifier; a gated claim goes to the
// evaluator (core/src/evaluate.ts, brain/src/evaluator.ts), which adds the rules for each reason
// below and two independent verifiers. The owner changes these rules by changing this file.
import type { Claim, Topic } from "./schema.ts";

export type GateTopic = Pick<Topic, "slug" | "contested" | "safety">;

type GateInput = Pick<Claim, "topics" | "status" | "kind" | "people" | "statement">;

/** What a gate reason asks the evaluator to check for. */
export type Scrutiny =
  /** A contested topic or subject, or status contested: neutrality rules. */
  | "contested"
  /** A safety topic: two independent sources and no advice voice. */
  | "safety"
  /** A stance or an argument: attributed, dated, in the holders' own words. */
  | "position"
  /** It names a person: named as listed, attributed with a link, their words or a primary record. */
  | "person";

export interface GateReason {
  scrutiny: Scrutiny;
  /** The reason in words, as the review record and the run log keep it. */
  text: string;
}

const wholeWord = (term: string) =>
  new RegExp(
    `(^|[^A-Za-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_])`,
    "i",
  );

/** Every reason the gate holds a claim for, each with the scrutiny it calls for. */
export function gate(
  claim: GateInput,
  topics: ReadonlyMap<string, GateTopic>,
  contestedTerms: readonly string[] = [],
): GateReason[] {
  const out: GateReason[] = [];
  for (const term of contestedTerms)
    if (wholeWord(term).test(claim.statement))
      out.push({ scrutiny: "contested", text: `contested subject: ${term}` });
  for (const slug of claim.topics) {
    const t = topics.get(slug);
    if (t?.contested) out.push({ scrutiny: "contested", text: `contested topic: ${slug}` });
    if (t?.safety) out.push({ scrutiny: "safety", text: `safety topic: ${slug}` });
  }
  if (claim.status === "contested") out.push({ scrutiny: "contested", text: "contested status" });
  if (claim.kind === "stance") out.push({ scrutiny: "position", text: "a stance" });
  if (claim.kind === "argument") out.push({ scrutiny: "position", text: "an argument" });
  if (claim.people.length > 0)
    out.push({ scrutiny: "person", text: `names ${claim.people.join(", ")}` });
  return out;
}

export function gateReasons(
  claim: GateInput,
  topics: ReadonlyMap<string, GateTopic>,
  contestedTerms: readonly string[] = [],
): string[] {
  return gate(claim, topics, contestedTerms).map((r) => r.text);
}

/** The kinds of scrutiny a claim's gate reasons call for. */
export function scrutinyOf(reasons: readonly GateReason[]): Set<Scrutiny> {
  return new Set(reasons.map((r) => r.scrutiny));
}
