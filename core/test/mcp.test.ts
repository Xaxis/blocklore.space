import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineTool, handleMcp, MCP_VERSIONS, type McpServer } from "../src/mcp.ts";

const server: McpServer = {
  name: "test",
  title: "Test",
  version: "abc1234",
  websiteUrl: "https://example.org",
  instructions: "Read-only.",
  ttlMs: 300000,
  tools: [
    defineTool({
      name: "echo_length",
      title: "Length",
      description: "Counts the characters of a word.",
      input: z.strictObject({ word: z.string().min(1).max(20) }),
      run: ({ word }) =>
        word === "missing"
          ? { ok: false, error: "No such word." }
          : { ok: true, data: { length: word.length } },
    }),
  ],
};

const SEED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

type Rpc = {
  jsonrpc: string;
  id?: string | number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: { supported: string[]; requested: string } };
};

function post(body: unknown, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = handleMcp(
    {
      method: "POST",
      header: (n) => lower[n.toLowerCase()] ?? null,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    server,
  );
  return { status: res.status, body: res.body as Rpc | null, headers: res.headers };
}

const meta = (version = "2026-07-28") => ({
  "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientCapabilities": {},
});

function modern(method: string, params: Record<string, unknown> = {}, extra = {}) {
  const headers: Record<string, string> = {
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
    ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
    ...extra,
  };
  return post({ jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: meta() } }, headers);
}

test("initialize-era clients get their version back, or the newest such revision", () => {
  const r = post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c" } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body?.result?.protocolVersion, "2025-06-18");
  assert.deepEqual(r.body?.result?.capabilities, { tools: { listChanged: false } });
  assert.equal(r.headers?.["Mcp-Session-Id"], undefined);

  const old = post({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "2024-01-01" },
  });
  assert.equal(old.body?.result?.protocolVersion, "2025-11-25");
});

test("notifications are accepted with 202 and no body", () => {
  const r = post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.deepEqual([r.status, r.body], [202, null]);
});

test("the tool list gives plain JSON Schema and read-only hints", () => {
  const r = post(
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { "MCP-Protocol-Version": "2025-11-25" },
  );
  const tools = r.body?.result?.tools as Array<Record<string, unknown>>;
  assert.equal(tools.length, 1);
  assert.equal(r.body?.result?.resultType, undefined);
  const tool = tools[0] as {
    inputSchema: Record<string, unknown>;
    annotations: Record<string, unknown>;
  };
  assert.equal(tool.inputSchema.$schema, undefined);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.required, ["word"]);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
});

test("a call returns structured content and the same data as text", () => {
  const r = post({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "echo_length", arguments: { word: "taproot" } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body?.result?.structuredContent, { length: 7 });
  const content = r.body?.result?.content as Array<{ text: string }>;
  assert.deepEqual(JSON.parse(content[0]?.text ?? ""), { length: 7 });
  assert.equal(r.body?.result?.isError, false);
});

test("a seed phrase in any argument is refused without being repeated", () => {
  const r = post({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "echo_length", arguments: { word: SEED } },
  });
  assert.equal(r.body?.result?.isError, true);
  const text = ((r.body?.result?.content ?? []) as Array<{ text: string }>)[0]?.text ?? "";
  assert.match(text, /seed phrase/);
  assert.doesNotMatch(text, /abandon/);
});

test("bad arguments and failed lookups are tool errors; an unknown tool is a protocol error", () => {
  const bad = post({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "echo_length", arguments: { word: 3 } },
  });
  assert.equal(bad.body?.result?.isError, true);
  const missing = post({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "echo_length", arguments: { word: "missing" } },
  });
  assert.equal(
    ((missing.body?.result?.content ?? []) as Array<{ text: string }>)[0]?.text,
    "No such word.",
  );
  const unknown = post({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } });
  assert.equal(unknown.body?.error?.code, -32602);
});

