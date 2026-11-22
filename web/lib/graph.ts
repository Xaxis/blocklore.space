import "server-only";
import { bundle, topicClaims } from "@/lib/data";
import { securityScene } from "@/lib/security";

// What the 3D scene draws: the store as a structure, kept small (it ships with every page).
// Built on the server from the bundle; the scene (components/scene) is its only reader.

export interface SceneData {
  tip: number | null;
  topics: { slug: string; title: string; group: string; count: number }[];
  claims: {
    id: string;
    topic: string;
    depth: string;
    status: string;
    kind: string;
    /** The statement cut to about 96 characters, for the hover label. */
    label: string;
    seen: number;
    checked: number;
  }[];
  snapshots: { n: number; height: number }[];
  /**
   * The security watch (/security): one entry per layer of Bitcoin, each with its threats and their
   * status. Empty until the watch is built; the scene draws what is there.
   */
  security: {
    id: string;
    label: string;
    threats: { id: string; label: string; status: "defended" | "watching" | "open" }[];
  }[];
}

const LABEL = 96;

/** Cuts at a word boundary and marks the cut, so a label never ends mid word. */
function cut(s: string): string {
  if (s.length <= LABEL) return s;
  const head = s.slice(0, LABEL);
  const space = head.lastIndexOf(" ");
  return `${(space > 60 ? head.slice(0, space) : head).replace(/[,;:.]$/, "")}...`;
}

let cached: SceneData | undefined;

export function sceneData(): SceneData {
  if (cached) return cached;
  const topics = bundle.topics.map((t) => ({
    slug: t.slug,
    title: t.title,
    group: t.group,
    count: topicClaims(t).length,
  }));
  const known = new Set(topics.map((t) => t.slug));
  const claims = Object.values(bundle.claims).flatMap((c) => {
    // A claim sits in the cluster of the first published topic that shows it.
    const topic =
      c.shownIn.find((s) => s.kind === "topic" && known.has(s.slug))?.slug ??
      c.topics.find((t) => known.has(t));
    if (!topic) return [];
    return [
      {
        id: c.id,
        topic,
        depth: c.depth,
        status: c.status,
        kind: c.kind,
        label: cut(c.statement),
        seen: c.first_seen.height,
        checked: c.last_verified.height,
      },
    ];
  });
  cached = {
    tip: bundle.generated.height ?? null,
    topics,
    claims,
    snapshots: bundle.snapshots.map((s) => ({ n: s.n, height: s.at.height })),
    security: securityScene(),
  };
  return cached;
}
