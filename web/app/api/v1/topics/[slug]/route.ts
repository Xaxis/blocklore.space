import { edition, json, topicBySlug } from "@/lib/api";
import { bundle } from "@/lib/data";

export const dynamic = "force-static";

export function generateStaticParams() {
  return bundle.topics.map((t) => ({ slug: t.slug }));
}

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/topics/[slug]">) {
  const { slug } = await ctx.params;
  const topic = topicBySlug(slug);
  return topic
    ? json({ edition: edition(), topic })
    : json({ error: "No published topic has that slug." }, { status: 404 });
}
