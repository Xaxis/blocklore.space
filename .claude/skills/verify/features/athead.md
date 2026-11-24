# At head

A claim that quotes a file at a pinned GitHub commit proves what the code or specification said then. Each day the brain reads every such passage again at the head of its repository, and each source says whether its passage is still there, so a reader sees when the code or the spec has moved on from what a claim cites.

<!-- covers: cli:brain at-head, cli:atheadcheck -->

## Sub-features

- core (`core/src/athead.ts`): `pinnedGitHub(url)` (`https://github.com/<owner>/<repo>/blob/<40-hex>/<path>`, else null), `atHeadOf(claim, reading)` joins the reading by claim id, source index and the same URL (a claim revised since shows nothing for the sources it changed until the next reading), `compareUrl`. Schema `AtHead` in `core/src/schema.ts`: `read`, `heads` (`repo`, `branch`, `commit`), `sources` (`claim`, `source`, `url`, `head` it was read at, `state`, `since`).
- the step (`brain/src/athead.ts`, the daily tick's `at head` step after `recheck`, and `pnpm brain at-head`): `pinnedSources` takes every source of a claim not superseded or withdrawn with a pinned GitHub URL and a quote; the head per repository from `git ls-remote` (`remoteHead`); each file fresh from raw.githubusercontent.com (`maxAge: 0`, never cached). `stateAt`: 200 with the quote (`findQuote`) is `current`, 200 without it `changed`, 404 `gone`, anything else null, which keeps the last state and records nothing new. A source pinned at the head itself is `current` without a read; one already read at the same head keeps its state without a read. `since` carries over while the state holds. Writes `knowledge/at-head.json` and commits it as the owner's when anything changed; returns the moved count, which the tick notes. Each reading sends one `recheck` event to the live feed (`feedEvent`): "Read N cited passages again at their repositories' heads: K newly moved on ..." with those claims and outcome `changed`, or "... M still there, K moved on" with outcome `ok`; never `n`, which counts claims rechecked into the day's numbers.
- bundle: `BundleClaim.at_head` (`AtHeadOf[]`: `source`, `repo`, `path`, `pinned`, `branch`, `head`, `state`, `since`, `read`), empty for withdrawn claims and for any claim as of a past moment (`bundleClaimAsOf`); `bundle.atHead` holds `read` and `heads`.
- the claim page: under each such source a line, "Still in <path> at the head of <repo> (<sha>), read <date>." or a "Moved on" badge with the head read, the cited commit and "compare the two" (GitHub's comparison); a callout above the sources when any moved ("A passage it quotes has moved on."). Info tone: the claim holds as cited.
- the API, MCP and export: `at_head` in `GET /api/v1/claims/{id}`, `get_claim` (its description says what changed or gone means) and `/exports/claims.jsonl`, through `claimFull`.
- `/gaps`: "Sources that moved on" (`#moved`) and the count.
- research (`core/src/gaps.ts` `TopicGap.moved`, `brain/src/plan.ts` `researchTask`): each topic's moved passages weigh 1 per claim on `gapScore`, and the research task lists them with the repository, path, cited commit and head, asking research to re-cite a claim about the code as it is now at head, or correct it, and to leave a claim about what happened then on its pinned source. A passage counts only until a daily research run on its topic starts after it moved (`researchedAfter` in `core/src/gaps.ts`, runs by id via `runTopic`): that run had it in its task, so research changed the claim (the reading drops away) or left it as history, and a pinned passage about history never weighs on the score for good. `/gaps` says per passage "Waiting for research on its topic." or "Research had it in its task on <date>; the claim stands as cited."

## How to reach it

- `pnpm brain at-head --no-commit` (about a minute the first time: 427 files; afterwards only the repositories whose head moved).
- http://localhost:3721/claims/taproot.speedy-trial#evidence (its fourth source moved on: Taproot's deployment left `src/chainparams.cpp` once buried); http://localhost:3721/gaps#moved.
- `curl -s localhost:3721/api/v1/claims/taproot.speedy-trial | jq '.claim.at_head[] | {source, state, head}'`.

## How to check it

Static: `node --test core/test/athead.test.ts brain/test/athead.test.ts` (the states, an outage keeping the last reading, a head already read not read again, the join by index and URL).

Runtime:

```sh
pnpm brain at-head --no-commit     # at head: 427 passages in 9 repositories: 424 still there, 3 changed, 0 gone, 0 not read ...
node .claude/skills/verify/atheadcheck.ts http://localhost:3721
```

Proves it when: `atheadcheck: all checks passed`. It reads every moved passage and a sample of current ones again from GitHub at the recorded head (a changed file must lack the quote, a gone file must be a 404, a current one must hold it), then checks the claim pages, a past moment's page, the API, `get_claim` and `/gaps` against the export.

## Gotchas

- A network failure or a 5xx is not `gone`: only a 404 is. A failed head read (`git ls-remote`) keeps every passage of that repository as last read.
- `head` is per passage, not per repository: a passage whose read failed keeps the head it was last read at, so its compare link stays true.
- Raw files are fetched with `maxAge: 0`: a new head every day would otherwise grow `var/cache` without end.
- The step never touches claims or `rechecks.json`: a moved passage is not a failed recheck. The claim holds at its commit.
