# The gap map

What the published store does not cover yet, computed at bundle time from data already published, shown at `/gaps`, and used by the research tick to pick its next topic and frame its task.

<!-- covers: page:/gaps, api:GET /api/v1/gaps, cli:brain gaps -->

## Sub-features

- core (`core/src/gaps.ts`, `gapMap`, called by `compile` as `bundle.gaps`): per topic (published topics plus topics in the review counts), the golden questions Ask answered only in part or not at all (`scorecard.ask.short`, ask.md) placed by `nearestTopic` (the topic most of the top 5 search hits belong to, weighted by rank), depths with fewer than `THIN_AT` (3) claims, claims with an open failed recheck (loop.md), the review count; `gapScore` = 3 per question + 2 per recheck + 1 per thin depth; topics sorted by score, then fewer claims, then slug. Questions with no search hit are `unplaced`; `misses` come from the scorecard.
- page (`/gaps`, `web/app/gaps/page.tsx`): counts, one section per topic with published claims and a score above 0 (`#<slug>` anchors), "Not near any topic", "Waiting for review", "How this list is made". Each topic page links its gaps from the facts row ("N open questions near this topic"). In the footer ("Open gaps"), sitemap, llms.txt and `GET /api/v1`.
- api (`GET /api/v1/gaps`): `{edition, page, gaps}`.
- plan (`brain/src/plan.ts`): `planResearch` (the agenda topic with the highest score and nothing in `var/review`, ties to fewer claims), `researchTask` (the agenda scope, then the questions, thin depths and failed rechecks as deterministic text, never reader text). `brain tick research` uses it; `pnpm brain gaps` prints the map and the run it would start, with no model call.

## How to reach it

- http://localhost:3721/gaps; `GET http://localhost:3721/api/v1/gaps`; `pnpm brain gaps`; any `/topics/<slug>` facts row.

## How to check it

Static: `pnpm test` (core/test/gaps.test.ts: placement, thin depths, recheck and review counts, ranking, unplaced; brain/test/plan.test.ts: the pick skips pending topics and falls back to the thinnest, the task text).

```sh
pnpm -s brain gaps | sed -n 1,12p
pnpm -s bundle && curl -s localhost:3721/api/v1/gaps | jq -c '[.gaps.topics[] | {slug, score, q: (.questions|length)}][:4]'
curl -s localhost:3721/gaps | sed 's/<!-- -->//g' | grep -o 'question[s]* short of a full answer\|Waiting for review\|id="lightning"' | sort -u
curl -s localhost:3721/topics/lightning | sed 's/<!-- -->//g' | grep -o '[0-9]* open questions near this topic'
```

Proves it when: the CLI lists every topic with a score and ends with "next research run: <slug>" and a task holding the agenda scope and the questions; the API's first topics match the CLI's order and scores; the page shows the counts, a section per open topic and "Waiting for review"; the topic page links its open questions. Restart the dev server after `pnpm bundle` (loop.md, gotchas).

## Gotchas

- Placement is by search over published claims only, so a question about a topic with nothing published (covenants, self-custody while they wait for review) lands on the nearest published topic. The research task tells the model to answer only questions within the topic's scope.
- When research covers an "uncovered" golden question, the next scored bench marks Ask's answer as a failure; the bench prints a hint. Move the question to `covered` with its expected claims in `brain/bench/golden.yaml` (this changes the golden hash, which the scorecard notes until the next scored run).
- Questions come only from the last full scored run (`bench --ask --publish`); a retrieval-only weekly run keeps them.
