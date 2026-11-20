// Compiles the store into the one bundle the site, the API and Ask the Brain read. Pure: the store
// and the moment come in as arguments; src/node/ reads the files.
import { gateReasons } from "./gate.ts";
import { claimHash } from "./hash.ts";
import { type ChangeEvent, changeEvents } from "./replay.ts";
import type {
  Claim,
  Debate,
  Proposal,
  ReviewCount,
  Run,
  Section,
  Snapshot,
  SourceKind,
  Stamp,
  Tier,
  Topic,
} from "./schema.ts";
import { type Issue, onlyWeakSources, validateClaim } from "./validate.ts";

export interface Store {
  claims: Claim[];
  topics: Topic[];
  proposals: Proposal[];
  debates: Debate[];
  runs: Run[];
  snapshots: Snapshot[];
  review: ReviewCount[];
}

export interface BundleClaim extends Claim {
  hash: string;
  weakSources: boolean;
  /** Topics, proposals and debates that show this claim. */
  shownIn: { kind: "topic" | "proposal" | "debate"; slug: string; title: string }[];
}

export type RungId = "spec" | "code" | "review" | "coverage" | "media";
export interface LadderItem {
  title: string;
  url: string;
  kind: SourceKind;
  tier: Tier;
  claims: string[];
}
export interface Rung {
  id: RungId;
  label: string;
  items: LadderItem[];
}

export interface BundleTopic extends Topic {
  ladder: Rung[];
  claimCount: number;
  updated: Stamp;
  pendingReview: number;
}
export interface BundleProposal extends Proposal {
  ladder: Rung[];
  claimCount: number;
  updated: Stamp;
}

export interface Stats {
  claims: number;
  topics: number;
  sources: number;
  checks: number;
  withPrimary: number;
  verifiedWithin7Days: number;
  pendingReview: number;
  corrections: number;
}

export interface Bundle {
  version: 1;
  generated: Stamp;
  claims: Record<string, BundleClaim>;
  topics: BundleTopic[];
  proposals: BundleProposal[];
  debates: Debate[];
  runs: Run[];
  events: ChangeEvent[];
  snapshots: Snapshot[];
  review: ReviewCount[];
  stats: Stats;
}

export interface FileIssue extends Issue {
  file: string;
}

const RUNGS: { id: RungId; label: string; kinds: SourceKind[] }[] = [
  { id: "spec", label: "Specification", kinds: ["bip", "bolt"] },
  { id: "code", label: "Code", kinds: ["code", "commit", "release-notes"] },
  {
    id: "review",
    label: "Review and discussion",
    kinds: ["pr", "issue", "mailing-list", "delving"],
  },
  {
    id: "coverage",
    label: "Expert coverage",
    kinds: ["optech", "stackexchange", "transcript", "paper", "docs"],
  },
  { id: "media", label: "Media and social", kinds: ["media", "social"] },
];

/** The concept-to-code-to-history ladder, assembled from the sources of the claims shown. */
export function ladder(claims: Claim[]): Rung[] {
  const byUrl = new Map<string, LadderItem>();
  for (const c of claims) {
    if (c.status === "superseded") continue;
    for (const s of c.sources) {
      if (!s.url) continue;
      const key = s.url.split("#")[0] as string;
      const item = byUrl.get(key) ?? {
        title: s.title,
        url: s.url,
        kind: s.kind,
        tier: s.tier,
        claims: [],
      };
      if (!item.claims.includes(c.id)) item.claims.push(c.id);
      byUrl.set(key, item);
    }
  }
  const items = [...byUrl.values()];
  return RUNGS.map((r) => ({
    id: r.id,
    label: r.label,
    items: items
      .filter((i) => r.kinds.includes(i.kind))
      .sort((a, b) => b.claims.length - a.claims.length || a.title.localeCompare(b.title)),
  })).filter((r) => r.items.length > 0);
}

function latest(claims: Claim[], fallback: Stamp): Stamp {
  let best = fallback;
  let first = true;
  for (const c of claims) {
    const at = c.revisions[c.revisions.length - 1]?.at;
    if (at && (first || at.time > best.time)) {
      best = at;
      first = false;
    }
  }
  return best;
}

