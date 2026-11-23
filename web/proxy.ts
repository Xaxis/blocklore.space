import { REACH_SKIP_HEADER, reachOf } from "@blocklore/core/reach";
import type { NextFetchEvent, NextRequest } from "next/server";
import { addReach } from "@/lib/reach";

// Counts machine use of Blocklore (core/src/reach.ts): the API, the export, llms.txt, the feeds and
// the edition proofs. It runs before the cache, so static answers count too, and it only counts:
// every request passes through unchanged, and the count is written after the answer goes out. The
// MCP server counts its own tool calls (app/mcp/route.ts), since only it reads the body.

export function proxy(req: NextRequest, event: NextFetchEvent) {
  if (req.headers.has(REACH_SKIP_HEADER)) return;
  const site = req.headers.get("sec-fetch-site") === "same-origin";
  const fields = reachOf(req.nextUrl.pathname, req.method, site);
  if (fields.length) event.waitUntil(addReach(fields, new Date().toISOString().slice(0, 10)));
}

export const config = {
  matcher: [
    "/api/v1",
    // Not the brain's own routes: every open page polls /api/v1/brain.
    "/api/v1/((?!brain|queue/|reports/).+)",
    "/exports/claims.jsonl",
    "/llms.txt",
    "/llms-full.txt",
    "/rss.xml",
    "/changes.xml",
    "/topics/:slug/changes.xml",
    "/snapshots/:file+",
    "/orangecheck/:path+",
  ],
};
