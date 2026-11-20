// Research plans from the gap map (core/src/gaps.ts): which agenda topic research takes next and
// what its task says, so the paid research timer spends on what readers could not get answered.
//
//   pnpm brain gaps        the map as research sees it, and the run it would start
import { compile, type GapMap, THIN_AT, type TopicGap } from "@blocklore/core";
import { loadStore, storeMoment } from "@blocklore/core/node";
import { agenda } from "./research.ts";
import { readPending } from "./store.ts";

interface AgendaTopic {
  slug: string;
  scope: string;
}

/**
 * The task for one research run: the agenda scope, then the gaps near the topic. Every line is
 * deterministic and comes from published data or the golden set, never from a reader.
 */
export function researchTask(scope: string, g: TopicGap | undefined): string {
  const lines = [scope.trim()];
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
  return lines.join("\n");
}

/** The agenda topic with the most open gaps and nothing waiting for the owner; ties go to the thinner. */
export function planResearch(
  gaps: GapMap,
  topics: AgendaTopic[],
  pending: Set<string>,
): { slug: string; task: string; score: number } | null {
  const bySlug = new Map(gaps.topics.map((t) => [t.slug, t]));
  const ranked = topics
    .filter((t) => !pending.has(t.slug))
    .map((t) => ({ t, g: bySlug.get(t.slug) }))
    .sort(
      (a, b) =>
        (b.g?.score ?? 0) - (a.g?.score ?? 0) ||
        (a.g?.claims ?? 0) - (b.g?.claims ?? 0) ||
        a.t.slug.localeCompare(b.t.slug),
    );
  const top = ranked[0];
  return top
    ? { slug: top.t.slug, task: researchTask(top.t.scope, top.g), score: top.g?.score ?? 0 }
    : null;
}

export function currentGaps(): GapMap {
  const { store } = loadStore();
  return compile(store, storeMoment(store)).bundle.gaps;
}

export function pendingTopics(): Set<string> {
  return new Set(readPending().flatMap((p) => p.candidate.topics));
}

export async function gaps(): Promise<number> {
  const map = currentGaps();
  const pending = pendingTopics();
  for (const t of map.topics)
    console.log(
      `${String(t.score).padStart(3)}  ${t.slug.padEnd(22)} ${String(t.claims).padStart(3)} claims  ${String(t.questions.length).padStart(2)} questions  thin ${t.thin.map((d) => `${d.depth}:${d.claims}`).join(",") || "-"}  rechecks ${t.rechecks.length}${pending.has(t.slug) ? "  (claims wait for review: research skips it)" : ""}`,
    );
  if (map.unplaced.length)
    console.log(`\nnot near any topic: ${map.unplaced.map((q) => q.q).join(" | ")}`);
  const plan = planResearch(map, agenda(), pending);
  console.log(
    plan
      ? `\nnext research run: ${plan.slug} (score ${plan.score})\n\n${plan.task}`
      : "\nno agenda topic is open: every one has claims waiting for the owner",
  );
  return 0;
}
