import { bundle } from "@/lib/data";
import { atomFeed } from "@/lib/feeds";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return bundle.topics.map((t) => ({ slug: t.slug }));
}

/** One topic's changes as Atom, so a reader can follow the topic alone. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = bundle.topics.find((t) => t.slug === slug);
  if (!topic) return new Response("Not found", { status: 404 });
  return atomFeed({
    page: `/topics/${slug}`,
    self: `/topics/${slug}/changes.xml`,
    title: `Blocklore: ${topic.title}`,
    events: bundle.events.filter((e) => e.topics.includes(slug)),
    fallback: bundle.generated.time,
  });
}
