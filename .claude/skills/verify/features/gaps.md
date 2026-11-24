# The gap map and the bench

What the published store does not cover yet, computed at bundle time from data already published, shown at `/gaps` ("Learning next", in the Brain view) beside the reader suggestion box, and used by the research tick to pick its next topic. Its questions come from the owner's bench over the golden set, an internal measurement no reader sees as answers.

<!-- covers: page:/gaps, api:GET /api/v1/gaps, cli:brain gaps, cli:brain bench -->

## Sub-features

- bench (`brain/src/bench.ts`, `brain/bench/golden.yaml`, 200 questions with known answers): retrieval hit@1, @5, @12, must@12 and MRR per kind (free, deterministic). No model runs: `--publish` (whole set only) writes `knowledge/bench.json` (`Scorecard` in `core/src/schema.ts`, `buildScorecard`): search rates per kind and the misses below rank 5; `ask` is always null since 2026-11-21. `--commit` commits it as the owner. The weekly tick runs `--publish --commit` (loop.md). Owner-run only: no page or endpoint shows the scorecard.
- core (`core/src/gaps.ts`, `gapMap`, called by `compile` as `bundle.gaps`): per topic (published topics plus topics in the review counts), the `short` golden questions placed by `nearestTopic` (the topic most of the top 5 search hits belong to, weighted by rank), depths with fewer than `THIN_AT` (3) claims, claims with an open failed recheck (loop.md), `moved` (each passage a claim quotes that is no longer at its repository's head, from `at_head`, until a daily research run on the topic starts after it moved, `researchedAfter`; athead.md), the review count; `gapScore` = 3 per question + 2 per recheck + 2 per threat + 1 per thin depth + 1 per claim with a moved passage; topics sorted by score, then fewer claims, then slug. Questions with no search hit are `unplaced`; `misses` come from the scorecard; `scored` is when the answers were last scored.
- advisories (`gaps.advisories`, BACKLOG 36): advisories the security watch read that no rule of `core/src/advisories.ts` files under a threat and the owner's map does not place (security.md). They are the owner's to map and never weigh on `gapScore` or research's pick.
- page (`/gaps`, `web/app/gaps/page.tsx`): "Suggest a question" first (the box, queue.md), then counts (with "advisories to map"), one section per topic with published claims and a score above 0 (`#<slug>` anchors), "Not near any topic", "Advisories to map" (`#advisories`: each advisory linked, with source, date, severity and its ids, or "Every advisory the watch has read is filed under a threat."), and a rail with "By topic", "Waiting for review" and "How this list is made" ("Blocklore's test set of 200 with known answers", the date it was last measured). A topic page's rail links its gaps ("N questions near this topic that the claims answer only in part. Open gaps"). In the Brain view's tabs ("Learning next", `web/lib/nav.ts`), linked from the front page's "Learning next", the sitemap, llms.txt and `GET /api/v1`.
- moved (`#moved`, "Sources that moved on"): every passage a published claim quotes that is no longer at its repository's head, from each claim's `at_head`, with GitHub's comparison, whether research has had it ("Waiting for research on its topic." or "Research had it in its task on <date>; the claim stands as cited."), and the "sources moved on" count; see [athead](athead.md).
- api (`GET /api/v1/gaps`): `{edition, page, gaps: {topics, unplaced, misses, scored, advisories}}`.
- plan (`brain/src/plan.ts`): `planResearch` (the agenda topic with the highest score and nothing in `var/review`, ties to fewer claims), `researchTask` (the agenda scope, then the questions, thin depths, failed rechecks and moved passages (each with its repository, path, cited commit and head, and what to do: re-cite a claim about now at head or correct it, leave a claim about then) as deterministic text, never reader text). `pnpm brain gaps` prints `moved N` per topic. `brain tick research` and the daemon's sessions use it; `pnpm brain gaps` prints the map and the run it would start, with no model call.

## How to reach it

- http://localhost:3721/gaps; `GET http://localhost:3721/api/v1/gaps`; `pnpm brain gaps`; `pnpm brain bench [--limit N] [--only kinds] [--ids g001,...] [--publish [--commit]]`; the "Not covered yet" block on any `/topics/<slug>` rail.

## How to check it

Static: `pnpm test` (core/test/gaps.test.ts: placement, thin depths, recheck and review counts, ranking, unplaced; brain/test/plan.test.ts: the pick skips pending topics and falls back to the thinnest, the task text; brain/test/bench.test.ts: the stats and the keep-or-replace rule; core/test/scorecard.test.ts: the loader; core/test/ask.test.ts and core/test/search.test.ts: the answer check and retrieval the bench measures).

```sh
pnpm -s brain gaps | grep '^next research run'
pnpm -s bundle && curl -s localhost:3721/api/v1/gaps | jq -c '[.gaps.topics[] | {slug, score, q: (.questions|length)}][:4]'
curl -s localhost:3721/gaps | sed 's/<!-- -->//g' | grep -o 'Suggest a question\|questions short of a full answer\|Waiting for review\|test set of 200 with known answers\|id="lightning"' | sort -u
curl -s localhost:3721/topics/lightning | sed 's/<!-- -->//g' | grep -o '[0-9]* questions* near this topic that[a-z ]*\.\|href="/gaps#lightning"' | sort -u
pnpm -s brain bench | sed -n 1,5p
```

Proves it when: the CLI ends with "next research run: <slug> (score N)"; the API's first topics match the CLI's order and scores (on 2026-11-21: lightning 45 with 15 questions, then fees-and-mempool 30, segwit 29, utxo-model 24); the page shows all five strings; the topic page links its open questions; the bench prints hit rates per kind (on the edition at block 976,842: all hit@5 93.0%, covered hit@12 97.7%, MRR 0.774). Restart the dev server after `pnpm bundle` (loop.md, gotchas).

Publishing the scorecard (free; leaves a diff in `knowledge/bench.json` when the edition changed, so revert it unless this is the weekly run):

```sh
pnpm -s brain bench --publish | grep -E 'wrote|unchanged'
node -e 'const s=require("./web/.generated/bundle.json").scorecard; console.log(s.retrieval[0].kind, s.retrieval[0].hit5, s.misses.length)'
```

Proves it when: `wrote knowledge/bench.json` (or `unchanged`); after `pnpm bundle`, the bundle's "all" `hit5` matches the bench's "all" line and `misses` matches `GET /api/v1/gaps`'s `misses` length.


## Gotchas

- Placement is by search over published claims only, so a question about a topic with nothing published (covenants, self-custody while they wait for review) lands on the nearest published topic. The research task tells the model to answer only questions within the topic's scope.
- When research covers an "uncovered" golden question, the next scored bench marks the answer as a failure; the bench prints a hint. Move the question to `covered` with its expected claims in `brain/bench/golden.yaml` (this changes the golden hash).
- A not-covered verdict still costs a model call (about 1 cent); only an empty search result skips it.
