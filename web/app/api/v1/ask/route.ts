import { z } from "zod";
import { json } from "@/lib/api";
import { type AskEvent, ask, readAsk } from "@/lib/ask";

// Ask the Brain. The question comes in a POST body (never a URL, which servers and proxies log), is
// refused if it holds a seed, key or address, and is answered from published claims only. With
// Accept: application/x-ndjson the claims read arrive first, then the result, one JSON per line.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.strictObject({ q: z.unknown(), depth: z.unknown().optional() });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const usage =
  'Send JSON: {"q": "your question", "depth": "curious" | "user" | "holder" | "builder" | "researcher"}.';

export function GET() {
  return json(
    {
      error: `Ask takes its question in a POST body, so it never lands in a URL that servers and proxies log. ${usage}`,
    },
    { status: 405, maxAge: 0 },
  );
}

const refuse = (status: number, error: string) =>
  new Response(`${JSON.stringify({ error })}\n`, {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 2000) return refuse(413, "The body is limited to 2000 characters.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(400, usage);
  }
  const body = Body.safeParse(parsed);
  if (!body.success) return refuse(400, usage);
  const q = readAsk(body.data);
  if ("error" in q) return refuse(q.status, q.error);

  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (!(req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    const result = await ask(q, ip);
    return new Response(`${JSON.stringify(result, null, 1)}\n`, {
      headers: {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AskEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        await ask(q, ip, send);
      } catch (e) {
        console.error(`ask: ${e instanceof Error ? e.name : "error"}`);
        send({ type: "error", error: "Something went wrong answering this question." });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Max-Age": "86400" },
  });
}
