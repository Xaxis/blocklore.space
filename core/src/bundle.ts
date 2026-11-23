// Compiles the store into the one bundle the site, the API and Ask the Brain read. Pure: the store
// and the moment come in as arguments; src/node/ reads the files.
import { advisoryMapIssues } from "./advisories.ts";
import { bipOf } from "./bipview.ts";
import { type GapMap, gapMap } from "./gaps.ts";
import { gateReasons } from "./gate.ts";
import { claimHash } from "./hash.ts";
import { channelProblems, type NostrChannel } from "./nostr.ts";
import {
  checkRecords,
  type EditionSignature,
  EMPTY_RECORDS,
  type OcRecords,
  readEditionSignature,
} from "./orangecheck.ts";
import {
  type ChangeEvent,
  changeEvents,
  claimAsOf,
  claimAtRevision,
  isAfter,
  type Moment,
} from "./replay.ts";
import type {
  BipIndex,
  Claim,
  Debate,
  EvaluatorRecord,
  Proposal,
  Recheck,
  Rechecks,
  ReviewCount,
  Run,
  Scorecard,
  Section,
  Snapshot,
  SourceKind,
  Stamp,
  Tier,
  Topic,
  Wire,
} from "./schema.ts";
import {
  type SecurityStore,
  type SecurityView,
  securityView,
  threatGaps,
  threatIssues,
} from "./security.ts";
import type { Signaling } from "./signaling.ts";
import {
  type ProofSummary,
  proofFile,
  snapshotFile,
  snapshotIssues,
  summarizeProof,
} from "./snapshot.ts";
import { type Issue, onlyWeakSources, validateClaim } from "./validate.ts";

export interface Store {
  /** The security watch (knowledge/security/): the threat map, the watches and the lab. */
  security?: SecurityStore;
  wire: Wire | null;
  /** Open failed rechecks by claim id (knowledge/rechecks.json). */
  rechecks?: Rechecks;
  /** The published bench scorecard (knowledge/bench.json). */
  scorecard?: Scorecard | null;
  /** The evaluator's public record (knowledge/evaluator.json). */
  evaluator?: EvaluatorRecord | null;
  bips: BipIndex | null;
  claims: Claim[];
  topics: Topic[];
  proposals: Proposal[];
  debates: Debate[];
  runs: Run[];
  snapshots: StoredSnapshot[];
  /** The owner's attestations, delegations and revocations (knowledge/orangecheck/). */
  orangecheck?: OcRecords;
  /** The Nostr channel's public record (knowledge/nostr.json), once the owner first switched it. */
  nostr?: NostrChannel | null;
  /** The version bits blocks set this period and the last (knowledge/chain/signaling.json). */
  signaling?: Signaling | null;
  review: ReviewCount[];
}

/** A snapshot file as read: the parsed manifest, its exact text and its proof's bytes, if any. */
export interface StoredSnapshot {
  manifest: Snapshot;
  text: string;
  proof: Uint8Array | null;
  /** The publisher key's OC Stamp over the file (`<n>.json.stamp`), as written. */
  stamp?: string | null;
}

/** A snapshot without its claim list, with what its proof says. */
export interface BundleSnapshot extends Omit<Snapshot, "claims"> {
  file: string;
  proof: (ProofSummary & { file: string }) | null;
  /** Who signed the edition and whether the owner stood behind the key then; null when unsigned. */
  signature: EditionSignature | null;
}

export interface BundleClaim extends Claim {
  hash: string;
  /** The hash of the claim as each revision left it, oldest first; the last is `hash`. */
  hashes: string[];
  weakSources: boolean;
  /** The open failed recheck, if the claim did not hold as cited when last checked again. */
  recheck: Recheck | null;
  /** Topics, proposals and debates that show this claim. */
  shownIn: { kind: "topic" | "proposal" | "debate"; slug: string; title: string }[];
  /** When, why and in which run the owner withdrew it; null for a current claim. */
  withdrawal: { at: Stamp; note: string; run: string } | null;
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
  withdrawn: number;
}

