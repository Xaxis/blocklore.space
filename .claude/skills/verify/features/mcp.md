# MCP server

An assistant connects to `/mcp` and searches, reads and cites the published store as seven read-only tools.

<!-- covers: api:POST /mcp, api:GET /mcp, api:DELETE /mcp, api:OPTIONS /mcp -->

## Sub-features

- protocol: `core/src/mcp.ts`, one pure function from request to answer. It serves 2026-07-28 (stateless: `_meta` version and capabilities, mirrored `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, `server/discover`, `resultType`, `ttlMs` and `cacheScope` on the list) and the initialize-era revisions 2025-11-25, 2025-06-18 and 2025-03-26 (`initialize`, `ping`, no session id minted).
- tools: `web/lib/mcp.ts`, in this order: `search_claims`, `get_claim`, `list_topics`, `get_topic`, `list_changes`, `get_bip`, `list_bips`. All read through `web/lib/api.ts`, carry `edition`, and are annotated read-only.
- secrets: every string argument runs `detectSecrets` before any tool reads it; a refusal is a tool error that never repeats the text.
- transport: `web/app/mcp/route.ts`. POST only (GET and DELETE are 405 with `Allow`), one message per POST (batches 400), notifications 202 with no body, `Origin` must be a real web origin (403), 8192 characters at most (413), CORS `*` with the MCP headers allowed, `Cache-Control: no-store`.
- docs: the MCP section of `API.md` (`/about/api`); `/llms.txt` and `GET /api/v1` link `/mcp`.

## How to reach it

- `claude mcp add --transport http blocklore http://localhost:3721/mcp` in a scratch project, or the driver below; production is `https://blocklore.space/mcp` (also `https://blocklore.vercel.app/mcp`).

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/mcp.test.ts: negotiation, header mismatch, unknown versions, secrets, transport rules).

Runtime, with the official SDK client and raw 2026-07-28 requests:

```sh
node .claude/skills/verify/mcpcheck.ts http://localhost:3721
```

Proves it when: it prints `mcpcheck passed` after 18 `ok` lines: the SDK client connects and reads the instructions, lists the seven tools in order, all read-only; each tool answers from the live store (search hits, a claim with sources, an unknown id as a tool error, topics, a topic's sections, five changes, BIP 341 cited by claims, Deployed BIPs); a seed phrase is refused and not repeated; `server/discover` lists 2026-07-28; a stateless call completes with no `Mcp-Session-Id`; a mismatched `Mcp-Name` is 400 with -32020; GET is 405.

By hand:

```sh
B=http://localhost:3721/mcp
curl -s -o /dev/null -w '%{http_code}\n' $B
curl -s -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' $B | head -c 200
curl -s -X OPTIONS -o /dev/null -w '%{http_code}\n' $B
```

Proves it when: 405; a result naming `"protocolVersion":"2025-11-25"` and `"name":"blocklore"`; 204.

Then `grep -c abandon var/dev.log` must not grow after the driver runs: the seed travels only in the POST body, which is never logged.

## Gotchas

- Clients of the initialize-era revisions read JSON-RPC errors only from 2xx answers, so in that path an unknown method or tool is a 200 carrying the error. Stateless requests get the spec's statuses (404 for an unknown method, 400 for header and version errors).
- Search ranking is the same as the API's; "taproot activation height" ranks `taproot.warning-height` first. The golden set (BACKLOG 17) is where retrieval gets measured, not this recipe.
- The SDK is a root dev dependency only for this driver; the server itself has no MCP dependency.
