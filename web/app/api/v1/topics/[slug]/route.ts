import { edition, json, topicAtJson, topicBySlug } from "@/lib/api";
import { readAsOf } from "@/lib/asof";

// Per request, so `?at=` can ask for the topic as it stood at a past moment. The bundle is in
// memory, so an answer costs microseconds, and the CDN keeps it until the next deploy.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/v1/topics/[slug]">) {
  const { slug } = await ctx.params;
  const at = new URL(req.url).searchParams.get("at");
  if (at === null) {
    const topic = topicBySlug(slug);
    return topic
      ? json({ edition: edition(), topic }, { sMaxAge: 300 })
      : json({ error: "No published topic has that slug." }, { status: 404 });
  }
  const moment = readAsOf(at);
  if ("error" in moment) return json({ error: moment.error }, { status: 400 });
  const past = topicAtJson(slug, moment.asOf);
  return past
    ? json({ edition: edition(), ...past }, { sMaxAge: 86400 })
    : json({ error: "No topic has that slug." }, { status: 404 });
}
