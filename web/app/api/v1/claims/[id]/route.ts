import { claimAtJson, claimById, edition, json } from "@/lib/api";
import { readAsOf } from "@/lib/asof";

// Per request, so `?at=` can ask for the claim as it stood at a past moment. The bundle is in
// memory, so an answer costs microseconds, and the CDN keeps it until the next deploy.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/v1/claims/[id]">) {
  const { id } = await ctx.params;
  const at = new URL(req.url).searchParams.get("at");
  if (at === null) {
    const claim = claimById(id);
    return claim
      ? json({ edition: edition(), claim }, { sMaxAge: 300 })
      : json({ error: "No published claim has that id." }, { status: 404 });
  }
  const moment = readAsOf(at);
  if ("error" in moment) return json({ error: moment.error }, { status: 400 });
  const past = claimAtJson(id, moment.asOf);
  if (!past) return json({ error: "No published claim has that id." }, { status: 404 });
  if ("before" in past)
    return json(
      {
        error: `That claim was not published yet at that moment: it was first published at block ${past.before?.height}, ${past.before?.time}.`,
        first_seen: past.before,
      },
      { status: 404, sMaxAge: 86400 },
    );
  return json({ edition: edition(), ...past }, { sMaxAge: 86400 });
}
