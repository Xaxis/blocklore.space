import { handleMcp, MCP_MAX_BODY } from "@blocklore/core";
import { MCP_SERVER } from "@/lib/mcp";

// The Model Context Protocol endpoint: read-only tools over the published store (lib/mcp.ts). The
// protocol lives in core/src/mcp.ts. Reader text arrives in POST bodies only, never in URLs, so
// nothing a reader types lands in request logs.

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

async function answer(req: Request): Promise<Response> {
  // A UTF-8 character is at most 4 bytes, so a longer declared body is over the limit unread.
  const declared = Number(req.headers.get("content-length") ?? "0");
  const body =
    req.method !== "POST"
      ? ""
      : declared > MCP_MAX_BODY * 4
        ? "x".repeat(MCP_MAX_BODY + 1)
        : await req.text();
  const out = handleMcp(
    { method: req.method, header: (name) => req.headers.get(name), body },
    MCP_SERVER,
  );
  return new Response(out.body === null ? null : `${JSON.stringify(out.body)}\n`, {
    status: out.status,
    headers: {
      ...CORS,
      ...(out.body === null ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      "Cache-Control": "no-store",
      ...out.headers,
    },
  });
}

export const POST = answer;
export const GET = answer;
export const DELETE = answer;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
