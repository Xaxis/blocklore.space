import { readBipNumber } from "@/lib/bips";

// A BIP's page lives under Proposals, where the bar places it (web/lib/nav.ts). /bips/<n> is the
// address a reader of the index might guess, so it points there for good.
export async function GET(req: Request, ctx: RouteContext<"/bips/[n]">) {
  const { n } = await ctx.params;
  const number = readBipNumber(n);
  return number === null
    ? new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain" } })
    : Response.redirect(new URL(`/proposals/${number}`, req.url), 308);
}
