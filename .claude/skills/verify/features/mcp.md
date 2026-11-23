# MCP server

An assistant connects to `/mcp` and searches, reads and cites the published store, checks who signed each edition, and reads the security map and watches, as ten read-only tools. It is how readers get answers in sentences: Blocklore runs no model for them, and `/connect` shows how to bring their own.

<!-- covers: api:POST /mcp, api:GET /mcp, api:DELETE /mcp, api:OPTIONS /mcp, page:/connect -->

## Sub-features

- protocol: `core/src/mcp.ts`, one pure function from request to answer. It serves 2026-07-28 (stateless: `_meta` version and capabilities, mirrored `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, `server/discover`, `resultType`, `ttlMs` and `cacheScope` on the list) and the initialize-era revisions 2025-11-25, 2025-06-18 and 2025-03-26 (`initialize`, `ping`, no session id minted).
- tools: `web/lib/mcp.ts`, in this order: `search_claims`, `get_claim`, `list_topics`, `get_topic`, `list_changes`, `get_bip` (one BIP exactly as `GET /api/v1/bips/<n>`, see [proposals](proposals.md)), `list_bips`, `get_signatures` ([orangecheck](orangecheck.md)), `threats`, `watches`. All carry `edition` and are annotated read-only; the claim tools read through `web/lib/api.ts`, `threats` and `watches` through `web/lib/security.ts` and the pure queries in `core/src/threatmap.ts` (see features/security.md).
- secrets: every string argument runs `detectSecrets` before any tool reads it; a refusal is a tool error that never repeats the text.
- transport: `web/app/mcp/route.ts`. POST only (GET and DELETE are 405 with `Allow`), one message per POST (batches 400), notifications 202 with no body, `Origin` must be a real web origin (403), 8192 characters at most (413), CORS `*` with the MCP headers allowed, `Cache-Control: no-store`.
- time machine: `get_claim` and `get_topic` take an optional `at` (a block height, as a string or a number, or a UTC date `YYYY-MM-DD`); a bad one is a tool error saying what a moment is. Driven by `.claude/skills/verify/timemachine.ts` ([timemachine](timemachine.md)).
- docs: the MCP section of `API.md` (`/about/api`); `/llms.txt` and `GET /api/v1` link `/mcp`.
- connect (`/connect`, `web/app/connect/page.tsx`, the Connect view's first tab in `web/lib/nav.ts`): setup for Claude Code (`claude mcp add --transport http blocklore <site>/mcp`, with a copy button), Claude desktop and web (Settings, Connectors, Add custom connector), Cursor (`.cursor/mcp.json`), VS Code (`.vscode/mcp.json`, `type: http`) and any other streamable HTTP client; the tool list read from `MCP_SERVER.tools` (so it cannot drift from the server); how to keep a model honest (cite claim ids, keep contested claims attributed); a link to suggest what is missing (`/gaps#suggest`); other ways in (API docs, llms.txt, the repository). In the sitemap; the home page and llms.txt link it.

## How to reach it

- `claude mcp add --transport http blocklore http://localhost:3721/mcp` in a scratch project, or the driver below; production is `https://blocklore.space/mcp` (also `https://blocklore.vercel.app/mcp`).
- http://localhost:3721/connect, or the "Connect your AI" button in the bar.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/mcp.test.ts: negotiation, header mismatch, unknown versions, secrets, transport rules; core/test/threatmap.test.ts: the threat and watch queries, also called through `handleMcp`).

Runtime, with the official SDK client and raw 2026-07-28 requests:

```sh
node .claude/skills/verify/mcpcheck.ts http://localhost:3721
```

Proves it when: it prints `mcpcheck passed` after 30 `ok` lines: the SDK client connects and reads the instructions, lists the ten tools in order, all read-only; each tool answers from the live store (search hits, a claim with sources, an unknown id as a tool error, topics, a topic's sections, five changes, BIP 341 cited by claims, Deployed BIPs, every edition's signature and an unknown snapshot as a tool error, the threat map, only open threats when asked, time-warp with its claims and mitigations, an unknown threat as a tool error, the advisories counted as filed plus to map, peer-dos with its advisories each carrying a rule and what matched and its CVE ids checked against NVD, the watches, the lab's run on each maintained release newest first, and transaction-origin's lab tests each on those same releases); a seed phrase is refused and not repeated; `server/discover` lists 2026-07-28; a stateless call completes with no `Mcp-Session-Id`; a mismatched `Mcp-Name` is 400 with -32020; GET is 405.

By hand:

```sh
B=http://localhost:3721/mcp
curl -s -o /dev/null -w '%{http_code}\n' $B
curl -s -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' $B | head -c 200
curl -s -X OPTIONS -o /dev/null -w '%{http_code}\n' $B
```

Proves it when: 405; a result naming `"protocolVersion":"2025-11-25"` and `"name":"blocklore"`; 204.

Then `grep -c abandon var/dev.log` must not grow after the driver runs: the seed travels only in the POST body, which is never logged.

The connect view:

```sh
curl -s localhost:3721/connect | sed 's/<!-- -->//g' | grep -o 'claude mcp add --transport http blocklore https://blocklore.space/mcp\|Add custom connector\|\.cursor/mcp\.json\|\.vscode/mcp\.json\|search_claims\|list_bips\|href="/gaps#suggest"' | sort -u
```

Proves it when: all seven strings print. The command names `SITE.url`, so it reads `https://blocklore.space/mcp` even on the dev server. Then take the command from the page, run it in a scratch project (`claude mcp add --transport http blocklore https://blocklore.space/mcp`, then `claude mcp list`), and see `blocklore` connected; remove it after (`claude mcp remove blocklore`). Screenshot `/connect` at phone width in dark: each command fits or scrolls inside its box, never the page.

## Gotchas

- Clients of the initialize-era revisions read JSON-RPC errors only from 2xx answers, so in that path an unknown method or tool is a 200 carrying the error. Stateless requests get the spec's statuses (404 for an unknown method, 400 for header and version errors).
- Search ranking is the same as the API's; "taproot activation height" ranks `taproot.warning-height` first. The golden set (BACKLOG 17) is where retrieval gets measured, not this recipe.
- The SDK is a root dev dependency only for this driver; the server itself has no MCP dependency.
