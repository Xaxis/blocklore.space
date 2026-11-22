import type { Activity, BrainFeed, FeedEvent } from "@blocklore/core/feed";
import type { SceneData } from "@/lib/graph";

// Development only. Scene.tsx loads this when NODE_ENV is not production and the URL carries
// ?scene=fixture, so the scene's feed animations can be built and checked without the daemon.
// Nothing here is a fact Blocklore publishes: the events are a script over the real store, and the
// extra snapshot and signature exist only to draw the proof marks.

/** The store with its newest snapshot signed and a pending one after it. */
export function withFixture(data: SceneData): SceneData {
  const last = data.snapshots.at(-1);
  const snapshots = data.snapshots.map((s) => (s === last ? { ...s, signed: true } : s));
  if (last && data.tip && data.tip > (last.anchor ?? last.height))
    snapshots.push({ n: last.n + 1, height: data.tip - 2 });
  return { ...data, snapshots };
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
  const threats = data.security.flatMap((l) => l.threats);
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
