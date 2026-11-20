import { z } from "zod";
import { detectSecrets, SECRET_LABEL } from "./secrets.ts";

// A read-only Model Context Protocol server over Streamable HTTP, as one pure function from an HTTP
// request to an HTTP answer. It speaks the stateless revision (2026-07-28: every request carries its
// version in _meta and mirrors it in headers) and the initialize-based revisions most clients still
// use, without sessions or streams: every answer is one JSON object. Tools are passed in, so the
// protocol is tested here and the store stays in the site.

/** Revisions that carry their version on every request (no initialize). */
export const MODERN_VERSIONS = ["2026-07-28"] as const;
/** Revisions that open with initialize. Served statelessly: no session id is minted. */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const MCP_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

/** The largest request body accepted, in characters. Every tool input is far smaller. */
export const MCP_MAX_BODY = 8192;

export type McpOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export interface McpTool<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  run(args: z.output<S>): McpOutcome;
}

/** Keeps a tool's argument type tied to its schema. */
export const defineTool = <S extends z.ZodType>(tool: McpTool<S>): McpTool => tool;

export interface McpServer {
  name: string;
  title: string;
  version: string;
  websiteUrl: string;
  instructions: string;
  tools: readonly McpTool[];
  /** How long a client may reuse the tool list, in milliseconds. */
  ttlMs: number;
}

export interface McpHttpRequest {
  method: string;
  /** Case-insensitive header lookup, as Headers.get. */
  header(name: string): string | null;
  body: string;
}

