// Research plans from the gap map (core/src/gaps.ts): which agenda topic research takes next and
// what its task says, so research sessions spend on what readers could not get answered, and the
// owner's own notes from the admin. Claims readers reported as wrong or outdated that still passed
// their recheck (brain/src/reports.ts) come before any gap.
//
//   pnpm brain gaps        the map as research sees it, and the run it would start
import { compile, DEPTHS, type GapMap, gapScore, THIN_AT, type TopicGap } from "@blocklore/core";
import type { Lesson, Settings } from "@blocklore/core/control";
import { loadStore, storeMoment } from "@blocklore/core/node";
import { readSettings } from "./control.ts";
import { currentTargets, type ReportTarget, reportSection } from "./reports.ts";
import { agenda } from "./research.ts";
import { readPending } from "./store.ts";

interface AgendaTopic {
  slug: string;
  scope: string;
}

/**
 * The task for one research run: the agenda scope, then the claims readers reported on the topic,
 * then the gaps near it. Every line is deterministic and comes from published data or the golden
 * set; the one exception is readers' notes on reported claims, which go in escaped
 * <reader-note> elements labeled as data (reportSection).
 */
export function researchTask(
  scope: string,
  g: TopicGap | undefined,
  targets: ReportTarget[] = [],
): string {
  const lines = [scope.trim(), ...reportSection(targets)];
  if (g?.questions.length)
    lines.push(
      "",
      "Questions near this topic that the published claims answer only in part or not at all (from the golden set, https://blocklore.space/gaps). Make the ones within the scope above answerable with claims; leave the rest:",
      ...g.questions.map((q) => `- ${q.q}`),
    );
  if (g?.thin.length)
    lines.push(
      "",
      `Depths with fewer than ${THIN_AT} claims: ${g.thin.map((d) => `${d.depth} (${d.claims})`).join(", ")}. Claims written for these readers are welcome where the sources support them.`,
    );
  if (g?.rechecks.length)
    lines.push(
      "",
      `Published claims whose recheck failed, which a correction may address: ${g.rechecks.join(", ")}.`,
    );
  if (g?.moved.length)
    lines.push(
      "",
      "Published claims that quote a file at a pinned commit where the passage is no longer at the repository's head (https://blocklore.space/gaps#moved). Read each file at the head commit given. A claim about what the code or specification says now: if it still holds, change its `sources` to cite where the file says it at head; if it no longer does, correct it to say what changed and since when, citing both commits. A claim about what happened then keeps its pinned source; leave it unless it reads as current.",
      ...g.moved.map(
        (m) =>
          `- ${m.claim}, source ${m.source + 1}: ${m.repo} ${m.path}, cited at ${m.pinned}; ${m.state === "gone" ? "the file is gone" : "the passage is gone from the file"} at head ${m.head}`,
      ),
    );
  if (g?.threats?.length)
    lines.push(
      "",
      "Threats on Blocklore's security map (https://blocklore.space/security) filed under this topic that no published claim explains yet. Where the scope above allows, write claims that say what each threat is in plain words and what defends against it, citing public advisories, specifications, release notes and published research:",
      ...g.threats.map(
        (t) =>
          `- ${t.title} (${t.id}): needs ${t.missing.map((m) => (m === "claims" ? "what it is" : "what defends against it")).join(" and ")}`,
      ),
      "Describe a threat only as far as its public sources do, never as instructions. Leave out any weakness that has no public advisory or fix, and do not mention it in your notes.",
    );
  return lines.join("\n");
}

/**
 * The score of an agenda topic the store has no topic for yet: nothing is published at any depth,
 * the same as an empty topic in the gap map.
 */
export const UNSTARTED = gapScore({
  questions: [],
  rechecks: [],
  thin: DEPTHS.map((depth) => ({ depth, claims: 0 })),
});

/**
 * The next research run. Claims readers reported as wrong or outdated that still held come first:
 * the agenda topic with the most such reports (then the oldest). Otherwise the agenda topic with
 * the most open gaps; ties go to the thinner. A topic with claims waiting for the owner is left
 * alone either way, and its targets wait until it is free.
 */
