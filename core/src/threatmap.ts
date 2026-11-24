// Queries over the compiled security view (core/src/security.ts) for the machine surfaces: the
// threats by layer and status, one threat in full, its advisories and NVD checks, and the watches'
// readings with their thresholds.
// The site's MCP tools (web/lib/mcp.ts) call these; claims are resolved by the caller, so this file
// stays pure and testable.
import { type CveCheck, MISMATCHES } from "./advisories.ts";
import {
  LAYERS,
  type LayerId,
  labTestProject,
  type SecurityView,
  type ThreatStatus,
  type ThreatView,
  type WatchId,
  type WatchState,
} from "./security.ts";
import { watchSpec } from "./watch.ts";

export function allThreatViews(view: SecurityView): ThreatView[] {
  return view.layers.flatMap((l) => l.threats);
}

export function findThreat(view: SecurityView, id: string): ThreatView | undefined {
  return allThreatViews(view).find((t) => t.id === id);
}

export const layerLabel = (id: LayerId): string => LAYERS.find((l) => l.id === id)?.label ?? id;

/** A threat in brief: what a list shows. */
export function threatBrief(t: ThreatView) {
  return {
    id: t.id,
    title: t.title,
    layer: t.layer,
    layer_label: layerLabel(t.layer),
    status: t.live,
    owner_status: t.status,
    raised_by: t.raisedBy,
    claims: t.published.claims.length,
    mitigations: t.published.mitigations.length,
    missing: t.missing,
    watches: t.watches,
    lab: labCounts(t),
    advisories: t.advisories.length,
    nvd_findings: t.cves.filter((c) => c.finding).length,
  };
}

/**
 * A threat's lab tests in numbers: how many it lists, how many ran on any release and passed on
 * every release that ran them, and passed of run on each release, newest first.
 */
export function labCounts(t: Pick<ThreatView, "lab" | "results">) {
  const ran = t.lab.filter((name) => t.results.some((r) => r.name === name));
  const releases = [...new Map(t.results.map((r) => [`${r.project} ${r.version}`, r])).values()];
  return {
    tests: t.lab.length,
    run: ran.length,
    passed: ran.filter((name) => t.results.every((r) => r.name !== name || r.ok)).length,
    releases: releases.map(({ project, version }) => {
      const of = t.results.filter((r) => r.project === project && r.version === version);
      return { project, version, passed: of.filter((r) => r.ok).length, run: of.length };
    }),
  };
}

/**
 * Each of a threat's lab tests with its project and its result on each release of that project
 * the lab covers, newest first: ok null when that release's run did not have the test (an older
 * release may lack a newer one).
 */
export function threatLab(t: ThreatView, view: Pick<SecurityView, "labReleases">) {
  return t.lab.map((name) => {
    const project = labTestProject(name);
    return {
      name,
      project,
      releases: view.labReleases
        .filter((run) => run.project === project)
        .map((run) => {
          const r = t.results.find((x) => x.name === name && x.version === run.version);
          return { version: run.version, ok: r ? r.ok : null, at: run.at };
        }),
    };
  });
}

/**
 * The lab's run on each maintained Bitcoin Core release, newest first, then on LND's and LDK's newest, as a
 * machine reads it.
 */
export function labReport(view: Pick<SecurityView, "labReleases">) {
  return view.labReleases.map((r) => ({
    project: r.project,
    version: r.version,
    at: r.at,
    platform: r.platform,
    verified: r.verified,
    jobs: r.jobs,
    seconds: r.seconds,
    passed: r.tests.filter((x) => x.ok).length,
    run: r.tests.length,
    tests: r.tests.map((x) => ({ name: x.name, ok: x.ok })),
  }));
}

/** A threat's advisories as a machine reads them: each with the rule that filed it and on what. */
export function threatAdvisories(t: ThreatView) {
  return t.advisories.map((a) => ({
    title: a.title,
    url: a.url,
    source: a.source,
    published: a.published,
    severity: a.severity,
    ids: a.ids,
    filed_by: { rule: a.rule, matched: a.by, by_words: a.rule === "term" || a.rule === "keyword" },
    nvd: a.nvd.map((n) => ({ id: n.id, state: n.state, published: n.published, url: n.url })),
  }));
}

/** A threat's CVE ids against NVD, with the finding when NVD and the record disagree. */
export function cveCheck(c: CveCheck) {
  return {
    id: c.id,
    url: c.nvd.url,
    state: c.nvd.state,
    status: c.nvd.status,
    published: c.nvd.published,
    checked: c.nvd.checked,
    affects: c.products,
    names: c.named,
    expected: c.expected,
    finding: c.finding,
    mismatch: c.finding !== null && MISMATCHES.has(c.finding),
  };
}

/** Every advisory the watch has read, in brief, and the ones the owner still has to map. */
export function advisorySummary(view: SecurityView) {
  const a = view.advisories;
  return {
    ...a.counts,
    to_map: a.unmatched.map((x) => ({
      title: x.title,
      url: x.url,
      source: x.source,
      published: x.published,
      ids: x.ids,
    })),
  };
}

/** The threats, optionally of one layer or one live status, in map order, with counts. */
export function listThreats(
  view: SecurityView,
  filter: { layer?: LayerId; status?: ThreatStatus } = {},
) {
  const threats = allThreatViews(view).filter(
    (t) =>
      (!filter.layer || t.layer === filter.layer) && (!filter.status || t.live === filter.status),
  );
  const counts: Record<ThreatStatus, number> = { defended: 0, watching: 0, open: 0 };
  for (const t of threats) counts[t.live]++;
  return { counts, threats: threats.map(threatBrief) };
}

/** One watch's reading with the documented thresholds it is judged by. */
export function watchReading(w: WatchState, history = 12) {
  const spec = watchSpec(w.id);
  return {
    id: w.id,
    title: spec.title,
    measures: spec.measures,
    status: w.status,
    value: w.value,
    unit: spec.unit,
    at: w.at,
    height: w.height,
    thresholds: spec.thresholds,
    source: spec.source,
    history: w.history.slice(-history),
    data: w.data,
    ...(w.error ? { error: w.error } : {}),
  };
}

export function watchReadings(view: SecurityView, ids?: readonly WatchId[]) {
  return view.watches.filter((w) => !ids || ids.includes(w.id)).map((w) => watchReading(w));
}
