import { debateJson, edition, json } from "@/lib/api";
import { getDebate } from "@/lib/debates";

// Per request like one topic or BIP: the bundle is in memory, and the CDN keeps the answer until
// the next deploy.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/debates/[slug]">) {
  const { slug } = await ctx.params;
  const d = getDebate(slug);
  return d
    ? json({ edition: edition(), debate: debateJson(d) }, { sMaxAge: 300 })
    : json(
        {
          error:
            "No published debate map has that slug. GET /api/v1/debates lists every one; a map publishes only once every claim in it has passed the evaluator.",
        },
        { status: 404 },
      );
}