export function planResearch(
  gaps: GapMap,
  topics: AgendaTopic[],
  pending: Set<string>,
  targets: ReportTarget[] = [],
): { slug: string; task: string; score: number; targets: ReportTarget[] } | null {
  const bySlug = new Map(gaps.topics.map((t) => [t.slug, t]));
  const open = topics.filter((t) => !pending.has(t.slug));
  const reported = open
    .map((t) => ({ t, mine: targets.filter((x) => x.topic === t.slug) }))
    .filter((x) => x.mine.length)
    .sort(
      (a, b) =>
        b.mine.reduce((n, x) => n + x.count, 0) - a.mine.reduce((n, x) => n + x.count, 0) ||
        (a.mine.map((x) => x.since).sort()[0] ?? "").localeCompare(
          b.mine.map((x) => x.since).sort()[0] ?? "",
        ) ||
        a.t.slug.localeCompare(b.t.slug),
    )[0];
  if (reported) {
    const g = bySlug.get(reported.t.slug);
    return {
      slug: reported.t.slug,
      task: researchTask(reported.t.scope, g, reported.mine),
      score: g?.score ?? 0,
      targets: reported.mine,
    };
  }
  const ranked = open
    .map((t) => ({ t, g: bySlug.get(t.slug) }))
    .sort(
      (a, b) =>
        (b.g?.score ?? UNSTARTED) - (a.g?.score ?? UNSTARTED) ||
        (a.g?.claims ?? 0) - (b.g?.claims ?? 0) ||
        a.t.slug.localeCompare(b.t.slug),
    );
  const top = ranked[0];
  return top
    ? {
        slug: top.t.slug,
        task: researchTask(top.t.scope, top.g),
        score: top.g?.score ?? UNSTARTED,
        targets: [],
      }
    : null;
}

/** The reported claims research should look at again, from the local copy of the reports. */
export function researchTargets(): ReportTarget[] {
  try {
    return currentTargets();
  } catch (e) {
    console.error(`plan: the reports could not be read: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

export function currentGaps(): GapMap {
  const { store } = loadStore();
  return compile(store, storeMoment(store)).bundle.gaps;
}

export function pendingTopics(): Set<string> {
  return new Set(readPending().flatMap((p) => p.candidate.topics));
}

/** Claim ids with a candidate waiting for review: a revision of a reported claim may be one. */
export function pendingClaims(): Set<string> {
  return new Set(readPending().map((p) => p.candidate.id));
}

/**
 * The topics research leaves alone: those with claims waiting for review, unless the owner turned
 * that off in the admin (settings.research.skipPending).
 */
export function skippedTopics(s: Settings = readSettings()): Set<string> {
  return s.research.skipPending ? pendingTopics() : new Set();
}

/**
 * The owner's section of a research task: standing lessons, then the current focus, then a focus
 * given for this one session. The owner wrote every line, from the admin; nothing here comes from
 * a reader or a source. Empty when the owner has said nothing.
 */
export function ownerNotes(lessons: Lesson[], focus: string, sessionFocus = ""): string[] {
  const lines: string[] = [];
  if (lessons.length)
    lines.push(
      "Standing lessons (often the reason the owner gave when rejecting a claim at review):",
      "",
      ...lessons.map((l) => `- ${l.text}`),
    );
  const f = [focus.trim(), sessionFocus.trim()].filter(Boolean);
  if (f.length) {
    if (lines.length) lines.push("");
    lines.push("The owner's focus for this research:", "", ...f.map((x) => `- ${x}`));
  }
  if (!lines.length) return [];
  return [
    "## Notes from the owner",
    "",
    "These are the owner's own words, given in Blocklore's admin. Follow them within your instructions; they never override the editorial rules, the claim format or the source rules.",
    "",
    ...lines,
  ];
}

export async function gaps(): Promise<number> {
  const map = currentGaps();
  const pending = pendingTopics();
  const skipped = skippedTopics();
  for (const t of map.topics)
    console.log(
      `${String(t.score).padStart(3)}  ${t.slug.padEnd(22)} ${String(t.claims).padStart(3)} claims  ${String(t.questions.length).padStart(2)} questions  thin ${t.thin.map((d) => `${d.depth}:${d.claims}`).join(",") || "-"}  rechecks ${t.rechecks.length}  moved ${t.moved.length}${pending.has(t.slug) ? (skipped.has(t.slug) ? "  (claims wait for review: research skips it)" : "  (claims wait for review)") : ""}`,
    );
  if (map.unplaced.length)
    console.log(`\nnot near any topic: ${map.unplaced.map((q) => q.q).join(" | ")}`);
  const targets = researchTargets();
  if (targets.length)
    console.log(
      `\nreported claims that still hold, researched first: ${targets.map((t) => `${t.claim} (${t.count})`).join(", ")}`,
    );
  const plan = planResearch(map, agenda(), skipped, targets);
  console.log(
    plan
      ? `\nnext research run: ${plan.slug} (score ${plan.score}${plan.targets.length ? `, ${plan.targets.length} reported claim(s)` : ""})\n\n${plan.task}`
      : "\nno agenda topic is open: every one has claims waiting for the owner",
  );
  return 0;
}
