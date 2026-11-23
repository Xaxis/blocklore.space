import { edition } from "@/lib/api";
import { getClaim, getWithdrawn } from "@/lib/data";
import { clientIp } from "@/lib/kv";
import { claimReports, fileReport } from "@/lib/reports";

// Reader reports on one claim. GET lists them as anyone may see them (kind, dates, count, outcome;
// never a note). POST files one: {"kind", "note"?}. One collection with two methods, as the
// suggestion queue is: what was reported and how to report it live at the same address.

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const reply = (data: unknown, status = 200, maxAge = 0) =>
  new Response(`${JSON.stringify(data, null, 1)}\n`, {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/claims/[id]/reports">) {
  const { id } = await ctx.params;
  if (!getClaim(id) && !getWithdrawn(id))
    return reply({ error: "No published claim has that id." }, 404);
  const reports = await claimReports(id);
  if (!reports) return reply({ error: "Reports are not available right now." }, 503);
  return reply({ edition: edition(), claim: id, reports }, 200, 30);
}

export async function POST(req: Request, ctx: RouteContext<"/api/v1/claims/[id]/reports">) {
  const { id } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 2000) return reply({ error: "The body is limited to 2000 characters." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  const r = await fileReport({ claim: id, body, ip: clientIp(req) });
  if (!r.ok) return reply({ error: r.error }, r.status);
  return reply({ added: r.added, report: r.item });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Max-Age": "86400" },
  });
}
