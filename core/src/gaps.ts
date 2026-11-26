// The gap map (BACKLOG 30): what the store does not hold yet, read from data that is already
// published, so the site can show it and research can take the topic with the most of it next.
//
//   questions  golden questions the claims cover only in part or not at all (the owner-run bench
//              answers them from the claims with a model; knowledge/bench.json),
//              placed on the topic search finds nearest
//   thin       depths where a topic has fewer than THIN_AT claims, so the depth dial runs dry
//   rechecks   published claims whose sources no longer bear them out (knowledge/rechecks.json)
//   moved      passages published claims quote from a file at a pinned commit that are no longer
//              at the repository's head (each claim's at_head, core/src/athead.ts), until a daily
//              research run on the topic has had them in its task
//   pending    claims waiting for the owner's review, which research leaves alone
//   threats    threats on the security map (core/src/security.ts) filed under the topic that
//              lack a published claim explaining them or their defenses
//   advisories advisories the security watch read that no rule of core/src/advisories.ts files
//              under a threat and the owner has not placed: the owner's to map, never research's
//
// Pure: the bundle compiler calls it, and the brain reads the result from the bundle.
import type { AdvisoryView } from "./advisories.ts";
import type { AtHeadOf } from "./athead.ts";
import type { BundleClaim, BundleTopic } from "./bundle.ts";
import { runTopic } from "./loopreview.ts";
import {
  DEPTHS,
  type Depth,
  type Rechecks,
  type ReviewCount,
  type Run,
  type Scorecard,
  type Stamp,
} from "./schema.ts";
import { buildIndex, nearestScope, searchClaims, specificWords } from "./search.ts";
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
  /**
   * Passages its claims quote at a pinned commit that are no longer at the repository's head, and
   * no daily research run on the topic has had in its task yet (`researchedAfter`).
   */
  moved: MovedSource[];
  /**
   * Threats filed under this topic that research still has to explain, each with the published
   * claims that name it but it does not list yet (`threatSuggestions`), which research may link.
   */
  threats: (Pick<ThreatGap, "id" | "title" | "missing"> & { named: NamedClaim[] })[];
  /**
   * Advisories nothing files under a threat whose title and page are nearest this topic, for
   * research to explain with claims that cite them; they never weigh on the score.
   */
  advisories: Pick<UnmappedAdvisory, "source" | "title" | "url" | "ids">[];
  score: number;
}

export type MovedSource = { claim: string } & Pick<
  AtHeadOf,
  "source" | "repo" | "path" | "pinned" | "head" | "state"
>;

/**
 * When the first daily research run on `topic` began after a passage moved on at `since`. That
 * run's task listed the passage, so research has since either changed the claim, and the reading
 * drops away, or left it on purpose as a claim about what happened then; it stops counting as a
 * gap either way. Null until such a run.
 */
