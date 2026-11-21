import { QueueUpdate } from "@blocklore/core";
import { brainAuthorized } from "@/lib/kv";
import { updateProblem, updateQueue } from "@/lib/queue";

// The brain reports what became of a queued question: being researched, answered (with the
// published claims that answer it) or declined (with a note). Bearer QUEUE_PULL_TOKEN.

export const dynamic = "force-dynamic";

const reply = (data: unknown, status = 200) =>
  new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function POST(req: Request) {
  if (!brainAuthorized(req)) return reply({ error: "Not authorized." }, 401);
  let u: QueueUpdate;
  try {
    u = QueueUpdate.parse(JSON.parse(await req.text()));
  } catch {
    return reply({ error: "Send a QueueUpdate: {id, status, claims?, note?}." }, 400);
  }
  const problem = updateProblem(u);
  if (problem) return reply({ error: problem }, 400);
  const item = await updateQueue(u);
  if (!item) return reply({ error: `No queued question ${u.id}.` }, 404);
  return reply({ item });
}
