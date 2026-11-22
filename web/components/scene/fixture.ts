import type { Activity, BrainFeed, FeedEvent } from "@blocklore/core/feed";
import type { SceneData } from "@/lib/graph";

// Development only. Scene.tsx loads this when NODE_ENV is not production and the URL carries
// ?scene=fixture, so the scene can be built and checked before the daemon sends its feed and the
// security watch sends its layers. Nothing here is a fact Blocklore publishes: the layers and
// threats are placeholders with the contract's shape, and the events are a script.

type Layer = SceneData["security"][number];
type Status = Layer["threats"][number]["status"];

const layer = (id: string, label: string, threats: [string, string, Status][]): Layer => ({
  id,
  label,
  threats: threats.map(([tid, tlabel, status]) => ({ id: tid, label: tlabel, status })),
});

export const LAYERS: Layer[] = [
  layer("consensus", "Consensus rules", [
    ["inflation-bug", "An inflation bug in block validation", "defended"],
    ["time-warp", "The time warp attack on difficulty", "watching"],
    ["duplicate-txid", "Duplicate transaction ids", "defended"],
  ]),
  layer("mining", "Mining", [
    ["majority-hashrate", "A majority of hashrate rewriting blocks", "watching"],
    ["selfish-mining", "Selfish mining", "watching"],
    ["fee-sniping", "Fee sniping", "defended"],
  ]),
  layer("network", "Peer-to-peer network", [
    ["eclipse", "An eclipse attack on a node", "defended"],
    ["sybil", "Sybil peers", "defended"],
    ["bgp-partition", "Partition by BGP hijack", "open"],
    ["relay-censorship", "Censorship of transaction relay", "watching"],
  ]),
  layer("software", "Node software", [
    ["remote-crash", "A remote crash from a malformed message", "defended"],
    ["release-supply-chain", "A compromised release build", "watching"],
  ]),
  layer("cryptography", "Cryptography", [
    ["quantum-ecdsa", "A quantum computer breaking ECDSA keys", "open"],
    ["nonce-reuse", "Signature nonce reuse", "defended"],
  ]),
  layer("lightning", "Lightning", [
    ["replacement-cycling", "Replacement cycling", "open"],
    ["channel-jamming", "Channel jamming", "watching"],
    ["flood-and-loot", "Flood and loot", "watching"],
  ]),
];

/** The store with the fixture's layers (when the real ones are empty) and a signed snapshot. */
export function withFixture(data: SceneData): SceneData {
  const last = data.snapshots.at(-1);
  const snapshots = data.snapshots.map((s) => (s === last ? { ...s, signed: true } : s));
  if (last && data.tip && data.tip > (last.anchor ?? last.height))
    snapshots.push({ n: last.n + 1, height: data.tip - 2 });
  return {
    ...data,
    security: data.security.length ? data.security : LAYERS,
    snapshots,
  };
}

interface Step {
  kind: Activity;
  text: string;
  topic?: boolean;
  claims?: number;
  fresh?: boolean;
  threat?: boolean;
  outcome?: FeedEvent["outcome"];
}

const SCRIPT: Step[] = [
  { kind: "ingest", text: "Read 14 new messages on the mailing list" },
  { kind: "research", text: "Research session on a topic", topic: true },
  { kind: "verify", text: "Trying to falsify 3 drafts", topic: true },
  { kind: "evaluate", text: "Decided 3 drafts", claims: 3, outcome: "ok" },
  { kind: "publish", text: "Published 2 claims", topic: true, claims: 1, fresh: true },
  { kind: "recheck", text: "Rechecked 5 claims", claims: 5, outcome: "ok" },
  { kind: "watch", text: "Read the chain and the advisories", threat: true, outcome: "ok" },
  { kind: "lab", text: "Replayed a known attack in regtest", threat: true, outcome: "ok" },
  { kind: "snapshot", text: "Sealed a snapshot in a block" },
  { kind: "idle", text: "Resting until the next tick" },
];

/**
 * Plays the script: every `every` ms a new event joins the feed and `now` follows it. Returns a
 * stop function.
 */
export function replay(data: SceneData, onFeed: (f: BrainFeed) => void, every = 3500): () => void {
  const events: FeedEvent[] = [];
  const threats = (data.security.length ? data.security : LAYERS).flatMap((l) => l.threats);
  let n = 0;
  const tick = () => {
    const step = SCRIPT[n % SCRIPT.length] ?? SCRIPT[0];
    if (!step) return;
    const topic = data.topics[Math.floor(n / SCRIPT.length) % Math.max(data.topics.length, 1)];
    const pool = data.claims.filter((c) => !topic || c.topic === topic.slug);
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const claims = step.claims
      ? pool
          .slice((n * 3) % Math.max(pool.length, 1))
          .slice(0, step.claims)
          .map((c) => c.id)
      : undefined;
    if (step.fresh && claims && topic) claims.push(`${topic.slug}.fixture-${n}`);
    const e: FeedEvent = {
      at,
      kind: step.kind,
      text: step.text,
      ...(step.topic && topic ? { topic: topic.slug } : {}),
      ...(claims?.length ? { claims } : {}),
      ...(step.threat && threats.length ? { threat: threats[n % threats.length]?.id ?? "" } : {}),
      ...(step.outcome ? { outcome: step.outcome } : {}),
    };
    events.unshift(e);
    events.length = Math.min(events.length, 60);
    n++;
    onFeed({
      v: 1,
      at,
      now: {
        kind: step.kind,
        text: step.text,
        since: at,
        ...(e.topic ? { topic: e.topic } : {}),
      },
      next: [],
      events: [...events],
      day: { read: 30 + n, rechecked: 12, drafted: 6, published: 2, rejected: 1, sessions: 2 },
    });
  };
  tick();
  const id = window.setInterval(tick, every);
  return () => window.clearInterval(id);
}
