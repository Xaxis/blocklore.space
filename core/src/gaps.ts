// The gap map (BACKLOG 30): what the store does not hold yet, read from data that is already
// published, so the site can show it and research can take the topic with the most of it next.
//
//   questions  golden questions Ask answered only in part or not at all (knowledge/bench.json),
//              placed on the topic search finds nearest
//   thin       depths where a topic has fewer than THIN_AT claims, so the depth dial runs dry
//   rechecks   published claims whose sources no longer bear them out (knowledge/rechecks.json)
//   pending    claims waiting for the owner's review, which research leaves alone
//
// Pure: the bundle compiler calls it, and the brain reads the result from the bundle.
import type { BundleClaim, BundleTopic } from "./bundle.ts";
import { DEPTHS, type Depth, type Rechecks, type ReviewCount, type Scorecard } from "./schema.ts";
import { buildIndex, searchClaims } from "./search.ts";

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
}

/** Questions weigh most: a reader asked and got no full answer. */
export function gapScore(g: Pick<TopicGap, "questions" | "rechecks" | "thin">): number {
  return 3 * g.questions.length + 2 * g.rechecks.length + g.thin.length;
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
}): GapMap {
  const all = Object.values(input.claims);
  const index = buildIndex(all);
  const slugs = [
    ...new Set([...input.topics.map((t) => t.slug), ...input.review.map((r) => r.topic)]),
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
    const thin = mine.length
      ? DEPTHS.map((depth) => ({
          depth,
          claims: mine.filter((c) => c.depth === depth).length,
        })).filter((d) => d.claims < THIN_AT)
      : [];
    const g = {
      slug,
      title: input.topics.find((t) => t.slug === slug)?.title ?? null,
      claims: mine.length,
      pending: input.review.find((r) => r.topic === slug)?.count ?? 0,
      thin,
      questions: placed.get(slug) ?? [],
      rechecks: mine.filter((c) => input.rechecks[c.id]).map((c) => c.id),
    };
    return { ...g, score: gapScore(g) };
  });
  topics.sort((a, b) => b.score - a.score || a.claims - b.claims || a.slug.localeCompare(b.slug));
  return {
    scored: input.scorecard?.ask?.ran ?? null,
    topics,
    unplaced,
    misses: input.scorecard?.misses ?? [],
  };
}
