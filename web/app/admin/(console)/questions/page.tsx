import type { Metadata } from "next";
import { Questions } from "@/components/admin/Questions";
import { pullQueue } from "@/lib/queue";

export const metadata: Metadata = { title: "Reader questions" };
export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  // `all` reads every question without marking any as pulled, so the brain still sees new ones.
  const items = await pullQueue(true).catch(() => null);
  return (
    <>
      <header className="page-header">
        <h1>Reader questions</h1>
        <p className="lede">
          Questions readers suggested for research. The brain triages new ones on its daily tick;
          here you can do it yourself. Waiting and declined questions are never shown in public.
        </p>
      </header>
      <Questions initial={items} />
    </>
  );
}
