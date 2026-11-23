// A month of Blocklore's work, compiled from its own public record: the store's change events, the
// research log, the evaluator's record, the sealed editions, the BIP index and the security lab.
// Every number is a count of things a reader can open and check, so the month's report is proof of
// work that needs no trust. Pure: no clock, no files.

import type { ChangeEvent } from "./replay.ts";
import type { EvaluatorRecord, Run, Stamp } from "./schema.ts";
import type { LabProject, LabRun } from "./security.ts";

/** The parts of a sealed edition the report reads. */
export interface ProgressEdition {
  n: number;
  at: Stamp;
  count: number;
  proof: { blocks: { height: number }[] } | null;
  signature: { ok: boolean } | null;
}

export interface ProgressInput {
  events: readonly ChangeEvent[];
  runs: readonly Run[];
  evaluatorDays: EvaluatorRecord["days"];
  editions: readonly ProgressEdition[];
  bipChanges: readonly { at: Stamp }[];
  labRuns: readonly LabRun[];
  /** Advisories the security watch read, each with the threats it was filed under. */
  advisories?: readonly { published: string; matches: readonly unknown[] }[];
}

export interface MonthProgress {
  /** YYYY-MM, UTC. */
  month: string;
  /** Lowest and highest block heights of the month's store events, or null with none. */
  heights: { from: number; to: number } | null;
  claims: { created: number; corrected: number; revised: number; withdrawn: number };
  /** Topics the month's events touched, most new claims first. */
  topics: { slug: string; created: number; changed: number }[];
  /** Every correction, oldest first: they change what a reader may already believe. */
  corrections: ChangeEvent[];
  /** Research and verification runs started in the month, oldest first. */
  runs: {
    id: string;
    kind: Run["kind"];
    published: number;
    revised: number;
    rejected: number;
    held: number;
    read: number;
  }[];
  /** Distinct pages the month's runs read. */
  read: number;
  /** The evaluator's decisions on real claims, and its test claims caught; null before its first. */
  evaluator: {
    published: number;
    held: number;
    rejected: number;
    canaries: number;
    caught: number;
  } | null;
  /** Editions sealed in the month, oldest first. */
  editions: { n: number; at: Stamp; count: number; block: number | null; signed: boolean }[];
  /** Changes the BIP index showed in the month. */
  bips: number;
  /** Releases tested in the lab in the month, Bitcoin Core's and LND's, oldest first. */
  lab: {
    at: string;
    project: LabProject;
    version: string;
    passed: number;
    tests: number;
    sha256: boolean;
  }[];
  /** Advisories the projects published in the month, and how many are filed under a threat. */
  advisories: { published: number; filed: number };
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** Every month with any recorded work, newest first. */
export function progressMonths(input: ProgressInput): string[] {
  const months = new Set<string>([
    ...input.events.map((e) => monthOf(e.at.time)),
    ...input.runs.map((r) => monthOf(r.started.time)),
    ...input.evaluatorDays.map((d) => monthOf(d.day)),
    ...input.editions.map((s) => monthOf(s.at.time)),
    ...input.bipChanges.map((c) => monthOf(c.at.time)),
    ...input.labRuns.map((l) => monthOf(l.at)),
  ]);
  return [...months].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort((a, b) => b.localeCompare(a));
}

/** The month `month` (YYYY-MM) of Blocklore's work. */
export function monthProgress(input: ProgressInput, month: string): MonthProgress {
  const inMonth = (iso: string) => monthOf(iso) === month;
  const events = input.events
    .filter((e) => inMonth(e.at.time))
    .sort((a, b) => a.at.time.localeCompare(b.at.time) || a.claim.localeCompare(b.claim));
  const claims = { created: 0, corrected: 0, revised: 0, withdrawn: 0 };
  const topics = new Map<string, { created: number; changed: number }>();
  for (const e of events) {
    if (e.change === "created") claims.created++;
    else if (e.change === "corrected") claims.corrected++;
    else if (e.change === "withdrawn") claims.withdrawn++;
    else claims.revised++;
    const t = e.topics[0];
    if (!t) continue;
    const row = topics.get(t) ?? { created: 0, changed: 0 };
    if (e.change === "created") row.created++;
    else row.changed++;
    topics.set(t, row);
  }
  const heights = events.length
    ? {
        from: Math.min(...events.map((e) => e.at.height)),
        to: Math.max(...events.map((e) => e.at.height)),
      }
    : null;

  const runs = input.runs
    .filter((r) => inMonth(r.started.time))
    .sort((a, b) => a.started.time.localeCompare(b.started.time) || a.id.localeCompare(b.id));
  const read = new Set(runs.flatMap((r) => r.read.map((x) => x.url)));

  const days = input.evaluatorDays.filter((d) => inMonth(d.day));
  const evaluator = days.length
    ? days.reduce(
        (acc, d) => ({
          published: acc.published + d.published,
          held: acc.held + d.held,
          rejected: acc.rejected + d.rejected,
          canaries: acc.canaries + d.canaries,
          caught: acc.caught + d.caught,
        }),
        { published: 0, held: 0, rejected: 0, canaries: 0, caught: 0 },
      )
    : null;

  return {
    month,
    heights,
    claims,
    topics: [...topics]
      .map(([slug, n]) => ({ slug, ...n }))
      .sort(
        (a, b) => b.created - a.created || b.changed - a.changed || a.slug.localeCompare(b.slug),
      ),
    corrections: events.filter((e) => e.change === "corrected"),
    runs: runs.map((r) => ({
      id: r.id,
      kind: r.kind,
      published: r.published.length,
      revised: r.revised.length,
      rejected: r.rejected.length,
      held: r.gated.reduce((n, g) => n + g.count, 0),
      read: r.read.length,
    })),
    read: read.size,
    evaluator,
    editions: input.editions
      .filter((s) => inMonth(s.at.time))
      .sort((a, b) => a.n - b.n)
      .map((s) => ({
        n: s.n,
        at: s.at,
        count: s.count,
        block: s.proof?.blocks.length ? Math.min(...s.proof.blocks.map((b) => b.height)) : null,
        signed: s.signature?.ok === true,
      })),
    bips: input.bipChanges.filter((c) => inMonth(c.at.time)).length,
    lab: input.labRuns
      .filter((l) => inMonth(l.at))
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((l) => ({
        at: l.at,
        project: l.project,
        version: l.version,
        passed: l.tests.filter((t) => t.ok).length,
        tests: l.tests.length,
        sha256: l.verified.sha256,
      })),
    advisories: (() => {
      const mine = (input.advisories ?? []).filter((a) => inMonth(a.published));
      return { published: mine.length, filed: mine.filter((a) => a.matches.length > 0).length };
    })(),
  };
}
