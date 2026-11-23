import { edition } from "@/lib/api";
import { publicReports } from "@/lib/reports";

// Every reader report and what became of it, newest first: kind, dates, count, outcome and the
// claim's statement. Never a reader's note. The corrections view lists the same.

export const dynamic = "force-dynamic";

const reply = (data: unknown, status = 200, maxAge = 0) =>
  new Response(`${JSON.stringify(data, null, 1)}\n`, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

export async function GET() {
  const reports = await publicReports();
  if (!reports) return reply({ error: "Reports are not available right now." }, 503);
  const counts: Record<string, number> = {};
  for (const r of reports) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return reply({ edition: edition(), counts, reports }, 200, 60);
}
