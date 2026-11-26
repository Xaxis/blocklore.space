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
import { type Pending, readPending, removePending, writePending } from "../store.ts";
import { hold, lift, listEmbargo, onRelease } from "./embargo.ts";

/** The reason a released finding waits for review with; the gate lets such a claim through. */
export const RELEASED = "held by the disclosure gate, released by the owner";

/**
 * The reason a claim waits for review with once the gate lifted its own hold (`liftHolds`). Unlike
 * a release it earns no pass: the gate screens the claim again each time, as it does any other.
 */
export const LIFTED = "held by the disclosure gate, lifted when what is public no longer held it";

/**
 * What counts as public: the threat map's terms and history, the advisories the watch has seen
 * (its latest reading and every advisory it has kept in knowledge/security/advisories.json), and
 * every CVE or GHSA id a published claim already names.
 */
export function disclosureContext(store: Store): DisclosureContext {
  const threats = store.security?.threats ?? [];
  const advisories = store.security?.watches?.watches.find((w) => w.id === "advisories");
  const items = advisories?.id === "advisories" ? (advisories.data?.items ?? []) : [];
  const ids = new Set<string>(
    [
      ...threats.flatMap((t) => [...t.terms, ...t.history.map((h) => `${h.ref} ${h.url}`)]),
      ...items.map((a) => `${a.title} ${a.url}`),
      ...(store.security?.advisories?.advisories ?? []).map(
        (a) => `${a.title} ${a.url} ${a.ids.join(" ")}`,
      ),
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
        reasons: [RELEASED],
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
 * Holds a claim that already waited in the review queue (it waited from before the gate, or what
 * counts as public changed since) and takes it out of the queue. A release queues it again, marked
 * released, with its review entry as it was.
 */
export function holdPending(p: Pending, reasons: string[], at: string): void {
  const c = p.candidate;
  hold({
    kind: "research",
    key: `${c.id}\n${c.statement}`,
    title: `Research candidate ${c.id}`,
    reasons,
    text: [c.statement, ...c.sources.map((s) => `${s.title} ${s.url ?? ""}`)].join("\n"),
    detail: {
      run: p.run,
      candidate: c,
      verdict: p.verdict,
      pending: { ...p, reasons: [...p.reasons.filter((r) => r !== RELEASED), RELEASED] },
    },
    at,
  });
  removePending(c.id);
  console.log(`evaluator: ${c.id} is embargoed for the owner (${reasons.join("; ")})`);
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

/**
 * Lifts the holds the gate would no longer make. A research candidate is held when it reads as a
 * security finding and nothing public names what it describes; once something does (an advisory the
 * watch has kept, a threat's term, a CVE a published claim names, a disclosure source the gate has
 * learned to recognize), the same rule passes it. Code made the hold, so code lifts it, and the
 * candidate goes where a new one would, only further: to the review queue, where the gate screens
 * it again, the evaluator rechecks it and two verifiers read it. A lab finding, and anything the
 * rule still holds, waits for the owner. A draft whose claim has moved on is closed, not queued: a
 * newer draft already waits, or a later one published.
 */
export function liftHolds(
  ctx: DisclosureContext,
  published: ReadonlySet<string>,
  at: string,
): { lifted: number; queued: string[] } {
  const waiting = new Set(readPending().map((p) => p.candidate.id));
  const queued: string[] = [];
  let lifted = 0;
  for (const item of listEmbargo()) {
    if (item.kind !== "research") continue;
    const d = item.detail as { candidate?: Candidate; pending?: Pending | null } | null;
    const texts = [d?.candidate, d?.pending?.candidate].filter((c): c is Candidate => !!c);
    if (texts.length === 0 || texts.some((c) => embargoReasons(c, ctx).length > 0)) continue;
    const p = d?.pending ?? null;
    const id = p?.candidate.id;
    let note = "lifted: nothing to queue, the verifier or the checks did not pass it in its run";
    if (p && id && waiting.has(id))
      note = `lifted: a newer draft of ${id} already waits for review`;
    else if (p && id && !p.updates && published.has(id))
      note = `lifted: ${id} has published since from a later draft`;
    else if (p && id) {
      writePending({
        ...p,
        reasons: [...p.reasons.filter((r) => r !== RELEASED && r !== LIFTED), LIFTED],
      });
      queued.push(id);
      note = `lifted: queued ${id} for review`;
    }
    lift(item, at, note);
    lifted++;
    console.log(`disclosure: ${note}`);
  }
  return { lifted, queued };
}
