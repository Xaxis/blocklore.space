import { claimId } from "@blocklore/core";
import { asOfTarget } from "@/lib/asof";

// The time machine's form without script: `?moment=` goes to the page that shows the claim then.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/claims/[id]/at">) {
  const { id } = await ctx.params;
  if (!claimId.safeParse(id).success) return new Response("No such claim.\n", { status: 404 });
  const typed = new URL(req.url).searchParams.get("moment");
  return Response.redirect(new URL(asOfTarget(`/claims/${id}`, typed), req.url), 303);
}
