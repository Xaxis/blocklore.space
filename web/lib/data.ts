import "server-only";
import {
  type Bundle,
  type BundleClaim,
  type BundleTopic,
  DEPTH_RANK,
  type Depth,
  type DigestDay,
  digestDays,
  merkleProof,
  type NostrChannel,
  npub,
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

/** A claim the owner withdrew: out of every topic, list and search, kept at its own page. */
export function getWithdrawn(id: string): BundleClaim | undefined {
  return bundle.withdrawn[id];
}

export function allWithdrawn(): BundleClaim[] {
  return Object.values(bundle.withdrawn);
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

/**
 * The newest snapshot, when it holds this claim with its current hash, with the claim's place in it
 * and the Merkle audit path from its hash to the root.
 */
export function snapshotFor(c: BundleClaim) {
  const s = bundle.snapshots[0];
  const index = bundle.snapshotClaims.findIndex((x) => x.id === c.id && x.hash === c.hash);
  if (!s || index < 0) return undefined;
  return {
    ...s,
    index,
    path: merkleProof(
      bundle.snapshotClaims.map((x) => x.hash),
      index,
    ),
  };
}

/**
 * Blocklore's Nostr channel as readers may follow it: only while the owner has posting on
 * (knowledge/nostr.json). Its key resolves through NIP-05 either way.
 */
export function followChannel(): (NostrChannel & { npub: string }) | null {
  const c = bundle.nostr;
  return c?.posting ? { ...c, npub: npub(c.pubkey) } : null;
}

let days: DigestDay[] | null = null;

/** The daily digests, newest first, compiled from the store's own events. */
export function digests(): DigestDay[] {
  days ??= digestDays(
    bundle.events,
    bundle.runs,
    bundle.bips?.changes ?? [],
    bundle.topics.map((t) => t.slug),
  );
  return days;
}
