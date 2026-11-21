import { QueueUpdate } from "@blocklore/core";
import { ownerFor } from "@/lib/admin/auth";
import { updateProblem, updateQueue } from "@/lib/queue";

// The owner moderates the reader queue directly on the site: status, a note, answering claims.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await ownerFor(req))) return Response.json({ error: "Not signed in." }, { status: 401 });
  const p = QueueUpdate.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Not a valid queue change." }, { status: 400 });
  const problem = updateProblem(p.data);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const item = await updateQueue(p.data);
  if (!item)
    return Response.json(
      { error: "No such question, or the queue is not available." },
      { status: 404 },
    );
  return Response.json({ item });
}
