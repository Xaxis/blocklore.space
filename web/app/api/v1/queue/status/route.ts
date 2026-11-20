import { detectSecrets, QueueUpdate, styleIssues } from "@blocklore/core";
import { claimById } from "@/lib/api";
import { brainAuthorized } from "@/lib/kv";
import { updateQueue } from "@/lib/queue";

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
  const unknown = (u.claims ?? []).filter((id) => !claimById(id));
  if (unknown.length)
    return reply({ error: `Not published in this edition: ${unknown.join(", ")}.` }, 400);
  if (u.note && (styleIssues(u.note).length || detectSecrets(u.note).length))
    return reply(
      { error: "The note breaks the house style or looks like it holds a secret." },
      400,
    );
  if (u.status === "answered" && !u.claims?.length)
    return reply({ error: "An answered question names the claims that answer it." }, 400);
  const item = await updateQueue(u);
  if (!item) return reply({ error: `No queued question ${u.id}.` }, 404);
  return reply({ item });
}
