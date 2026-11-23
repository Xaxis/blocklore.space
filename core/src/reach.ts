// Reach: how much programs and assistants use Blocklore, counted as numbers per UTC day. The
// counters say what was asked for (the API's claims, the MCP server's search tool, the export),
// never who asked: no address, no user agent, no query text. Requests the site's own pages make
// are counted apart, under "site:", so the totals are other people's use.
//
// Pure: the site's proxy and its MCP route call these and do the counting (web/lib/reach.ts).

/**
 * A request carrying this header is not counted: Blocklore's own checks (tools/deploy.sh, the
 * verify scripts) send it, so every deploy does not count as use. Sending it can only lower a count.
 */
export const REACH_SKIP_HEADER = "x-blocklore-check";

/** What each counter measures, in the order a report shows them. */
export const REACH_LABELS: Record<string, string> = {
  "mcp:call": "MCP tool calls",
  "mcp:init": "MCP connections",
  api: "API requests",
  export: "Downloads of the full export",
  llms: "Reads of llms.txt",
  feed: "Feed reads (RSS and Atom)",
  proof: "Downloads of edition proofs and signatures",
};

/** API routes by their first segment after /api/v1/; the brain's own routes are not counted. */
const API_FAMILIES = new Set([
  "claims",
  "topics",
  "changes",
  "search",
  "gaps",
  "bips",
  "snapshots",
  "queue",
  "reports",
]);

/**
 * The counters one request adds to, or none. `site` is true when the browser says the request came
 * from Blocklore's own pages (Sec-Fetch-Site: same-origin); those count under "site:" only.
 */
export function reachOf(pathname: string, method: string, site: boolean): string[] {
  if (method !== "GET" && method !== "POST") return [];
  const p = pathname.replace(/\/+$/, "") || "/";
  let fields: string[] = [];
  if (p === "/api/v1") fields = ["api", "api:index"];
  else if (p.startsWith("/api/v1/")) {
    const [family, rest, more] = p.slice("/api/v1/".length).split("/");
    if (!family || !API_FAMILIES.has(family) || more !== undefined) return [];
    // The brain's pull and status routes under the queue and the reports.
    if ((family === "queue" || family === "reports") && rest !== undefined) return [];
    const one = rest !== undefined && (family === "claims" || family === "topics");
    if (rest !== undefined && !one) return [];
    fields = ["api", `api:${one ? family.slice(0, -1) : family}`];
  } else if (p === "/exports/claims.jsonl") fields = ["export"];
  else if (p === "/llms.txt" || p === "/llms-full.txt") fields = ["llms", `llms:${p.slice(1)}`];
  else if (p === "/rss.xml" || p === "/changes.xml") fields = ["feed", `feed:${p.slice(1)}`];
  else if (/^\/snapshots\/\d+\.json(\.ots|\.stamp)?$/.test(p) || /^\/orangecheck\//.test(p))
    fields = ["proof"];
  else return [];
  if (method === "POST" && fields[0] !== "api") return [];
  return site ? fields.map((f) => `site:${f}`) : fields;
}

/**
 * The counters one MCP request body adds to: a connection for each `initialize`, and for each
 * `tools/call` of a tool the server has, a call and that tool's own count. Anything else, or a body
 * that is not JSON-RPC, adds nothing; a tool name is counted only if it is one of `tools`.
 */
export function mcpReachOf(body: string, tools: readonly string[]): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of Array.isArray(parsed) ? parsed.slice(0, 50) : [parsed]) {
    if (!m || typeof m !== "object") continue;
    const { method, params } = m as { method?: unknown; params?: { name?: unknown } };
    if (method === "initialize") out.push("mcp:init");
    else if (method === "tools/call") {
      const name = params?.name;
      if (typeof name === "string" && tools.includes(name))
        out.push("mcp:call", `mcp:tool:${name}`);
    }
  }
  return out;
}

/** One day's counters as the store keeps them. */
export type ReachDay = Record<string, number>;

/** Sums days of counters into one, keeping only finite positive numbers. */
export function sumReach(days: ReachDay[]): ReachDay {
  const out: ReachDay = {};
  for (const d of days)
    for (const [k, v] of Object.entries(d)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = (out[k] ?? 0) + n;
    }
  return out;
}

/** Every UTC day from `from` to `to` inclusive, as YYYY-MM-DD, at most `max` of them. */
export function reachDays(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length < max; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