test("stateless requests carry resultType and the server's identity", () => {
  const r = modern("tools/call", { name: "echo_length", arguments: { word: "segwit" } });
  assert.equal(r.status, 200);
  assert.equal(r.body?.result?.resultType, "complete");
  assert.deepEqual(r.body?.result?.structuredContent, { length: 6 });
  const info = ((r.body?.result?._meta ?? {}) as Record<string, { version: string }>)[
    "io.modelcontextprotocol/serverInfo"
  ];
  assert.equal(info?.version, "abc1234");

  const list = modern("tools/list");
  assert.equal(list.body?.result?.ttlMs, 300000);
  assert.equal(list.body?.result?.cacheScope, "public");

  const d = modern("server/discover");
  assert.deepEqual(d.body?.result?.supportedVersions, MCP_VERSIONS);
});

test("headers that disagree with the body are refused with HeaderMismatch", () => {
  const wrongName = modern(
    "tools/call",
    { name: "echo_length", arguments: { word: "a" } },
    { "Mcp-Name": "other" },
  );
  assert.deepEqual([wrongName.status, wrongName.body?.error?.code], [400, -32020]);
  const wrongMethod = modern("tools/list", {}, { "Mcp-Method": "tools/call" });
  assert.deepEqual([wrongMethod.status, wrongMethod.body?.error?.code], [400, -32020]);
  const noHeader = post(
    { jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: meta() } },
    { "Mcp-Method": "tools/list" },
  );
  assert.deepEqual([noHeader.status, noHeader.body?.error?.code], [400, -32020]);
});

test("a base64 Mcp-Name is decoded before it is compared", () => {
  const encoded = `=?base64?${Buffer.from("echo_length").toString("base64")}?=`;
  const r = modern(
    "tools/call",
    { name: "echo_length", arguments: { word: "abc" } },
    { "Mcp-Name": encoded },
  );
  assert.equal(r.status, 200);
});

test("an unknown version names the supported ones; missing _meta fields are invalid params", () => {
  const r = post(
    { jsonrpc: "2.0", id: 9, method: "tools/list", params: { _meta: meta("1900-01-01") } },
    { "MCP-Protocol-Version": "1900-01-01", "Mcp-Method": "tools/list" },
  );
  assert.deepEqual([r.status, r.body?.error?.code], [400, -32022]);
  assert.deepEqual(r.body?.error?.data, { supported: MCP_VERSIONS, requested: "1900-01-01" });

  const noCaps = post(
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
    },
    { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" },
  );
  assert.deepEqual([noCaps.status, noCaps.body?.error?.code], [400, -32602]);

  const legacyHeader = post(
    { jsonrpc: "2.0", id: 9, method: "tools/list" },
    { "MCP-Protocol-Version": "2099-01-01" },
  );
  assert.deepEqual([legacyHeader.status, legacyHeader.body?.error?.code], [400, -32022]);
});

test("unknown methods are 404 for stateless clients and in-body errors for initialize-era ones", () => {
  const m = modern("resources/list");
  assert.deepEqual([m.status, m.body?.error?.code], [404, -32601]);
  const l = post({ jsonrpc: "2.0", id: 10, method: "resources/list" });
  assert.deepEqual([l.status, l.body?.error?.code], [200, -32601]);
});

test("transport rules: POST only, one message, real origins, JSON in and out", () => {
  const get = handleMcp({ method: "GET", header: () => null, body: "" }, server);
  assert.equal(get.status, 405);
  assert.equal(get.headers?.Allow, "POST, OPTIONS");
  assert.equal(post([{ jsonrpc: "2.0", id: 1, method: "ping" }]).status, 400);
  assert.equal(post("{not json").body?.error?.code, -32700);
  assert.equal(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "null" }).status, 403);
  assert.equal(
    post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "https://claude.ai" }).status,
    200,
  );
  assert.equal(
    post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Accept: "text/html" }).status,
    406,
  );
  assert.equal(
    post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Accept: "application/json, text/event-stream" },
    ).status,
    200,
  );
  assert.equal(post({ jsonrpc: "2.0", id: 1, result: {} }).status, 400);
  assert.equal(post("x".repeat(9000)).status, 413);
});
