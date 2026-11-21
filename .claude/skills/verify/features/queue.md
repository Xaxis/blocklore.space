# Reader suggestions

Readers suggest questions for the brain to research, in the box on `/gaps` or by `POST /api/v1/queue`; no model reads them on the site, and a suggestion is public only once the brain or the owner triages it.

<!-- covers: api:GET /api/v1/queue, api:POST /api/v1/queue, api:OPTIONS /api/v1/queue, api:GET /api/v1/queue/pull, api:POST /api/v1/queue/status, cli:brain queue -->

## Sub-features

- core (`core/src/queue.ts`): `QueueItem` and `QueueUpdate` (zod), `QUEUE_STATUSES` (queued, researching, answered, declined) and their labels, `cleanQuestion` (strips links, bare domains, email addresses, Nostr keys, handles), `queueId` (one id per question whatever its case or punctuation), `queueOrder` (answered last, then most asked, then oldest), `QUEUE_VISITOR_DAY` (5). `readQuestion` (`core/src/ask.ts`) trims, runs `detectSecrets` first and caps the text at 300 characters.
- the store (`web/lib/queue.ts`): Redis keys `queue:item:<id>`, `queue:ids`, `queue:new` (what the next pull returns) and `queue:v:<visitor>:<day>` (the site's own counter is visitor `site`); `next dev` without KV keeps them on globalThis (`devMemory` in `web/lib/kv.ts`). `enqueue` runs `readQuestion`, cleans, refuses under 8 characters, counts the site (200 a UTC day) then the visitor (5 a day, under `visitorHash` keyed with `ASK_SALT`), then adds or counts a repeat. The item's `missing` is null.
- routes: `GET /api/v1/queue` (`{edition, waiting, questions}`: triaged only; `public, max-age=60`), `POST /api/v1/queue` (`{"q"}` only, a strict object, body at most 2000; `{queued, item}`), `OPTIONS` (CORS), `GET /api/v1/queue/pull[?all=1]` and `POST /api/v1/queue/status` (bearer `QUEUE_PULL_TOKEN`, `sameSecret`; status checks the claims are published, an answer names claims, a note passes the style check and the detector).
- the box (`web/components/Suggest.tsx`, the "Suggest a question" block on `/gaps`): POSTs `{q}`, says "Queued. It shows below once the brain has triaged it." or "Someone suggested this already; it now counts twice.", shows the site's error otherwise, and lists triaged suggestions with their status, note and answering claims, with "(N waiting for triage)". It reads `#suggest=<text>` from the fragment (search hands a miss over this way, `web/components/Search.tsx`), fills and focuses the box, and clears the fragment. `/connect` links to `/gaps#suggest`.
- admin: the owner triages in "Reader suggestions" (`/admin/questions`, admin.md).
- brain (`brain/src/queue.ts`, `pnpm brain queue`): `pull [--all]` merges into `var/queue/items.json`; `list`; `accept <id>` (researching); `research <id> <topic>` (accept, then a research run whose task wraps the question in an escaped `<question>` as data, `queueTask`); `answer <id> --claims a,b [--note]` (published ids only); `decline <id> [--note]`. The hourly tick runs `pull` (loop.md). `BLOCKLORE_SITE` points it at another site (default https://blocklore.vercel.app).

## How to reach it

- http://localhost:3721/gaps (the box); `GET|POST http://localhost:3721/api/v1/queue`; `BLOCKLORE_SITE=http://localhost:3721 pnpm brain queue ...`.
- The brain endpoints need `QUEUE_PULL_TOKEN` in the dev server's environment: `cd web && set -a && . <(grep -E '^(ASK_SALT|QUEUE_PULL_TOKEN)=' ../.env) && set +a && exec npx next dev --port 3721` (run in the background). Without `ASK_SALT`, dev uses a fixed salt; without the token, pull and status are 401. `tools/env.sh` makes the token once and sets it on production.
- Direct calls to the brain endpoints read the header from a mode-600 file so the token never reaches a command line: `(umask 077; grep -E '^QUEUE_PULL_TOKEN=' .env | sed 's/^QUEUE_PULL_TOKEN=/Authorization: Bearer /' > "$SCRATCH/auth.h")`, then `curl -H @"$SCRATCH/auth.h" ...`.

## How to check it

Static: `pnpm test` (core/test/queue.test.ts: contact stripping, one id per question, update validation and public order; brain/test/queue.test.ts: the question reaches research escaped, as data).

Free, against a dev server without KV (each run uses its own `X-Forwarded-For`, so it neither spends nor meets another visitor's five):

```sh
Q=http://localhost:3721/api/v1/queue
V="X-Forwarded-For: 10.9.$((RANDOM % 250)).$((RANDOM % 250))"
post() { curl -s -X POST $Q -H 'Content-Type: application/json' -H "$V" --data "$1" -w ' [%{http_code}]\n' | grep -o '"queued": [a-z]*\|"q": "[^"]*"\|"asks": [0-9]*\|"error": .*\|\[[0-9]*\]$' | tr '\n' ' '; echo; }
curl -s $Q | jq -c '{waiting, n: (.questions|length)}'                                  # 200
post '{"q":"How do statechains move bitcoin between owners? https://example.com"}'     # queued true, the link gone
post '{"q":"how do statechains move bitcoin between owners"}'                          # queued false, asks 2
post '{"q":"What is Ark on Bitcoin?","ticket":"x"}'                                    # 400, the usage line
post '{"q":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}'   # 400, no "abandon" in the error
post '{"q":"hi @someone"}'                                                             # 400, too short once the handle is gone
for n in third fourth fifth; do post "{\"q\":\"A $n distinct test question?\"}"; done      # 200 each
post '{"q":"A sixth distinct test question?"}'                                         # 429: the visitor's sixth today
curl -s $Q | jq -c '{waiting}'                                                         # waiting grew; questions unchanged
curl -s -X OPTIONS -o /dev/null -w '%{http_code}\n' $Q                                 # 204
curl -s $Q/pull -w ' [%{http_code}]\n'                                                 # 401
curl -s -X POST $Q/status --data '{}' -w ' [%{http_code}]\n'                           # 401
```

Proves it when: the first suggestion is `queued: true` with the link gone from `q`; the second, in other case and without the "?", is `queued: false` with `asks: 2`; a `ticket` field is 400 with `Send JSON: {"q": ...}`; the seed is 400 and the error names a seed phrase without repeating the words; the handle-only text is 400; the sixth suggestion that got past those checks is 429 ("Each visitor can suggest 5 questions a day"); `waiting` grows while `questions` lists only triaged items; OPTIONS 204; pull and status 401 without the token. The repeat counted toward the five; the refusals did not.

The site's cap, only on a dev server you started yourself (it stops every suggestion on that server until it restarts): 201 POSTs, each with its own `X-Forwarded-For`; the 201st answers 429 "Blocklore has taken all the suggestions it can today."

Triage, with the token in the dev server's environment:

```sh
export BLOCKLORE_SITE=http://localhost:3721
pnpm -s brain queue pull; pnpm -s brain queue pull          # "N new questions", then "0 new questions"
ID=$(jq -r '.[] | select(.q | test("statechains")) | .id' var/queue/items.json)
pnpm -s brain queue accept $ID                              # Being researched; GET $Q lists it
pnpm -s brain queue answer $ID --claims lightning.not-a-claim   # refused: not published
pnpm -s brain queue answer $ID --claims lightning.what-it-is    # Answered; /gaps lists it with the claim
pnpm -s brain queue decline $ID --note "Statechains are on the agenda already."   # GET $Q no longer lists it
rm -f var/queue/items.json                                   # local test data
```

Proves it when: the brain sees each suggestion once; `GET $Q` lists it only after `accept`, then with its claim after `answer`, and not after `decline`; a note with a dash built by `String.fromCharCode(8212)` is refused by the brain and, posted directly to status, 400 at the site.

Browser (Playwright, SwiftShader): open `/gaps#suggest=What%20is%20a%20statechain%3F`; the box holds "What is a statechain?", has focus, and the address bar shows `/gaps` with no fragment. Submit; the `role="status"` callout says "Queued." (or "Someone suggested this already"). From any view, search for words no claim matches and press Enter: it lands on `/gaps` with the words in the box. Screenshot `/gaps` at phone width in dark.

Production: the refusals (ticket field, seed, `pull` 401) against https://blocklore.vercel.app; `pnpm brain queue pull --all` with no `BLOCKLORE_SITE` answers 200 (an empty list is fine). Do not suggest test questions in production unless you decline them right after.

## Gotchas

- Without `QUEUE_PULL_TOKEN` in the dev server's environment, every brain call is 401 even with the right token on the brain side.
- Until KV is configured locally, the queue lives in the dev server's memory: it survives module reloads (globalThis) but not a restart. A dev server another session started is shared: do not run the site-cap check on it.
- `GET /api/v1/queue` sends `public, max-age=60`, and Vercel's edge caches it (`x-vercel-cache: HIT`), so the API and the list under the box can show a change up to a minute late in production.
- A POST counts toward the caps only once it passes the content checks (string, no secret, 300 characters, 8 after cleaning). A repeat counts, and the site's count grows even when the visitor's cap then refuses it.
- The list under the box is fetched in the browser; `curl /gaps` shows the form but never the suggestions.
