// The gap map (BACKLOG 30): what the store does not hold yet, read from data that is already
// published, so the site can show it and research can take the topic with the most of it next.
//
//   questions  golden questions the claims cover only in part or not at all (the owner-run bench
//              answers them from the claims with a model; knowledge/bench.json),
//              placed on the topic search finds nearest
//   thin       depths where a topic has fewer than THIN_AT claims, so the depth dial runs dry
//   rechecks   published claims whose sources no longer bear them out (knowledge/rechecks.json)
//   pending    claims waiting for the owner's review, which research leaves alone
//   threats    threats on the security map (core/src/security.ts) filed under the topic that
//              lack a published claim explaining them or their defenses
//   advisories advisories the security watch read that no rule of core/src/advisories.ts files
//              under a threat and the owner has not placed: the owner's to map, never research's
//
// Pure: the bundle compiler calls it, and the brain reads the result from the bundle.
import type { AdvisoryView } from "./advisories.ts";
import type { BundleClaim, BundleTopic } from "./bundle.ts";
import { DEPTHS, type Depth, type Rechecks, type ReviewCount, type Scorecard } from "./schema.ts";
import { buildIndex, searchClaims } from "./search.ts";
import type { ThreatGap } from "./security.ts";

/** A topic with fewer claims than this at one depth is thin there. */
export const THIN_AT = 3;

export interface GapQuestion {
  id: string;
  kind: string;
  q: string;
  got: string;
}

export interface TopicGap {
  slug: string;
  title: string | null;
  claims: number;
  pending: number;
  thin: { depth: Depth; claims: number }[];
  questions: GapQuestion[];
  rechecks: string[];
  /** Threats filed under this topic that research still has to explain. */
  threats: Pick<ThreatGap, "id" | "title" | "missing">[];
  score: number;
}

export interface GapMap {
  /** When the answers behind `questions` were scored; null before any scored run. */
  scored: string | null;
  /** Most open gaps first. */
  topics: TopicGap[];
  /** Questions search found no claim for at all. */
  unplaced: GapQuestion[];
  /** Questions whose claims exist but rank below 5: search gaps, not knowledge gaps. */
  misses: Scorecard["misses"];
  /**
   * Advisories filed under no threat, newest first: the owner maps them in
   * knowledge/security/advisory-map.yaml. They never weigh on research's choice of topic.
   */
  advisories: UnmappedAdvisory[];
}

export type UnmappedAdvisory = Pick<
  AdvisoryView,
  "source" | "title" | "url" | "published" | "severity" | "ids" | "nvd"
>;

/** Questions weigh most: a reader asked and got no full answer. A threat nobody explains is next. */
export function gapScore(
  g: Pick<TopicGap, "questions" | "rechecks" | "thin"> & { threats?: unknown[] },
): number {
  return (
    3 * g.questions.length + 2 * g.rechecks.length + 2 * (g.threats?.length ?? 0) + g.thin.length
  );
}

/** The topic most of the best search hits belong to, weighted by rank; null when none match. */
export function nearestTopic(
  index: ReturnType<typeof buildIndex>,
  claims: Record<string, BundleClaim>,
  q: string,
): string | null {
  const votes = new Map<string, number>();
  searchClaims(index, claims, q, { limit: 5 }).forEach((h, i) => {
    const t = claims[h.id]?.topics[0];
    if (t) votes.set(t, (votes.get(t) ?? 0) + 5 - i);
  });
  return [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export function gapMap(input: {
  claims: Record<string, BundleClaim>;
  topics: BundleTopic[];
  review: ReviewCount[];
  rechecks: Rechecks;
  scorecard: Scorecard | null;
  threats?: ThreatGap[];
  advisories?: readonly UnmappedAdvisory[];
}): GapMap {
  const all = Object.values(input.claims);
  const index = buildIndex(all);
  const threats = input.threats ?? [];
  const slugs = [
    ...new Set([
      ...input.topics.map((t) => t.slug),
      ...input.review.map((r) => r.topic),
      ...threats.map((t) => t.topic),
    ]),
  ];
  const placed = new Map<string, GapQuestion[]>();
  const unplaced: GapQuestion[] = [];
  for (const s of input.scorecard?.ask?.short ?? []) {
    const t = nearestTopic(index, input.claims, s.q);
    if (t) placed.set(t, [...(placed.get(t) ?? []), s]);
    else unplaced.push(s);
  }
  const topics = slugs.map((slug) => {
    const mine = all.filter((c) => c.topics[0] === slug);
    const pending = input.review.find((r) => r.topic === slug)?.count ?? 0;
    // A topic with nothing published is thin at every depth, unless its claims wait in review.
    const thin =
      mine.length || !pending
        ? DEPTHS.map((depth) => ({
            depth,
            claims: mine.filter((c) => c.depth === depth).length,
          })).filter((d) => d.claims < THIN_AT)
        : [];
    const g = {
      slug,
      title: input.topics.find((t) => t.slug === slug)?.title ?? null,
      claims: mine.length,
      pending,
      thin,
      questions: placed.get(slug) ?? [],
      rechecks: mine.filter((c) => input.rechecks[c.id]).map((c) => c.id),
      threats: threats
        .filter((t) => t.topic === slug)
        .map((t) => ({ id: t.id, title: t.title, missing: t.missing })),
    };
    return { ...g, score: gapScore(g) };
  });
  topics.sort((a, b) => b.score - a.score || a.claims - b.claims || a.slug.localeCompare(b.slug));
  return {
    scored: input.scorecard?.ask?.ran ?? null,
    topics,
    unplaced,
    misses: input.scorecard?.misses ?? [],
    advisories: (input.advisories ?? []).map(
      ({ source, title, url, published, severity, ids, nvd }) => ({
        source,
        title,
        url,
        published,
        severity,
        ids,
        nvd,
      }),
    ),
  };
}
