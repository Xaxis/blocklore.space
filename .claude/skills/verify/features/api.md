# API and data

A program reads every published claim, topic, change and BIP without a key: JSON under `/api/v1`, a JSON Lines export, and llms.txt for language models.

<!-- covers: api:GET /api/v1, api:GET /api/v1/claims, api:GET /api/v1/claims/[id], api:GET /api/v1/topics, api:GET /api/v1/topics/[slug], api:GET /api/v1/changes, api:GET /api/v1/bips, api:GET /api/v1/search, api:POST /api/v1/search, api:OPTIONS /api/v1/search, api:GET /exports/claims.jsonl, api:GET /llms.txt, api:GET /llms-full.txt -->

## Sub-features

- index: `GET /api/v1` lists endpoints, the edition (store height and time, build) and the license note.
- claims: list in brief; one claim's whole record by id; unknown id is a JSON 404. `?at=<moment>` gives it as it stood then ([timemachine](timemachine.md)).
- topics: list with lede and pending counts; one topic with sections (claims in brief) and ladder; an unpublished or unknown slug is a JSON 404. `?at=<moment>` gives it as it stood then.
- changes: events newest first, `since` (a block height, digits only) and `limit` (1 to 500); bad params are 400.
- bips: the index at its commit with a link per BIP at that commit, `cited_by` claim ids, and the change history. One BIP (`/api/v1/bips/<n>`) and the version bits (`/api/v1/signaling`) are in [proposals](proposals.md).
- search: POST `{"q", "limit"}` only (2000 characters at most, strict fields); BM25 from `core/src/search.ts`; secrets refused with 400 and not echoed; GET is 405 with the reason; OPTIONS is the CORS preflight.
- export: `/exports/claims.jsonl`, one whole claim per line, id order, `application/jsonl`.
- llms: `/llms.txt` (llmstxt.org index of topics and machine access) and `/llms-full.txt` (every claim with sources and quotes, by topic and section).
- docs: `API.md` at `/about/api`, footer "API and data".
- All answers carry `Access-Control-Allow-Origin: *`; data lives in `web/lib/api.ts`, which the MCP server shares ([mcp](mcp.md)).

## How to reach it

- `curl` the paths below; footer "API and data"; `/about/api`; `/llms.txt` links the rest.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/search.test.ts).

Runtime:

```sh
B=http://localhost:3721; H='Content-Type: application/json'
for p in /api/v1 /api/v1/claims /api/v1/topics /api/v1/topics/taproot /api/v1/bips "/api/v1/changes?since=0&limit=3" /exports/claims.jsonl /llms.txt /llms-full.txt; do echo "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B$p") $p"; done
for p in /api/v1/claims/nope.nope /api/v1/topics/covenants "/api/v1/changes?since=abc"; do echo "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B$p") $p"; done
curl -s $B/api/v1/claims | python3 -I -c "import json,sys; print(len(json.load(sys.stdin)['claims']))"
curl -s $B/exports/claims.jsonl | wc -l
node -e 'console.log(Object.keys(require("./web/.generated/bundle.json").claims).length)'
curl -s -X POST -H "$H" --data-binary '{"q":"taproot key path","limit":3}' $B/api/v1/search | python3 -I -c "import json,sys; print([r['id'] for r in json.load(sys.stdin)['results']])"
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/v1/search?q=taproot"
curl -s -X POST -H "$H" --data-binary '{"q":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}' -w ' %{http_code}\n' $B/api/v1/search | tail -c 120
curl -sI $B/api/v1/claims | grep -i access-control-allow-origin
```

Proves it when: the first loop is all 200 with JSON, `application/jsonl` and `text/plain` types; the second loop is 404, 404 (covenants has no published claims while it waits for review) and 400, all JSON; the claims list, the export line count and the bundle's claim count are equal; search returns Taproot key path claims first; GET search is 405; the seed phrase is refused with 400 and the words do not appear in the answer; CORS is `*`.

## Gotchas

- `/api/v1/claims/[id]` and `/api/v1/topics/[slug]` answer per request (they read `?at=`), from the bundle in memory, with `s-maxage` so the CDN keeps them until the next deploy.
- Never test search with GET and real-looking secrets: the dev server logs the URL. That is the reason search is POST.
- The topics endpoint lists only published topics; held topics show up as `pending_review` once one of their claims publishes.
