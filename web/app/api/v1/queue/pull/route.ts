import { brainAuthorized } from "@/lib/kv";
import { pullQueue } from "@/lib/queue";

// The brain's side of the queue: new questions since the last pull (each returned once), or every
// question with ?all=1. Bearer QUEUE_PULL_TOKEN, compared in constant time.

export const dynamic = "force-dynamic";

const reply = (data: unknown, status = 200) =>
  new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function GET(req: Request) {
  if (!brainAuthorized(req)) return reply({ error: "Not authorized." }, 401);
  const all = new URL(req.url).searchParams.get("all") === "1";
  const items = await pullQueue(all);
  if (!items) return reply({ error: "The research queue is not available." }, 503);
  return reply({ items });
}
