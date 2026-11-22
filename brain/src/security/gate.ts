// The disclosure gate in the publish path (core/src/disclosure.ts; SECURITY.md, T9). The publisher
// screens every candidate a run proposed before anything else happens to it: one that may describe
// an undisclosed weakness is held here, privately, and leaves no trace in the public record. Not in
// knowledge/, not in the review counts, not among the run log's rejections, and when anything was
// held, the run's own prose (summary, reading list, open notes, injections) stays private too.
import {
  advisoryIds,
  type DisclosureContext,
  embargoReasons,
  type Run,
  type Store,
} from "@blocklore/core";
import type { ChainSource } from "../chain.ts";
import { checkClaim } from "../check.ts";
import type { Candidate, RunNotes, Verdict } from "../staging.ts";
import { type Pending, writePending } from "../store.ts";
import { hold, onRelease } from "./embargo.ts";

/**
 * What counts as public: the threat map's terms and history, the advisories the watch has seen,
 * and every CVE or GHSA id a published claim already names.
 */
export function disclosureContext(store: Store): DisclosureContext {
  const threats = store.security?.threats ?? [];
  const advisories = store.security?.watches?.watches.find((w) => w.id === "advisories");
  const items = advisories?.id === "advisories" ? (advisories.data?.items ?? []) : [];
  const ids = new Set<string>(
    [
      ...threats.flatMap((t) => [...t.terms, ...t.history.map((h) => `${h.ref} ${h.url}`)]),
      ...items.map((a) => `${a.title} ${a.url}`),
      ...store.claims.map((c) => c.statement),
    ].flatMap(advisoryIds),
  );
  return { knownTerms: threats.flatMap((t) => t.terms), knownIds: ids };
}

/**
 * Holds a candidate the gate stopped. When the verifier stood behind it and every check passed,
 * the item carries the review entry it would have had, so the owner's release can queue it for an
 * ordinary review; otherwise a release publishes nothing.
 */
export async function holdCandidate(input: {
  candidate: Candidate;
  reasons: string[];
  verdict: Verdict | undefined;
  runId: string;
  now: { time: string; height: number };
  chain: ChainSource;
  updates: boolean;
}): Promise<void> {
  const v = input.verdict;
  const final =
    v?.verdict === "revise" ? v.revised : v?.verdict === "accept" ? input.candidate : undefined;
  let pending: Pending | null = null;
  if (v && final && final.id === input.candidate.id) {
    const report = await checkClaim(final, input.chain);
    if (report.ok)
      pending = {
        candidate: final,
        reasons: ["held by the disclosure gate, released by the owner"],
        run: input.runId,
        proposed: input.now,
        verdict: v,
        method: report.method,
        updates: input.updates,
      };
  }
  const c = final ?? input.candidate;
  hold({
    kind: "research",
    key: `${c.id}\n${c.statement}`,
    title: `Research candidate ${c.id}`,
    reasons: input.reasons,
    text: [c.statement, ...c.sources.map((s) => `${s.title} ${s.url ?? ""}`)].join("\n"),
    detail: { run: input.runId, candidate: c, verdict: v ?? null, pending },
    at: input.now.time,
  });
  console.log(`publish: ${c.id} is embargoed for the owner (${input.reasons.join("; ")})`);
}

/**
 * The research notes as the public run log may show them. Skipped statements that read as
 * security findings are left out always; when anything in the run was held, the role's prose is
 * left out entirely, since it may describe what was held.
 */
export function publicNotes(
  notes: RunNotes | undefined,
  ctx: DisclosureContext,
  held: number,
): Pick<Run, "summary" | "read" | "injections"> & { skipped: RunNotes["skipped"]; open: string[] } {
  const skipped = (notes?.skipped ?? []).filter(
    (s) =>
      embargoReasons({ statement: `${s.statement} ${s.reason}`, sources: [] }, ctx).length === 0,
  );
  if (held > 0)
    return {
      summary: "The notes of this run are withheld while the owner reviews part of it.",
      read: [],
      injections: [],
      skipped,
      open: [],
    };
  return {
    summary: notes?.summary ?? "The run left no notes.",
    read: notes?.read ?? [],
    injections: notes?.injections ?? [],
    skipped,
    open: notes?.open ?? [],
  };
}

/** Releasing a research finding queues it for the owner's ordinary review, never straight out. */
onRelease("research", async (item) => {
  const d = item.detail as { pending: Pending | null } | null;
  if (!d?.pending) return "nothing to queue: the verifier or the checks did not pass it in its run";
  writePending(d.pending);
  return `queued ${d.pending.candidate.id} for review`;
});
