# Ask the Brain

Questions answered only from published claims: search reads the best 12, one model call writes up to 6 sentences, and code checks every citation and the house style before a reader sees it; otherwise the reader gets the claims and the reason.

<!-- covers: page:/ask, api:POST /api/v1/ask, api:GET /api/v1/ask, api:OPTIONS /api/v1/ask, cli:brain bench -->

## Sub-features

- core (`core/src/ask.ts`): `readQuestion` (trim, 300 characters, `detectSecrets` first), `scopeRefusal` (clear price and advice questions, no model call), `ASK_SYSTEM` and `askPrompt` (depth, claims as `<claim id kind status confidence attributed_to>`, the question escaped), `ANSWER_SCHEMA` (structured outputs), `checkAnswer` (JSON and schema, 1 to 6 sentences, each citing 1 to 4 offered claims and no others, `undash` and `unfill` ("just" dropped, "not just" to "not only"), `styleIssues`, no URLs, no secrets; partial and not covered must say what is missing; refusals (price, advice, custody, harm, personal) map to `REFUSAL_TEXT`), `costMicros`, `worstCaseMicros`.
- search (`core/src/search.ts`): claim id words as a field, `expandQuery` (a glossary of reader words: block reward to subsidy, difficulty adjustment to retarget, cheat to revocation, ...), and a definition boost for "what is X" questions.
- site (`web/lib/ask.ts`): scope refusal, retrieval, a day's answer cache keyed by a hash of edition, depth and question, per-visitor limits (6 an hour, 20 a day) under an HMAC of the address keyed with `ASK_SALT` and the UTC day, an atomic reservation of the worst case against `ASK_DAILY_BUDGET_USD` (default 2) then settlement to billed usage, one Messages call (`claude-opus-5-5`, effort low), `checkAnswer`. Redis is `blocklore-kv` in production (fails closed without it); `next dev` without KV keeps counters in memory. One log line per answer with mode, verdict, counts, micro-dollars and ms, never the question.
- route (`web/app/api/v1/ask/route.ts`): POST JSON `{q, depth}` (body at most 2000 characters); JSON answer, or NDJSON (`read`, then `result` or `error`) with `Accept: application/x-ndjson`; GET 405 with why; CORS; `no-store`.
- page (`/ask`, `web/components/AskBox.tsx`): question box (Enter asks), depth stops, example questions, streamed "Writing an answer from N claims", the answer with numbered citations linking to "The claims this answer rests on", "Also read", partial and not-covered notes, refusal and fallback notes, how it was made; "How an answer is made" and "Limits and privacy" below. In the nav as "Ask", in the sitemap, llms.txt and `GET /api/v1`.
- bench (`brain/src/bench.ts`, `brain/bench/golden.yaml`): retrieval hit@1, @5, @12, must@12 and MRR per kind (free); `--ask` runs every question through the same pipeline and scores answers per kind, charged to the brain's ledger. Reports in `var/bench/`.

## How to reach it

- http://localhost:3721/ask; `POST http://localhost:3721/api/v1/ask`; `pnpm brain bench [--ask]`.
- Written answers locally need the key in the dev server's environment, sourced from `.env` so it never appears on a command line: `cd web && set -a && . <(grep -E '^(ANTHROPIC_API_KEY|ASK_SALT)=' ../.env) && set +a && exec npx next dev --port 3721` (run in the background). Without it every question gets `claims_only` with reason `unavailable`.

## How to check it

Static: `pnpm test` (core/test/ask.test.ts: secrets refused without echo, scope refusals and their false positives, prompt escaping, the answer check's accept and reject cases, cost; core/test/search.test.ts: glossary and definition boost); `pnpm lint`.

Free runtime checks (no model call):

```sh
A=http://localhost:3721/api/v1/ask
post() { curl -s -X POST $A -H 'Content-Type: application/json' -w ' [%{http_code}]\n' --data "$1"; }
curl -s -o /dev/null -w '%{http_code}\n' $A                                   # 405
post '{"q":"Should I buy bitcoin now?"}' | grep -o '"mode": "refused"\|\[200\]'
post '{"q":"is this safe abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}'   # 400, no "abandon" in the error
post '{"q":"What is the weather in Paris?"}' | grep -o '"mode": "no_match"'
post 'nope'                                                                   # 400 with the usage line
pnpm -s brain bench | sed -n 1,5p
```

Proves it when: 405; `refused` with 200; the seed is refused with 400 and the error does not contain the words; `no_match`; 400 usage; the bench prints hit rates (on the edition at block 976,771: covered hit@12 97.7%, hit@5 95.4%, MRR 0.774).

With the model (about 2 cents each; the same question and depth is cached for a day):

```sh
curl -s -X POST $A -H 'Content-Type: application/json' -H 'Accept: application/x-ndjson' \
  --data '{"q":"How many bitcoin will there ever be?","depth":"curious"}'
grep '^{"ask"' var/dev.log | tail -2
```

Proves it when: a `{"type":"read",...}` line with 12 claims, then `{"type":"result"}` with `"mode":"answer"`, `"verdict":"answered"`, sentences each with `cites`, and `cited` ids from the read list (halvings-and-supply.*); the log line shows `"ask":"answer"` with micros near 20,000 and no question text. Asking again shows `"mode":"cached"` and `"micros":0`.

Browser: drive `/ask` (Playwright, SwiftShader): click the first example; `.ask-answer` appears within 60 s; `.ask-text` holds sentences with `[n]` links; clicking one sets the hash to `#cited-1`. Screenshot desktop light and phone dark.

Bench with the model: `pnpm brain bench --ask` (about $3.50 for 200 questions; check `pnpm brain budget` first). It prints pass, grounded and must rates per kind and lists each failure. Baseline on 2026-11-20 (edition at block 976,771, effort low): covered 96.2% pass and 93.1% citing every `must` claim, partial 93.3%, uncovered 88% (the misses say "does not yet describe X" while citing a related claim), refuse 100% (12 house refusals, 3 by the model's own safety refusal), value answers attribute and take no side, 2 of 200 rejected by the check before `unfill` existed, median 4 s.

## Gotchas

- After `pnpm install` changes a dependency that moves Next's folder in the pnpm store (a new peer such as `@opentelemetry/api`), Turbopack's persistent dev cache keeps sending every page a `restart`, and the page reloads in a loop (playwright `networkidle` and screenshots time out, `Compiled` lines pile up in var/dev.log). Stop the dev server, `rm -rf web/.next/dev`, start it again.
- The dev server's memory store forgets counters and cached answers on restart; production's are in Redis.
- `ASK.effort` is low on purpose: answers rest on 12 short claims, and thinking tokens bill as output. Measure with the bench before raising it.
- A not-covered verdict still costs a model call (about 1 cent); only an empty search result skips it.
