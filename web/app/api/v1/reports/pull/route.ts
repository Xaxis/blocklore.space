import { brainAuthorized } from "@/lib/kv";
import { pullReports } from "@/lib/reports";

// The brain's side of reader reports: reports filed, repeated, dismissed or reopened since the last
// pull (each returned once), or every report with ?all=1, notes included. Bearer QUEUE_PULL_TOKEN,
// the queue's, compared in constant time.

export const dynamic = "force-dynamic";

const reply = (data: unknown, status = 200) =>
  new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function GET(req: Request) {
  if (!brainAuthorized(req)) return reply({ error: "Not authorized." }, 401);
  const all = new URL(req.url).searchParams.get("all") === "1";
  const items = await pullReports(all);
  if (!items) return reply({ error: "Reports are not available." }, 503);
  return reply({ items });
}
