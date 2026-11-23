import { ReportOwnerAction } from "@blocklore/core";
import { ownerFor } from "@/lib/admin/auth";
import { ownerReport } from "@/lib/reports";

// The owner acts on a reader report from the admin: dismiss it as abuse, or reopen it so the brain
// rechecks the claim again.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await ownerFor(req))) return Response.json({ error: "Not signed in." }, { status: 401 });
  const p = ReportOwnerAction.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Not a valid report action." }, { status: 400 });
  const r = await ownerReport(p.data);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ item: r.item });
}
