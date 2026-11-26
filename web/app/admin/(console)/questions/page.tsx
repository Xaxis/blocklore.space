import { buildIndex, placeQuestion, takenBy } from "@blocklore/core";
import type { Metadata } from "next";
import { type QuestionRoute, Questions } from "@/components/admin/Questions";
import { readAgenda } from "@/lib/admin/proposed";
import { bundle } from "@/lib/data";
import { pullQueue } from "@/lib/queue";

export const metadata: Metadata = { title: "Reader questions" };
export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  // `all` reads every question without marking any as pulled, so the brain still sees new ones.
  const items = await pullQueue(true).catch(() => null);
  // Where research would take each question up, the same way the brain places it
  // (`placeQuestion`: the nearest agenda scope, else the nearest published claims), and the
  // published runs whose task carried it.
  const index = buildIndex(Object.values(bundle.claims));
  const agenda = readAgenda();
  const taken = takenBy(bundle.runs);
  const pages = new Set(bundle.topics.map((t) => t.slug));
  const titles = new Map([
    ...agenda.map((t) => [t.slug, t.title] as const),
    ...bundle.topics.map((t) => [t.slug, t.title] as const),
  ]);
  const routes: Record<string, QuestionRoute> = {};
  for (const i of items ?? []) {
    const topic = i.status === "declined" ? null : placeQuestion(index, bundle.claims, agenda, i.q);
    routes[i.id] = {
      topic,
      title: topic ? (titles.get(topic) ?? topic) : null,
      page: topic ? pages.has(topic) : false,
      runs: taken.get(i.id) ?? [],
    };
  }
  return (
    <>
      <header className="page-header">
        <h1>Reader questions</h1>
        <p className="lede">
          Questions readers suggested for research. Each hour the brain places a waiting question on
          the agenda topic whose scope is nearest it, else the topic of the published claims nearest
          it, and accepts it; research takes it up there, after reported claims and before any other
          gap, and lists it in its public log; once the claims research named for it publish, the
          brain marks it answered with them. It declines, with a note, a question that reads as
          instructions to a model, asks for a price prediction or trading advice, or that no topic
          is near. You can change any status; the brain never undoes yours. Waiting and declined
          questions are never shown in public.
        </p>
      </header>
      <Questions initial={items} routes={routes} />
    </>
  );
}
