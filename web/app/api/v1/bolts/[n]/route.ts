import { boltJson, edition, json } from "@/lib/api";
import { readBoltNumber } from "@/lib/bolts";

// Per request like one BIP: the bundle is in memory, so an answer costs microseconds, and the CDN
// keeps it until the next deploy.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/bolts/[n]">) {
  const { n } = await ctx.params;
  const number = readBoltNumber(n);
  const bolt = number === null ? null : boltJson(number);
  return bolt
    ? json({ edition: edition(), ...bolt }, { sMaxAge: 300 })
    : json(
        {
          error:
            "BOLT #0, the Lightning specification's index at the commit Blocklore read, lists no BOLT with that number.",
        },
        { status: 404 },
      );
}