export function researchedAfter(
  topic: string,
  since: Stamp,
  runs: readonly Pick<Run, "id" | "kind" | "started">[],
): Stamp | null {
  const after = runs
    .filter(
      (r) =>
        r.kind === "daily" &&
        runTopic(r.id) === topic &&
        Date.parse(r.started.time) > Date.parse(since.time),
    )
    .sort((a, b) => Date.parse(a.started.time) - Date.parse(b.started.time));
  return after[0]?.started ?? null;
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
  g: Pick<TopicGap, "questions" | "rechecks" | "thin"> & {
    threats?: unknown[];
    moved?: readonly { claim: string }[];
  },
): number {
  // A moved passage weighs least: the claim still holds as cited at its commit.
  const moved = new Set((g.moved ?? []).map((m) => m.claim)).size;
  return (
    3 * g.questions.length +
    2 * g.rechecks.length +
    2 * (g.threats?.length ?? 0) +
    g.thin.length +
    moved
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

/**
 * Where a reader's question goes: the agenda topic whose scope is nearest its own words, else the
 * topic of the published claims nearest them. Scopes say what each topic covers, so a question on
 * a topic nothing is published on yet still reaches research there; claims alone pull a question
 * toward whichever topic has the most of them. Null when neither is near or it has no words of
 * its own.
 */
export function placeQuestion(
  index: ReturnType<typeof buildIndex>,
  claims: Record<string, BundleClaim>,
  agenda: readonly { slug: string; title: string; scope: string }[],
  q: string,
): string | null {
  const words = specificWords(q);
  if (!words) return null;
  return nearestScope(agenda, words) ?? nearestTopic(index, claims, words);
}

/** A published claim whose statement names a threat it is not linked to. */
export interface NamedClaim {
  id: string;
  statement: string;
}

/**
 * The topic most advisories of each project are filed under, by the topics of the threats that
 * file them; ties go to the topic first in name order.
 */
export function advisoryTopics(
  advisories: readonly Pick<AdvisoryView, "source" | "matches">[],
  threats: readonly Pick<ThreatGap, "id" | "topic">[],
): Map<string, string> {
  const topic = new Map(threats.map((t) => [t.id, t.topic]));
  const votes = new Map<string, Map<string, number>>();
  for (const a of advisories)
    for (const m of a.matches) {
      const t = topic.get(m.threat);
      if (!t) continue;
      const v = votes.get(a.source) ?? new Map<string, number>();
      v.set(t, (v.get(t) ?? 0) + 1);
      votes.set(a.source, v);
    }
  return new Map(
    [...votes].flatMap(([source, v]) => {
      const top = [...v].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
      return top ? [[source, top[0]] as const] : [];
    }),
  );
}

/** The words of a page's path: "/en/2024/07/03/disclose_receive_buffer_oom/" gives "receive buffer oom". */
function pathWords(url: string): string {
  try {
    return new URL(url).pathname
      .split(/[/_.-]+/)
      .filter((w) => /^[a-z]{3,}$/i.test(w) && !/^(disclose|disclosure|html?|en)$/i.test(w))
      .join(" ");
  } catch {
    return "";
  }
}

export function gapMap(input: {
  claims: Record<string, BundleClaim>;
  topics: BundleTopic[];
  review: ReviewCount[];
  rechecks: Rechecks;
  scorecard: Scorecard | null;
  threats?: (ThreatGap & { named?: readonly NamedClaim[] })[];
  advisories?: readonly UnmappedAdvisory[];
  /** Each project's topic, where most of its filed advisories are (`advisoryTopics`). */
  advisoryTopics?: ReadonlyMap<string, string>;
  runs?: readonly Pick<Run, "id" | "kind" | "started">[];
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
  // An advisory goes where most of its project's filed advisories are; a project with none filed
  // yet places it by its title and the words of its page's path, since some titles are only an id
  // ("Disclosure of CVE-2015-3641") while the page says what it was.
  const advised = new Map<string, TopicGap["advisories"]>();
  for (const a of input.advisories ?? []) {
    const t =
      input.advisoryTopics?.get(a.source) ??
      nearestTopic(index, input.claims, `${a.title} ${pathWords(a.url)}`);
    if (t)
      advised.set(t, [
        ...(advised.get(t) ?? []),
        { source: a.source, title: a.title, url: a.url, ids: a.ids },
      ]);
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
      moved: mine.flatMap((c) =>
        c.at_head
          .filter((a) => a.state !== "current" && !researchedAfter(slug, a.since, input.runs ?? []))
          .map(({ source, repo, path, pinned, head, state }) => ({
            claim: c.id,
            source,
            repo,
            path,
            pinned,
            head,
            state,
          })),
      ),
      threats: threats
        .filter((t) => t.topic === slug)
        .map((t) => ({
          id: t.id,
          title: t.title,
          missing: t.missing,
          named: [...(t.named ?? [])],
        })),
      advisories: advised.get(slug) ?? [],
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
