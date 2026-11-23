import { bipJson, edition, json } from "@/lib/api";
import { readBipNumber } from "@/lib/bips";

// Per request like one claim or topic: the bundle is in memory, so an answer costs microseconds,
// and the CDN keeps it until the next deploy.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/bips/[n]">) {
  const { n } = await ctx.params;
  const number = readBipNumber(n);
  const bip = number === null ? null : bipJson(number);
  return bip
    ? json({ edition: edition(), ...bip }, { sMaxAge: 300 })
    : json(
        { error: "The BIP index at the commit Blocklore read lists no BIP with that number." },
        { status: 404 },
      );
}
