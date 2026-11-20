import "server-only";
import {
  type Bundle,
  type BundleClaim,
  type BundleTopic,
  DEPTH_RANK,
  type Depth,
} from "@blocklore/core";
import raw from "../.generated/bundle.json";

/** The compiled store (`pnpm bundle`), read at build time; it never reaches a browser whole. */
export const bundle = raw as unknown as Bundle;

export function getClaim(id: string): BundleClaim | undefined {
  return bundle.claims[id];
}

export function allClaims(): BundleClaim[] {
  return Object.values(bundle.claims);
}

export function getTopic(slug: string): BundleTopic | undefined {
  return bundle.topics.find((t) => t.slug === slug);
}

export const GROUPS: { id: BundleTopic["group"]; label: string; blurb: string }[] = [
  { id: "foundations", label: "Foundations", blurb: "How coins, supply and ownership work." },
  { id: "mining", label: "Mining", blurb: "Proof of work, difficulty and block production." },
  { id: "protocol", label: "Protocol", blurb: "Upgrades, transactions and relay policy." },
  { id: "layers", label: "Layers", blurb: "Lightning and what runs on top of Bitcoin." },
  { id: "custody", label: "Custody", blurb: "Holding keys safely." },
  { id: "governance", label: "Governance", blurb: "How changes are proposed and argued." },
  { id: "history", label: "History", blurb: "What happened, and when." },
];

/** Every claim a topic shows, in reading order, each once. */
export function topicClaims(t: BundleTopic): BundleClaim[] {
  const seen = new Set<string>();
  const out: BundleClaim[] = [];
  for (const s of t.sections)
    for (const id of s.claims) {
      const c = bundle.claims[id];
      if (c && !seen.has(id)) {
        seen.add(id);
        out.push(c);
      }
    }
  return out;
}

export function countAtDepth(t: BundleTopic, depth: Depth): number {
  return topicClaims(t).filter((c) => DEPTH_RANK[c.depth] <= DEPTH_RANK[depth]).length;
}

export function eventsFor(id: string) {
  return bundle.events.filter((e) => e.claim === id).sort((a, b) => a.rev - b.rev);
}

/** The newest snapshot that contains this claim with its current hash, if any. */
export function snapshotFor(c: BundleClaim) {
  return bundle.snapshots.find((s) => s.claims.some((x) => x.id === c.id && x.hash === c.hash));
}
