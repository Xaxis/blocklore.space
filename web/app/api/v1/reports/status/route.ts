import { ReportUpdate } from "@blocklore/core";
import { brainAuthorized } from "@/lib/kv";
import { updateReport } from "@/lib/reports";

// The brain reports what its recheck or research found: the claim still holds (with what was
// checked), failed a check (with what failed), is being researched, or was researched. Bearer
// QUEUE_PULL_TOKEN. A report the owner dismissed stays dismissed (409).

export const dynamic = "force-dynamic";

const reply = (data: unknown, status = 200) =>
  new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function POST(req: Request) {
  if (!brainAuthorized(req)) return reply({ error: "Not authorized." }, 401);
  let u: ReportUpdate;
  try {
    u = ReportUpdate.parse(JSON.parse(await req.text()));
  } catch {
    return reply({ error: "Send a ReportUpdate: {id, status, outcome}." }, 400);
  }
  const r = await updateReport(u);
  if (!r.ok) return reply({ error: r.error }, r.status);
  return reply({ item: r.item });
}
