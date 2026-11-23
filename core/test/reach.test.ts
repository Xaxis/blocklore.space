import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpReachOf, reachDays, reachOf, sumReach } from "../src/reach.ts";

const TOOLS = ["search_claims", "get_claim"];

test("the public API counts by route family, one claim or topic apart from the lists", () => {
  assert.deepEqual(reachOf("/api/v1", "GET", false), ["api", "api:index"]);
  assert.deepEqual(reachOf("/api/v1/claims", "GET", false), ["api", "api:claims"]);
  assert.deepEqual(reachOf("/api/v1/claims/taproot.activation-height", "GET", false), [
    "api",
    "api:claim",
  ]);
  assert.deepEqual(reachOf("/api/v1/topics/segwit/", "GET", false), ["api", "api:topic"]);
  assert.deepEqual(reachOf("/api/v1/search", "POST", false), ["api", "api:search"]);
  assert.deepEqual(reachOf("/api/v1/queue", "POST", false), ["api", "api:queue"]);
});

test("the brain's own routes and unknown paths are never counted", () => {
  assert.deepEqual(reachOf("/api/v1/reports", "GET", false), ["api", "api:reports"]);
  for (const p of [
    "/api/v1/brain",
    "/api/v1/queue/pull",
    "/api/v1/queue/status",
    "/api/v1/reports/pull",
    "/api/v1/reports/status",
    "/api/v1/nope",
  ])
    assert.deepEqual(reachOf(p, "GET", false), [], p);
  assert.deepEqual(reachOf("/api/v1/bips/341", "GET", false), []);
  assert.deepEqual(reachOf("/api/v1/claims/a/b", "GET", false), []);
  assert.deepEqual(reachOf("/topics/segwit", "GET", false), []);
  assert.deepEqual(reachOf("/api/v1/claims", "OPTIONS", false), []);
  assert.deepEqual(reachOf("/api/v1/claims", "HEAD", false), []);
});

test("the site's own requests count apart, so the totals are other people's use", () => {
  assert.deepEqual(reachOf("/api/v1/search", "POST", true), ["site:api", "site:api:search"]);
  assert.ok(!reachOf("/api/v1/search", "POST", true).includes("api"));
});

test("exports, llms.txt, feeds and proof files count; a POST to them does not", () => {
  assert.deepEqual(reachOf("/exports/claims.jsonl", "GET", false), ["export"]);
  assert.deepEqual(reachOf("/llms-full.txt", "GET", false), ["llms", "llms:llms-full.txt"]);
  assert.deepEqual(reachOf("/changes.xml", "GET", false), ["feed", "feed:changes.xml"]);
  assert.deepEqual(reachOf("/topics/taproot/changes.xml", "GET", false), ["feed", "feed:topic"]);
  // A topic's page is a reader's, not a feed's.
  assert.deepEqual(reachOf("/topics/taproot", "GET", false), []);
  assert.deepEqual(reachOf("/snapshots/1.json.ots", "GET", false), ["proof"]);
  assert.deepEqual(reachOf("/snapshots/1.json", "GET", false), ["proof"]);
  assert.deepEqual(reachOf("/orangecheck/revocations.json", "GET", false), ["proof"]);
  assert.deepEqual(reachOf("/snapshots/x.json", "GET", false), []);
  assert.deepEqual(reachOf("/rss.xml", "POST", false), []);
});

test("MCP counts connections and calls of real tools, never arguments", () => {
  const call = (name: string, args: unknown = {}) =>
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
  assert.deepEqual(
    mcpReachOf(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), TOOLS),
    ["mcp:init"],
  );
  const got = mcpReachOf(call("search_claims", { query: "my seed is abandon abandon" }), TOOLS);
  assert.deepEqual(got, ["mcp:call", "mcp:tool:search_claims"]);
  assert.ok(!got.join(" ").includes("abandon"));
  assert.deepEqual(mcpReachOf(call("drop_tables"), TOOLS), []);
  assert.deepEqual(mcpReachOf(call("search_claims\nx"), TOOLS), []);
  assert.deepEqual(
    mcpReachOf(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), TOOLS),
    [],
  );
  assert.deepEqual(mcpReachOf("not json", TOOLS), []);
  assert.deepEqual(mcpReachOf("null", TOOLS), []);
});

test("an MCP batch counts each message, up to 50", () => {
  const one = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_claim" } };
  assert.deepEqual(mcpReachOf(JSON.stringify([one, one]), TOOLS), [
    "mcp:call",
    "mcp:tool:get_claim",
    "mcp:call",
    "mcp:tool:get_claim",
  ]);
  assert.equal(mcpReachOf(JSON.stringify(Array(80).fill(one)), TOOLS).length, 100);
});

test("sums keep finite positive counts and add across days", () => {
  assert.deepEqual(
    sumReach([
      { api: 2, "mcp:call": 1 },
      { api: 3, export: Number.NaN, feed: -4 },
      { "mcp:call": "5" as unknown as number },
    ]),
    { api: 5, "mcp:call": 6 },
  );
});

test("days run inclusive across a month end and stop at the cap", () => {
  assert.deepEqual(reachDays("2026-11-29", "2026-12-02"), [
    "2026-11-29",
    "2026-11-30",
    "2026-12-01",
    "2026-12-02",
  ]);
  assert.deepEqual(reachDays("2026-12-02", "2026-11-29"), []);
  assert.equal(reachDays("2020-01-01", "2026-01-01", 10).length, 10);
});
