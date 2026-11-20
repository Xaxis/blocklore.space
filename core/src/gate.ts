// The human gate (EDITORIAL.md, "The human gate"). Code decides, not a model: a claim waits for the
// owner's review when any reason below applies. The owner loosens these rules over time by
// changing this file.
import type { Claim, Topic } from "./schema.ts";

export type GateTopic = Pick<Topic, "slug" | "contested" | "safety">;

export function gateReasons(
  claim: Pick<Claim, "topics" | "status" | "kind" | "people" | "statement">,
  topics: ReadonlyMap<string, GateTopic>,
  contestedTerms: readonly string[] = [],
): string[] {
  const reasons: string[] = [];
  for (const term of contestedTerms) {
    const re = new RegExp(
      `(^|[^A-Za-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_])`,
      "i",
    );
    if (re.test(claim.statement)) reasons.push(`contested subject: ${term}`);
  }
  for (const slug of claim.topics) {
    const t = topics.get(slug);
    if (t?.contested) reasons.push(`contested topic: ${slug}`);
    if (t?.safety) reasons.push(`safety topic: ${slug}`);
  }
  if (claim.status === "contested") reasons.push("contested status");
  if (claim.kind === "stance") reasons.push("a stance");
  if (claim.kind === "argument") reasons.push("an argument");
  if (claim.people.length > 0) reasons.push(`names ${claim.people.join(", ")}`);
  return reasons;
}
