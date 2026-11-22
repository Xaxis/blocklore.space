// The evaluator's test claims (canaries) as the publisher sees them. A canary is a deliberately
// false copy of a published claim (core/src/evaluate.ts, makeCanaries). Each is registered in
// var/evaluator/canaries.jsonl before it is written anywhere, and the publisher refuses any claim
// whose id or statement matches one before it writes a file (publish.ts, commitStore), so a canary
// cannot publish by any path: not through a batch, a research run, or the owner's approval.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Canary, statementPrint } from "@blocklore/core";
import { EVALUATOR_DIR } from "./env.ts";

export interface CanaryEntry {
  id: string;
  /** statementPrint of the canary's statement. */
  print: string;
  kind: string;
  source: string;
  batch: string;
  at: string;
}

const registryFile = (dir: string) => path.join(dir, "canaries.jsonl");

/** Every canary ever made, oldest first. */
export function canaryEntries(dir = EVALUATOR_DIR): CanaryEntry[] {
  const f = registryFile(dir);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as CanaryEntry];
      } catch {
        return [];
      }
    });
}

/** Registers canaries; the evaluator calls it before it writes any of them to a run folder. */
export function registerCanaries(
  canaries: readonly Canary[],
  batch: string,
  at: string,
  dir = EVALUATOR_DIR,
): void {
  if (canaries.length === 0) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lines = canaries.map((c) =>
    JSON.stringify({
      id: c.id,
      print: statementPrint(c.candidate.statement),
      kind: c.kind,
      source: c.source,
      batch,
      at,
    } satisfies CanaryEntry),
  );
  appendFileSync(registryFile(dir), `${lines.join("\n")}\n`, { mode: 0o600 });
}

/** The claims among these that are canaries, by id or by statement, each as a line saying which. */
export function canaryClash(
  claims: ReadonlyArray<{ id: string; statement: string }>,
  dir = EVALUATOR_DIR,
): string[] {
  const entries = canaryEntries(dir);
  if (entries.length === 0) return [];
  const ids = new Set(entries.map((e) => e.id));
  // Some canaries keep their source's statement (a swapped quote, a stance, a revoked claim), so
  // the claim a canary was copied from may keep its own words; any other claim with them may not.
  const prints = new Map<string, Set<string>>();
  for (const e of entries) prints.set(e.print, (prints.get(e.print) ?? new Set()).add(e.source));
  return claims.flatMap((c) => {
    if (ids.has(c.id)) return [`${c.id}: its id is a test claim's`];
    const sources = prints.get(statementPrint(c.statement));
    return sources && !sources.has(c.id) ? [`${c.id}: its statement is a test claim's`] : [];
  });
}
