import "server-only";
import type { BundleClaim, ThreatView, WatchId, WatchState } from "@blocklore/core";
import { allThreatViews, findThreat, layerLabel } from "@blocklore/core/threatmap";
import { bundle, getClaim } from "./data";
import type { SceneData } from "./graph";

// The security watch as the site reads it: the compiled view (bundle.security, built from
// knowledge/security/ by core/src/security.ts), looked up for the pages, the MCP tools and the scene.

export const security = bundle.security;

export function allThreats(): ThreatView[] {
  return allThreatViews(security);
}

export function getThreat(id: string): ThreatView | undefined {
  return findThreat(security, id);
}

export function watchById(id: WatchId): WatchState | undefined {
  return security.watches.find((w) => w.id === id);
}

export { layerLabel };

/** Published claims, in the order the threat lists them. */
export function claimsOf(ids: string[]): BundleClaim[] {
  return ids.map((id) => getClaim(id)).filter((c) => c !== undefined);
}

/** The scene's security layers: every layer with its threats and their live status. */
export function securityScene(): SceneData["security"] {
  return security.layers.map((l) => ({
    id: l.id,
    label: l.label,
    threats: l.threats.map((t) => ({ id: t.id, label: t.title, status: t.live })),
  }));
}
