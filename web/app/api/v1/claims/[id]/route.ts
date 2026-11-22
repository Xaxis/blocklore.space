import { claimById, edition, json } from "@/lib/api";
import { allClaims, allWithdrawn } from "@/lib/data";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [...allClaims(), ...allWithdrawn()].map((c) => ({ id: c.id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/claims/[id]">) {
  const { id } = await ctx.params;
  const claim = claimById(id);
  return claim
    ? json({ edition: edition(), claim })
    : json({ error: "No published claim has that id." }, { status: 404 });
}