export interface Bundle {
  version: 1;
  generated: Stamp;
  bips: BipIndex | null;
  wire: Wire | null;
  scorecard: Scorecard | null;
  evaluator: EvaluatorRecord | null;
  /** What the store does not hold yet (core/src/gaps.ts). */
  gaps: GapMap;
  /** The security watch: every layer's threats with their claims, the watches, the lab. */
  security: SecurityView;
  /** The version bits blocks set this period and the last: a reading the brain counted, not claims. */
  signaling: Signaling | null;
  /** BIP number to the published claims that cite its text. */
  bipCitations: Record<number, string[]>;
  /** Current claims. A withdrawn claim is never here, so no list, search or topic shows it. */
  claims: Record<string, BundleClaim>;
  /** Claims the owner withdrew, each with its whole history; only its own page shows it. */
  withdrawn: Record<string, BundleClaim>;
  topics: BundleTopic[];
  /** Every topic as written in the store, withdrawn claims and all, for the time machine. */
  writtenTopics: Topic[];
  proposals: BundleProposal[];
  debates: Debate[];
  runs: Run[];
  events: ChangeEvent[];
  /** Newest first. */
  snapshots: BundleSnapshot[];
  /** The newest snapshot's claim hashes in id order, for inclusion proofs; empty before the first. */
  snapshotClaims: Snapshot["claims"];
  /** The OrangeCheck records that check: what stands behind every signature (ORANGECHECK.md). */
  orangecheck: OcRecords;
  /** The Nostr channel (core/src/nostr.ts): its key and relays, and whether it posts; null before. */
  nostr: NostrChannel | null;
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

/** The owner's withdrawal of a claim: its latest withdrawn revision, or null. */
export function withdrawalOf(c: Claim): BundleClaim["withdrawal"] {
  if (c.status !== "withdrawn") return null;
  const r = [...c.revisions].reverse().find((x) => x.change === "withdrawn");
  return r ? { at: r.at, note: r.note ?? "", run: r.run } : null;
}

/**
 * A compiled claim as it stood at `m` (claimAsOf), with what the compiler derives recomputed for
 * that state: its hash then, the secondary-sources label, a failed recheck or a withdrawal only once
 * it had happened, and a last check no later than the moment (the revision's own publication, whose
 * checks every claim passes, when the newest check came after it). Null before it existed.
 */
export function bundleClaimAsOf(c: BundleClaim, m: Moment): BundleClaim | null {
  const past = claimAsOf(c, m);
  if (!past) return null;
  const n = past.revisions.length;
  const latest = past.revisions[n - 1] as Claim["revisions"][number];
  return {
    ...past,
    hash: c.hashes[n - 1] ?? c.hash,
    weakSources: onlyWeakSources(past),
    recheck: c.recheck && !isAfter(c.recheck.at, m) ? c.recheck : null,
    withdrawal: withdrawalOf(past),
    last_verified: isAfter(c.last_verified, m)
      ? { ...latest.at, run: latest.run, method: "checked when this revision was published" }
      : c.last_verified,
  };
}

/** A view's sections without withdrawn claims; empty sections dropped. */
function visibleSections(sections: Section[], hidden: ReadonlySet<string>): Section[] {
  return sections
    .map((s) => ({ ...s, claims: s.claims.filter((id) => !hidden.has(id)) }))
    .filter((s) => s.claims.length > 0);
}

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
  const withdrawn = new Set(
    [...claims.values()].filter((c) => c.status === "withdrawn").map((c) => c.id),
  );
  const current = new Map([...claims].filter(([id]) => !withdrawn.has(id)));

