import { slug } from "@blocklore/core";
import { asOfTarget } from "@/lib/asof";

// The time machine's form without script: `?moment=` goes to the page that shows the topic then.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/topics/[slug]/at">) {
  const { slug: s } = await ctx.params;
  if (!slug.safeParse(s).success) return new Response("No such topic.\n", { status: 404 });
  const typed = new URL(req.url).searchParams.get("moment");
  return Response.redirect(new URL(asOfTarget(`/topics/${s}`, typed), req.url), 303);
}
