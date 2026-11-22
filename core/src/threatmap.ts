// Queries over the compiled security view (core/src/security.ts) for the machine surfaces: the
// threats by layer and status, one threat in full, and the watches' readings with their thresholds.
// The site's MCP tools (web/lib/mcp.ts) call these; claims are resolved by the caller, so this file
// stays pure and testable.
import {
  LAYERS,
  type LayerId,
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
    lab: {
      passed: t.results.filter((r) => r.ok).length,
      run: t.results.length,
      tests: t.lab.length,
    },
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
