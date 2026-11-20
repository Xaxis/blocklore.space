import { z } from "zod";
import { edition, json, readQuery, searchClaims } from "@/lib/api";

// Search takes reader text, so it comes in a POST body: a URL's query string is written to the
// host's and every proxy's request logs, where refusing a pasted seed afterwards would be too late.

const Body = z.strictObject({ q: z.string(), limit: z.number().int().min(1).max(50).optional() });

export function GET() {
  return json(
    {
      error:
        'Search takes its text in a POST body, so it never lands in a URL that servers and proxies log. Send {"q": "taproot key path", "limit": 10} as application/json.',
    },
    { status: 405, maxAge: 0 },
  );
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 2000)
    return json({ error: "The body is limited to 2000 characters." }, { status: 413, maxAge: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'Send JSON: {"q": "...", "limit": 10}.' }, { status: 400, maxAge: 0 });
  }
  const body = Body.safeParse(parsed);
  if (!body.success)
    return json(
      { error: 'Send JSON: {"q": "...", "limit": 1 to 50}.' },
      { status: 400, maxAge: 0 },
    );
  const q = readQuery(body.data.q);
  if ("error" in q) return json({ error: q.error }, { status: 400, maxAge: 0 });
  return json(
    { edition: edition(), query: q.query, results: searchClaims(q.query, body.data.limit ?? 10) },
    { maxAge: 0 },
  );
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
