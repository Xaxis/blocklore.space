import { takenBy } from "@blocklore/core";
import { z } from "zod";
import { edition } from "@/lib/api";
import { bundle } from "@/lib/data";
import { clientIp } from "@/lib/kv";
import { enqueue, publicQueue } from "@/lib/queue";

// The research queue: what readers suggest the brain research next. GET lists the triaged
// suggestions, each with the published research runs that took it up, and counts the rest; POST
// adds one.

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

export async function GET() {
  const q = await publicQueue();
  if (!q) return reply({ error: "The research queue is not available right now." }, 503);
  const taken = takenBy(bundle.runs);
  return reply(
    {
      edition: edition(),
      waiting: q.waiting,
      questions: q.questions.map((i) => ({ ...i, runs: taken.get(i.id) ?? [] })),
    },
    200,
    60,
  );
}

const Body = z.strictObject({ q: z.unknown() });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 2000) return reply({ error: "The body is limited to 2000 characters." }, 413);
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(raw));
  } catch {
    return reply(
      {
        error: 'Send JSON: {"q": the question you want Blocklore to research}.',
      },
      400,
    );
  }
  const r = await enqueue({ q: body.q, ip: clientIp(req) });
  if (!r.ok) return reply({ error: r.error }, r.status);
  return reply({ queued: r.added, item: r.item });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Max-Age": "86400" },
  });
}