  for (const c of claims.values()) {
    const where = `claim ${c.id}`;
    // The primary topic must exist; a further topic may still be on its way.
    for (const [i, t] of c.topics.entries())
      if (!topics.has(t))
        add(
          where,
          i === 0 ? "error" : "warning",
          "topics",
          i === 0 ? `no topic "${t}"` : `also on "${t}", not published`,
        );
    // A link to a claim that is not published (it may wait for review) is left out until it is.
    for (const r of c.related ?? [])
      if (!current.has(r)) add(where, "warning", "related", `links to ${r}, not published`);
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
    if (withdrawn.has(id)) {
      add(file, "warning", "claims", `shows ${id}, which the owner withdrew; it is left out`);
      return;
    }
    const list = shownIn.get(id) ?? [];
    if (!list.some((e) => e.kind === entry.kind && e.slug === entry.slug)) list.push(entry);
    shownIn.set(id, list);
  };
  const visibleTopics = store.topics.flatMap((t) => {
    const sections = visibleSections(t.sections, withdrawn);
    if (sections.length === 0) return [];
    const lede = withdrawn.has(t.lede) ? (sections[0]?.claims[0] as string) : t.lede;
    return [{ ...t, lede, sections }];
  });
  const visibleProposals = store.proposals.map((p) => {
    const sections = visibleSections(p.sections, withdrawn);
    const lede = withdrawn.has(p.lede) ? (sections[0]?.claims[0] ?? p.lede) : p.lede;
    return { ...p, lede, sections };
  });
  const visibleDebates = store.debates.map((d) => ({
    ...d,
    nodes: d.nodes.filter((n) => !withdrawn.has(n.claim)),
    edges: d.edges.filter((e) => !withdrawn.has(e.from) && !withdrawn.has(e.to)),
  }));
  for (const t of store.topics) {
    const file = `topic ${t.slug}`;
    show(t.lede, { kind: "topic", slug: t.slug, title: t.title }, file);
    for (const s of t.sections)
      for (const id of s.claims) show(id, { kind: "topic", slug: t.slug, title: t.title }, file);
    for (const r of t.related ?? [])
      if (!topics.has(r)) add(file, "warning", "related", `links to topic ${r}, not published`);
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
  for (const c of current.values())
    if (!shownIn.has(c.id) && c.status !== "superseded")
      add(`claim ${c.id}`, "warning", "topics", "is not shown on any topic, proposal or debate");

  const bundleClaims: Record<string, BundleClaim> = {};
  const bundleWithdrawn: Record<string, BundleClaim> = {};
  for (const c of [...claims.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    (withdrawn.has(c.id) ? bundleWithdrawn : bundleClaims)[c.id] = {
      ...c,
      related: c.related?.filter((r) => current.has(r)),
      hash: claimHash(c),
      hashes: c.revisions.map((_, i) => claimHash(claimAtRevision(c, i + 1))),
      weakSources: onlyWeakSources(c),
      recheck: withdrawn.has(c.id) ? null : (store.rechecks?.[c.id] ?? null),
      shownIn: shownIn.get(c.id) ?? [],
      withdrawal: withdrawalOf(c),
    };
  }

  const pendingByTopic = new Map(store.review.map((r) => [r.topic, r.count]));
  const bundleTopics: BundleTopic[] = visibleTopics.map((t) => {
    const shown = sectionClaims(t.sections, current);
    return {
      ...t,
      related: t.related?.filter((r) => topics.has(r)),
      ladder: ladder(shown),
      claimCount: new Set(shown.map((c) => c.id)).size,
      updated: latest(shown, now),
      pendingReview: pendingByTopic.get(t.slug) ?? 0,
    };
  });
  const bundleProposals: BundleProposal[] = visibleProposals.map((p) => {
    const shown = sectionClaims(p.sections, current);
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

  const all = [...current.values()];
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
    withdrawn: withdrawn.size,
  };

  const bipCitations: Record<number, string[]> = {};
  for (const c of all) {
    if (c.status === "superseded") continue;
    const cited = new Set<number>();
    for (const s of c.sources) {
      const n = bipOf(s.url);
      if (n !== null) cited.add(n);
    }
    for (const n of cited) {
      bipCitations[n] = [...(bipCitations[n] ?? []), c.id];
    }
  }

  for (const i of snapshotIssues(store.snapshots.map((s) => s.manifest)))
    add("knowledge/snapshots", "error", "(chain)", i);
  const ordered = [...store.snapshots].sort((a, b) => b.manifest.n - a.manifest.n);
  const newest = ordered[0];
  const oc = checkRecords(store.orangecheck ?? EMPTY_RECORDS);
  for (const p of oc.problems) add("knowledge/orangecheck", "error", "(signature)", p);
  const snapshots: BundleSnapshot[] = ordered.map(({ manifest, text, proof, stamp }) => {
    const { claims: _claims, ...rest } = manifest;
    let summary: BundleSnapshot["proof"] = null;
    if (proof) {
      try {
        summary = { file: proofFile(manifest.n), ...summarizeProof(text, proof) };
      } catch (e) {
        add(`knowledge/snapshots/${proofFile(manifest.n)}`, "error", "(proof)", String(e));
      }
    }
    const signed = readEditionSignature(stamp ?? null, manifest, text, oc.valid);
    if (signed.problem)
      add(
        `knowledge/snapshots/${snapshotFile(manifest.n)}.stamp`,
        "error",
        "(stamp)",
        signed.problem,
      );
    return { ...rest, file: snapshotFile(manifest.n), proof: summary, signature: signed.signature };
  });
  for (const p of store.nostr ? channelProblems(store.nostr) : [])
    add("knowledge/nostr.json", p.level, "relays", p.message);
  const security = store.security ?? { threats: [], watches: null, lab: null };
  const publishedIds = new Set(claims.keys());
  for (const i of threatIssues(security.threats, publishedIds)) issues.push(i);
  if (security.advisoryMap)
    for (const i of advisoryMapIssues(security.advisoryMap, security.threats)) issues.push(i);
  const securityCompiled = securityView(security, publishedIds);
  return {
    bundle: {
      version: 1,
      generated: now,
      bips: store.bips,
      wire: store.wire,
      scorecard: store.scorecard ?? null,
      evaluator: store.evaluator ?? null,
      gaps: gapMap({
        claims: bundleClaims,
        topics: bundleTopics,
        review: store.review,
        rechecks: store.rechecks ?? {},
        scorecard: store.scorecard ?? null,
        threats: threatGaps(security.threats, publishedIds),
        advisories: securityCompiled.advisories.unmatched,
      }),
      security: securityCompiled,
      signaling: store.signaling ?? null,
      bipCitations,
      claims: bundleClaims,
      withdrawn: bundleWithdrawn,
      topics: bundleTopics,
      writtenTopics: store.topics,
      proposals: bundleProposals,
      debates: visibleDebates,
      runs: [...store.runs].sort((a, b) => (a.started.time < b.started.time ? 1 : -1)),
      events,
      snapshots,
      snapshotClaims: newest?.manifest.claims ?? [],
      orangecheck: oc.valid,
      nostr: store.nostr ?? null,
      review: store.review,
      stats,
    },
    issues,
  };
}