export interface McpHttpResponse {
  status: number;
  /** null sends no body (202 for a notification). */
  body: unknown;
  headers?: Record<string, string>;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER = "io.modelcontextprotocol/serverInfo";

type Id = string | number;

const Message = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const CallParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

function rpcError(id: Id | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    ...(id === null ? {} : { id }),
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

const fail = (status: number, id: Id | null, code: number, message: string, data?: unknown) => ({
  status,
  body: rpcError(id, code, message, data),
});

/** Decodes the =?base64?...?= form a client must use for header values that are not plain ASCII. */
export function decodeHeaderValue(value: string): string | null {
  const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!m) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(m[1] ?? ""), (ch) => ch.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

/**
 * The server is public, read-only and takes no credentials, so no page can borrow a reader's
 * standing through it. A browser's Origin is still checked to be a real web origin, as the spec
 * requires: "null" and malformed values are refused.
 */
function originAllowed(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === origin;
  } catch {
    return false;
  }
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

function toolList(server: McpServer) {
  return server.tools.map((t) => {
    const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(t.input, { io: "input" });
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      annotations: {
        title: t.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
  });
}

function callTool(server: McpServer, params: Record<string, unknown> | undefined, id: Id) {
  const call = CallParams.safeParse(params);
  if (!call.success)
    return { error: rpcError(id, INVALID_PARAMS, "tools/call needs a tool name.") };
  const tool = server.tools.find((t) => t.name === call.data.name);
  if (!tool) return { error: rpcError(id, INVALID_PARAMS, `Unknown tool: ${call.data.name}`) };
  const args = call.data.arguments ?? {};

  // Reader text is checked before anything else reads it, and a refusal never repeats it.
  const found = new Set(strings(args).flatMap((s) => detectSecrets(s).map((f) => f.kind)));
  if (found.size) {
    const what = [...found].map((k) => SECRET_LABEL[k]).join(" and ");
    return {
      result: toolError(
        `That looks like ${what}. Blocklore never accepts seeds, keys or addresses, and it did not keep this request. If it is real, treat it as exposed.`,
      ),
    };
  }

  const input = tool.input.safeParse(args);
  if (!input.success)
    return {
      result: toolError(
        `Invalid arguments for ${tool.name}: ${input.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("; ")}`,
      ),
    };
  const outcome = tool.run(input.data);
  if (!outcome.ok) return { result: toolError(outcome.error) };
  return {
    result: {
      content: [{ type: "text", text: JSON.stringify(outcome.data, null, 1) }],
      structuredContent: outcome.data,
      isError: false,
    },
  };
}

const toolError = (text: string) => ({ content: [{ type: "text", text }], isError: true });

function serverInfo(server: McpServer) {
  return {
    name: server.name,
    title: server.title,
    version: server.version,
    websiteUrl: server.websiteUrl,
  };
}

function discover(server: McpServer) {
  return {
    supportedVersions: MCP_VERSIONS,
    capabilities: { tools: { listChanged: false } },
    instructions: server.instructions,
    ttlMs: server.ttlMs,
    cacheScope: "public",
  };
}

const ok = (id: Id, result: unknown) => ({ status: 200, body: { jsonrpc: "2.0", id, result } });

/** One HTTP request to the MCP endpoint, answered. */
export function handleMcp(req: McpHttpRequest, server: McpServer): McpHttpResponse {
  if (req.method !== "POST")
    return {
      status: 405,
      headers: { Allow: "POST, OPTIONS" },
      body: rpcError(
        null,
        INVALID_REQUEST,
        "Send JSON-RPC in a POST body. This server keeps no sessions and opens no streams.",
      ),
    };

  const origin = req.header("origin");
  if (origin !== null && !originAllowed(origin))
    return fail(403, null, INVALID_REQUEST, "The Origin header is not a web origin.");

  const accept = req.header("accept");
  if (accept && !/application\/json|application\/\*|\*\/\*/i.test(accept))
    return fail(406, null, INVALID_REQUEST, "Accept application/json: every answer is one object.");

  const type = req.header("content-type");
  if (type && !/^application\/json\b/i.test(type))
    return fail(415, null, INVALID_REQUEST, "Send the body as application/json.");

  if (req.body.length > MCP_MAX_BODY)
    return fail(413, null, INVALID_REQUEST, `Bodies are limited to ${MCP_MAX_BODY} characters.`);

  let raw: unknown;
  try {
    raw = JSON.parse(req.body);
  } catch {
    return fail(400, null, PARSE_ERROR, "The body is not JSON.");
  }
  if (Array.isArray(raw))
    return fail(
      400,
      null,
      INVALID_REQUEST,
      "Send one JSON-RPC message per POST; batches are not taken.",
    );
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return fail(400, null, INVALID_REQUEST, "Not a JSON-RPC 2.0 message.");
  const msg = parsed.data;
  if (msg.method === undefined)
    return fail(
      400,
      null,
      INVALID_REQUEST,
      "Clients send requests and notifications, not responses.",
    );
  if (msg.id === undefined) return { status: 202, body: null };
  if (msg.id === null) return fail(400, null, INVALID_REQUEST, "A request id may not be null.");

  const id = msg.id;
  const method = msg.method;
  const meta = msg.params?._meta;
  const metaRecord = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  const headerVersion = req.header("mcp-protocol-version");
  const modern =
    method !== "initialize" &&
    (META_VERSION in metaRecord ||
      (headerVersion !== null && (MODERN_VERSIONS as readonly string[]).includes(headerVersion)));

  if (modern) return modernRequest(req, server, id, method, msg.params, metaRecord, headerVersion);
  return legacyRequest(server, id, method, msg.params, headerVersion);
}

function modernRequest(
  req: McpHttpRequest,
  server: McpServer,
  id: Id,
  method: string,
  params: Record<string, unknown> | undefined,
  meta: Record<string, unknown>,
  headerVersion: string | null,
): McpHttpResponse {
  const version = meta[META_VERSION];
  const capabilities = meta[META_CAPABILITIES];
  if (typeof version !== "string" || !capabilities || typeof capabilities !== "object")
    return fail(
      400,
      id,
      INVALID_PARAMS,
      `Every request carries ${META_VERSION} and ${META_CAPABILITIES} in params._meta.`,
    );
  if (headerVersion === null)
    return fail(400, id, HEADER_MISMATCH, "The MCP-Protocol-Version header is missing.");
  if (headerVersion !== version)
    return fail(
      400,
      id,
      HEADER_MISMATCH,
      `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match _meta '${version}'.`,
    );
  if (!MCP_VERSIONS.includes(version))
    return fail(400, id, UNSUPPORTED_VERSION, "Unsupported protocol version", {
      supported: MCP_VERSIONS,
      requested: version,
    });

  const methodHeader = req.header("mcp-method");
  if (methodHeader !== method)
    return fail(
      400,
      id,
      HEADER_MISMATCH,
      methodHeader === null
        ? "The Mcp-Method header is missing."
        : `Header mismatch: Mcp-Method '${methodHeader}' does not match body method '${method}'.`,
    );
  if (method === "tools/call") {
    const nameHeader = req.header("mcp-name");
    const name = params?.name;
    const decoded = nameHeader === null ? null : decodeHeaderValue(nameHeader);
    if (decoded === null || decoded !== name)
      return fail(
        400,
        id,
        HEADER_MISMATCH,
        nameHeader === null
          ? "The Mcp-Name header is missing."
          : "Header mismatch: Mcp-Name does not match params.name.",
      );
  }

  // A request shaped the new way but naming an initialize-era version is served by those rules.
  if (!(MODERN_VERSIONS as readonly string[]).includes(version))
    return legacyRequest(server, id, method, params, version);

  const done = (result: Record<string, unknown>) =>
    ok(id, {
      resultType: "complete",
      ...result,
      _meta: { ...((result._meta as object) ?? {}), [META_SERVER]: serverInfo(server) },
    });
  switch (method) {
    case "server/discover":
      return done(discover(server));
    case "tools/list":
      if (params?.cursor !== undefined) return fail(400, id, INVALID_PARAMS, "Invalid cursor.");
      return done({ tools: toolList(server), ttlMs: server.ttlMs, cacheScope: "public" });
    case "tools/call": {
      const r = callTool(server, params, id);
      return "error" in r ? { status: 400, body: r.error } : done(r.result);
    }
    default:
      return fail(404, id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

function legacyRequest(
  server: McpServer,
  id: Id,
  method: string,
  params: Record<string, unknown> | undefined,
  headerVersion: string | null,
): McpHttpResponse {
  // Before 2025-06-18 there was no version header; a request without one is read as 2025-03-26.
  if (
    method !== "initialize" &&
    headerVersion !== null &&
    !(LEGACY_VERSIONS as readonly string[]).includes(headerVersion)
  )
    return fail(400, id, UNSUPPORTED_VERSION, "Unsupported protocol version", {
      supported: MCP_VERSIONS,
      requested: headerVersion,
    });

  // JSON-RPC errors travel in a 200 here: clients of these revisions read the body only on success.
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      const protocolVersion =
        typeof asked === "string" && (LEGACY_VERSIONS as readonly string[]).includes(asked)
          ? asked
          : LEGACY_VERSIONS[0];
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: serverInfo(server),
        instructions: server.instructions,
      });
    }
    case "ping":
      return ok(id, {});
    case "server/discover":
      return ok(id, { ...discover(server), _meta: { [META_SERVER]: serverInfo(server) } });
    case "tools/list":
      if (params?.cursor !== undefined)
        return { status: 200, body: rpcError(id, INVALID_PARAMS, "Invalid cursor.") };
      return ok(id, { tools: toolList(server) });
    case "tools/call": {
      const r = callTool(server, params, id);
      return "error" in r ? { status: 200, body: r.error } : ok(id, r.result);
    }
    default:
      return { status: 200, body: rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`) };
  }
}
