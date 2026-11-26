import { buildIndex, nearestTopic, takenBy } from "@blocklore/core";
import type { Metadata } from "next";
import { type QuestionRoute, Questions } from "@/components/admin/Questions";
import { bundle } from "@/lib/data";
import { pullQueue } from "@/lib/queue";

export const metadata: Metadata = { title: "Reader questions" };
export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  // `all` reads every question without marking any as pulled, so the brain still sees new ones.
  const items = await pullQueue(true).catch(() => null);
  // Where research would take each question up, the same way the brain places it
  // (brain/src/plan.ts), and the published runs whose task carried it.
  const index = buildIndex(Object.values(bundle.claims));
  const taken = takenBy(bundle.runs);
  const titles = new Map(bundle.topics.map((t) => [t.slug, t.title]));
  const routes: Record<string, QuestionRoute> = {};
  for (const i of items ?? []) {
    const topic = i.status === "declined" ? null : nearestTopic(index, bundle.claims, i.q);
    routes[i.id] = {
      topic,
      title: topic ? (titles.get(topic) ?? topic) : null,
      runs: taken.get(i.id) ?? [],
    };
  }
  return (
    <>
      <header className="page-header">
        <h1>Reader questions</h1>
        <p className="lede">
          Questions readers suggested for research. Each hour the brain accepts a waiting question
          that search places near a published claim, unless it reads as instructions to a model;
          research takes it up on that topic, after reported claims and before any other gap, and
          lists it in its public log; once the claims research named for it publish, the brain marks
          it answered with them. Questions near no claim, or that read as instructions, wait here
          for you. You can change any status; the brain never undoes yours. Waiting and declined
          questions are never shown in public.
        </p>
      </header>
      <Questions initial={items} routes={routes} />
    </>
  );
}
