# Research queue

Questions Ask could not answer, queued by the readers who asked them, triaged and researched by the brain, and shown on `/queue` once triaged.

<!-- covers: page:/queue, api:GET /api/v1/queue, api:POST /api/v1/queue, api:OPTIONS /api/v1/queue, api:GET /api/v1/queue/pull, api:POST /api/v1/queue/status, cli:brain queue -->

## Sub-features

- core (`core/src/queue.ts`): `QueueItem` and `QueueUpdate` (zod), `QUEUE_STATUSES` (queued, researching, answered, declined) and their labels, `cleanQuestion` (strips links, bare domains, email addresses, Nostr keys, handles), `queueId` (one id per question whatever its case or punctuation), `queueOrder` (answered last, then most asked, then oldest), `QUEUE_VISITOR_DAY` (5).
- the ticket (`web/lib/ask.ts`, `web/lib/queue.ts`): Ask's schema has `about_bitcoin`; a `partial` or `not_covered` answer judged about Bitcoin carries `queue_ticket`, an HMAC keyed with `ASK_SALT` over the day, the question and the `missing` note. Valid that UTC day and the next.
- the store (`web/lib/queue.ts`): Redis keys `queue:item:<id>`, `queue:ids`, `queue:new` (what the next pull returns) and `queue:v:<visitor>:<day>`; `next dev` without KV keeps them on globalThis (`devMemory` in `web/lib/kv.ts`). `enqueue` checks the secret detector, the ticket, the cleaned length and the visitor limit, then adds or counts.
- routes: `GET /api/v1/queue` (triaged questions and `waiting`; cached a minute), `POST /api/v1/queue` (`{q, ticket, missing}`, body at most 2000), `GET /api/v1/queue/pull[?all=1]` and `POST /api/v1/queue/status` (bearer `QUEUE_PULL_TOKEN`, `sameSecret`; status checks the claims are published, an answer names claims, a note passes the style check and the detector).
- page (`/queue`): counts, triaged questions with status, times asked, first date, the note and the claims that answer it; "How a question gets here". The Ask answer's "Ask Blocklore to research this" button (`QueueButton` in `web/components/AskBox.tsx`) says queued, already queued, answered or declined.
- brain (`brain/src/queue.ts`, `pnpm brain queue`): `pull [--all]` merges into `var/queue/items.json`; `list`; `accept <id>` (researching); `research <id> <topic>` (accept, then a research run whose task wraps the question in an escaped `<question>` as data, `queueTask`); `answer <id> --claims a,b [--note]` (published ids only); `decline <id> [--note]`. `BLOCKLORE_SITE` points it at another site (default https://blocklore.vercel.app).

## How to reach it

- http://localhost:3721/queue; `GET|POST http://localhost:3721/api/v1/queue`; `BLOCKLORE_SITE=http://localhost:3721 pnpm brain queue ...`.
- The dev server needs `QUEUE_PULL_TOKEN` (and `ASK_SALT`, `ANTHROPIC_API_KEY`) from `.env` in its environment: `cd web && set -a && . <(grep -E '^(ANTHROPIC_API_KEY|ASK_SALT|QUEUE_PULL_TOKEN)=' ../.env) && set +a && exec npx next dev --port 3721` (run in the background). `tools/env.sh` makes the token once and sets it on production.
- Direct calls to the brain endpoints read the header from a mode-600 file so the token never reaches a command line: `(umask 077; grep -E '^QUEUE_PULL_TOKEN=' .env | sed 's/^QUEUE_PULL_TOKEN=/Authorization: Bearer /' > "$SCRATCH/auth.h")`, then `curl -H @"$SCRATCH/auth.h" ...`.

## How to check it

Static: `pnpm test` (core/test/queue.test.ts: contact stripping, one id per question, update validation and public order; brain/test/queue.test.ts: the question reaches research escaped, as data; core/test/ask.test.ts: `fitSentences` keeps whole sentences of a long `missing` note).

Free refusals:

```sh
Q=http://localhost:3721/api/v1/queue
curl -s $Q | jq -c '{waiting, n: (.questions|length)}'                       # 200
curl -s -X POST $Q -H 'Content-Type: application/json' --data '{"q":"What is Ark on Bitcoin?","ticket":"forged"}' -w ' [%{http_code}]\n'   # 403
curl -s $Q/pull -w ' [%{http_code}]\n'                                        # 401
curl -s $Q/pull -H 'Authorization: Bearer wrong' -w ' [%{http_code}]\n'       # 401
curl -s -X POST $Q/status --data '{}' -w ' [%{http_code}]\n'                  # 401
```

The whole loop (one Ask call, about 1 cent; asking the same question again is cached):

```sh
S=$SCRATCH
jq -n '{q:"How do statechains move bitcoin between owners without an onchain transaction?",depth:"user"}' > $S/ask.json
curl -s -X POST localhost:3721/api/v1/ask -H 'Content-Type: application/json' --data @$S/ask.json > $S/a.json
jq -c '{verdict: .answer.verdict, about: .answer.aboutBitcoin, ticket: (.queue_ticket != null), missing: .answer.missing}' $S/a.json
jq '{q: .question, ticket: .queue_ticket, missing: (.answer.missing // "")}' $S/a.json > $S/body.json
curl -s -X POST $Q -H 'Content-Type: application/json' --data @$S/body.json | jq -c '{queued, id: .item.id}'   # twice: queued true, then false with asks 2
jq '.missing = "something else"' $S/body.json | curl -s -X POST $Q -H 'Content-Type: application/json' --data @- -w ' [%{http_code}]\n'  # 403
export BLOCKLORE_SITE=http://localhost:3721
pnpm -s brain queue pull; pnpm -s brain queue pull          # "1 new question", then "0 new questions"
pnpm -s brain queue accept 83efe6a2dd729b73                 # Being researched; GET $Q lists it
pnpm -s brain queue answer 83efe6a2dd729b73 --claims lightning.not-a-claim   # refused: not published
pnpm -s brain queue answer 83efe6a2dd729b73 --claims lightning.what-it-is    # Answered; /queue links the claim
pnpm -s brain queue decline 83efe6a2dd729b73 --note "Statechains are on the agenda already."   # GET $Q no longer lists it
rm -f var/queue/items.json                                   # local test data
```

Proves it when: the verdict is `not_covered` with `aboutBitcoin` true, a ticket and a one-sentence `missing`; an off-topic question ("What is the best pizza topping in Naples?") gets `aboutBitcoin` false and no ticket; the swapped note is 403; the brain sees the question once; `/queue` shows nothing until it is accepted, then its status, and the claim after `answer`; a note with a dash built by `String.fromCharCode(8212)` is refused by the brain and, posted directly, 400 at the site.

Browser: on `/ask`, ask the question; the button "Ask Blocklore to research this" appears under the not-covered note; clicking it shows `.ask-queued` with "Queued for research." (or "Already queued; asked N times now.", or the declined or answered line). `/queue` at phone width in dark shows the counts line.

Production: the same refusals against https://blocklore.vercel.app; `pnpm brain queue pull --all` with no `BLOCKLORE_SITE` answers 200 (an empty list is fine). Do not queue test questions in production unless you decline them right after.

## Gotchas

- Without `QUEUE_PULL_TOKEN` in the dev server's environment, every brain call is 401 even with the right token on the brain side.
- Until KV is configured locally, the queue lives in the dev server's memory: it survives module reloads (globalThis) but not a restart.
- `GET /api/v1/queue` sends `public, max-age=60`, and Vercel's edge caches it (`x-vercel-cache: HIT`), so the API can show a change up to a minute late. The `/queue` page reads Redis on every request; check it there (strip `<!-- -->` before grepping its counts).
- The ticket signs `missing` exactly as Ask returned it, so a client must send `answer.missing` unchanged (or "" when there is none).
