import { BADGES, badgeSvg } from "@/lib/badges";

// /badge/claims.svg, /badge/lab.svg, /badge/evaluator.svg, /badge/sealed.svg: one number each,
// from the edition this build serves (web/lib/badges.ts).

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(BADGES).map((name) => ({ name: `${name}.svg` }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const badge = name.endsWith(".svg") ? BADGES[name.slice(0, -4)]?.() : null;
  if (!badge) return new Response("No such badge.\n", { status: 404 });
  return new Response(badgeSvg(badge), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