function sectionClaims(sections: Section[], claims: Map<string, Claim>): Claim[] {
  return sections.flatMap((s) =>
    s.claims.map((id) => claims.get(id)).filter((c) => c !== undefined),
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** Compiles the store at moment `now`. Errors mean the store must not publish. */
export function compile(store: Store, now: Stamp): { bundle: Bundle; issues: FileIssue[] } {
  const issues: FileIssue[] = [];
  const add = (file: string, level: Issue["level"], where: string, message: string) =>
    issues.push({ file, level, where, message });

  const claims = new Map<string, Claim>();
  for (const c of store.claims) {
    if (claims.has(c.id)) add(`claim ${c.id}`, "error", "id", "is used twice");
    claims.set(c.id, c);
    for (const i of validateClaim(c)) issues.push({ file: `claim ${c.id}`, ...i });
  }
  const topics = new Map(store.topics.map((t) => [t.slug, t]));

  for (const c of claims.values()) {
    const where = `claim ${c.id}`;
    for (const t of c.topics) if (!topics.has(t)) add(where, "error", "topics", `no topic "${t}"`);
    for (const r of c.related ?? [])
      if (!claims.has(r)) add(where, "error", "related", `no claim ${r}`);
    if (c.superseded_by && !claims.has(c.superseded_by))
      add(where, "error", "superseded_by", `no claim ${c.superseded_by}`);
    const reasons = gateReasons(c, topics);
    if (reasons.length > 0 && !c.review)
      add(where, "error", "review", `is gated (${reasons.join("; ")}) but has no review record`);
  }

  const shownIn = new Map<string, BundleClaim["shownIn"]>();
  const show = (id: string, entry: BundleClaim["shownIn"][number], file: string) => {
    if (!claims.has(id)) {
      add(file, "error", "claims", `no claim ${id}`);
      return;
    }
    const list = shownIn.get(id) ?? [];
    if (!list.some((e) => e.kind === entry.kind && e.slug === entry.slug)) list.push(entry);
    shownIn.set(id, list);
  };
  for (const t of store.topics) {
    const file = `topic ${t.slug}`;
    show(t.lede, { kind: "topic", slug: t.slug, title: t.title }, file);
    for (const s of t.sections)
      for (const id of s.claims) show(id, { kind: "topic", slug: t.slug, title: t.title }, file);
    for (const r of t.related ?? [])
      if (!topics.has(r)) add(file, "error", "related", `no topic ${r}`);
  }
  for (const p of store.proposals) {
    const file = `proposal ${p.slug}`;
    for (const s of p.sections)
      for (const id of s.claims) show(id, { kind: "proposal", slug: p.slug, title: p.title }, file);
    show(p.lede, { kind: "proposal", slug: p.slug, title: p.title }, file);
  }
  for (const d of store.debates) {
    const file = `debate ${d.slug}`;
    const ids = new Set(d.nodes.map((n) => n.claim));
    for (const n of d.nodes)
      show(n.claim, { kind: "debate", slug: d.slug, title: d.question }, file);
    for (const e of d.edges)
      if (!ids.has(e.from) || !ids.has(e.to))
        add(file, "error", "edges", `${e.from} to ${e.to} names a claim that is not a node`);
  }
  for (const c of claims.values())
    if (!shownIn.has(c.id) && c.status !== "superseded")
      add(`claim ${c.id}`, "warning", "topics", "is not shown on any topic, proposal or debate");

  const bundleClaims: Record<string, BundleClaim> = {};
  for (const c of [...claims.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    bundleClaims[c.id] = {
      ...c,
      hash: claimHash(c),
      weakSources: onlyWeakSources(c),
      shownIn: shownIn.get(c.id) ?? [],
    };
  }

  const pendingByTopic = new Map(store.review.map((r) => [r.topic, r.count]));
  const bundleTopics: BundleTopic[] = store.topics.map((t) => {
    const shown = sectionClaims(t.sections, claims);
    return {
      ...t,
      ladder: ladder(shown),
      claimCount: new Set(shown.map((c) => c.id)).size,
      updated: latest(shown, now),
      pendingReview: pendingByTopic.get(t.slug) ?? 0,
    };
  });
  const bundleProposals: BundleProposal[] = store.proposals.map((p) => {
    const shown = sectionClaims(p.sections, claims);
    return {
      ...p,
      ladder: ladder(shown),
      claimCount: new Set(shown.map((c) => c.id)).size,
      updated: latest(shown, now),
    };
  });

  const events = [...claims.values()]
    .flatMap(changeEvents)
    .sort((a, b) =>
      a.at.time < b.at.time ? 1 : a.at.time > b.at.time ? -1 : a.claim.localeCompare(b.claim),
    );

  const all = [...claims.values()];
  const nowMs = Date.parse(now.time);
  const stats: Stats = {
    claims: all.length,
    topics: store.topics.length,
    sources: new Set(all.flatMap((c) => c.sources.map((s) => s.url ?? `${c.id}:chain`))).size,
    checks: all.reduce((n, c) => n + (c.checks?.length ?? 0), 0),
    withPrimary: all.filter((c) => c.sources.some((s) => s.tier === "T1")).length,
    verifiedWithin7Days: all.filter((c) => nowMs - Date.parse(c.last_verified.time) <= 7 * DAY)
      .length,
    pendingReview: store.review.reduce((n, r) => n + r.count, 0),
    corrections: events.filter((e) => e.change === "corrected").length,
  };

  return {
    bundle: {
      version: 1,
      generated: now,
      claims: bundleClaims,
      topics: bundleTopics,
      proposals: bundleProposals,
      debates: store.debates,
      runs: [...store.runs].sort((a, b) => (a.started.time < b.started.time ? 1 : -1)),
      events,
      snapshots: [...store.snapshots].sort((a, b) => b.n - a.n),
      review: store.review,
      stats,
    },
    issues,
  };
}
