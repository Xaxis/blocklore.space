# Progress and reach

Each month of Blocklore's work, counted from its own public record, and how much programs and
assistants used it. It is the monthly proof of work a funder such as OpenSats asks for: every
number links to what it counts.

<!-- covers: page:/progress, page:/progress/[month] -->

## Sub-features

- index (`web/app/progress/page.tsx`): every month with any work, newest first, with badges for new claims, corrections, runs, editions and lab runs.
- month (`web/app/progress/[month]/page.tsx`, from `core/src/progress.ts`): new claims by topic, corrections, other revisions and withdrawals; the month's digests; every research and check run with what it published, held, rejected and read, linked to `/log/<run>`; the evaluator's decisions and test claims caught; editions sealed with the first block holding each proof and whether it is signed; Bitcoin Core lab runs; BIP index changes; a "Check it yourself" block with the `git log` and `pnpm verify:snapshot` commands.
- reach (`core/src/reach.ts`, `web/lib/reach.ts`, `web/proxy.ts`, the MCP route): one Redis hash `reach:<YYYY-MM-DD>` per UTC day, kept 400 days, numbers only. The proxy counts `/api/v1` routes by family (never `/api/v1/brain` or the brain's queue routes), the export, `llms.txt`, the feeds and the proof files, before the cache, after the answer goes out. The MCP route counts `initialize` and each `tools/call` of a real tool, never the arguments. Requests with `Sec-Fetch-Site: same-origin` count under `site:` only. Counting began on 2026-11-23 (`REACH_SINCE`).
- refresh: month pages are ISR with `revalidate = 3600`; the record comes from the bundle, the counts from Redis.

## How to reach it

- Proof mode, the "Progress" tab; `/progress`; `/progress/2026-11`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/progress.test.ts, core/test/reach.test.ts).

Runtime, on `pnpm dev` (no Redis, so counts live in memory and start at zero on each restart):

```sh
B=http://localhost:3721
for i in 1 2 3; do curl -s -o /dev/null $B/api/v1/claims/taproot.activation-height; done
curl -s -o /dev/null $B/api/v1/brain                     # never counted
curl -s -o /dev/null $B/exports/claims.jsonl
curl -s -o /dev/null -X POST $B/api/v1/search -H 'Sec-Fetch-Site: same-origin' -H 'Content-Type: application/json' --data '{"q":"segwit"}'
H='-H Content-Type:application/json -H Accept:application/json,text/event-stream -H MCP-Protocol-Version:2025-06-18'
for t in search_claims get_claim nope; do curl -s -o /dev/null -X POST $B/mcp $H --data "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$t\",\"arguments\":{\"query\":\"taproot\",\"id\":\"taproot.activation-height\"}}}"; done
curl -s $B/progress/2026-11 | sed 's/<!-- -->//g' | grep -oE '(MCP tool calls|API requests|Downloads of the full export)[^<]*<strong>[0-9,]+|/api/v1/claims/\{id\}</span>:[^<]*|search_claims</span>:[^<]*|Readers searched [0-9]+ times?'
```

Run the last line before and after the requests. Proves it when, between the two: MCP tool calls rise by 2 (the fake tool `nope` is not counted), the claim route by 3, the export by 1, the site search only in "Readers searched N times" (by 1), and nothing counts the brain poll. Counts persist for the life of the dev server, so compare the two readings rather than expecting zero. The page also shows 230 or more new claims in November 2026, the evaluator's "7 of 7" test claims, Edition 1 sealed in block 976,778, and Bitcoin Core 32.1 with 47 of 47. Under "Security and the BIPs" it counts the security advisories the projects published in the month (by their own date, from `bundle.security.advisories`), how many are filed under a threat, and links the rest to `/gaps`; an advisory from an earlier year never makes a month of its own.

In production (`KV_REST_API_URL` set on Vercel), the same requests raise the counts on `/progress/<this month>` within the hour (ISR); never send test traffic there to inflate them.

## Gotchas

- Blocklore's own checks send `X-Blocklore-Check: 1` (`tools/deploy.sh` wraps curl; `mcpcheck.ts` sets it on its transport; the brain sends `SITE_HEADERS` from `brain/src/env.ts` on every call to its site, because the daemon and the tick read `/api/v1` for the live build), and neither the proxy nor the MCP route counts such a request. Proven 2026-11-23: a claim, the export, the feed, an MCP initialize and a tool call with the header left every count unchanged. The month page shows counts from `REACH_SINCE` (2026-11-24): on 2026-11-23 the deployed reach code met a daemon still on the old code, so that day's production counts hold the brain's polls and are left out. Proven for the brain 2026-11-23: a dev daemon on the new code polled `/api/v1` (the dev log shows the request through `proxy.ts`) and the month page's `/api/v1` count stayed at 9, while one curl without the header moved it to 10. A new check script against production must send it too.
- `next dev` reads no Redis here (`web/.env.development.local` has no KV variables), so local tests never touch production counts. Keep it that way.
- The proxy runs only for the matched paths in `web/proxy.ts`; widening the matcher makes every page a function invocation.
- Watch readings are not counted per month: the watches keep a capped history, so a monthly count would undercount.
