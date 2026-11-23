# Brain

The devbox brain checks claims against their sources, the chain and the code, researches topics with sandboxed model roles, publishes what passes, and polls the source feeds.

<!-- covers: cli:brain check, cli:brain research, cli:brain publish, cli:brain ingest, cli:brain bips, cli:brain snapshot, cli:brain usage -->

## Sub-features

- check: fetches every locator (raw GitHub at a commit, Delving and Stack Exchange APIs, mailing list by message id, PDFs, HTML with hidden text stripped), finds each quote, runs code.contains (at the commit and, with `live`, on the default branch), chain checks on mempool.space and blockstream.info that must agree, and bip.field.
- research: prepares a run folder under `/var/tmp/blocklore/staging/<run>/`, runs the research role (`claude -p --restricted`, own HOME, scrubbed env; it writes only `claims/`, `topics/`, `debates/` (a debate map, only when `context/task.md` says the topic is contested) and `run.yaml`), checks (with each map's `debate <slug>` report, see [debates](debates.md)), up to 2 repair rounds, the verifier role, then publish.
- publish: re-checks every verified candidate, gates by `brain/policy/topics.yaml`, holds gated claims in `var/review/`, appends revisions, drops links to claims that exist nowhere, compiles the would-be store and commits only when it has no errors.
- ingest: 11 adapters into `var/inbox/`, with cursors and `health.json`: GitHub commits and release tags from treeless git mirrors in `var/git/` (`brain/src/git.ts`), gnusha's bitcoindev Atom feed, Optech RSS, Delving and Stack Exchange JSON.
- http: every fetch obeys robots.txt and Crawl-delay (`brain/src/robots.ts`), revalidates with ETag or Last-Modified, and caches in `var/cache/http`.
- bips: reads `bitcoin/bips` README.mediawiki at the head commit (from `git ls-remote`), parses the index without owners into `knowledge/bips.json`, appends every status, title, type or layer change with its commit and block, and commits as the owner when it changed.
- snapshot: hashes every claim in `knowledge/claims` (committed; it refuses a dirty tree), writes `knowledge/snapshots/<n>.json` with the commit, block, root and the previous root, stamps the file's SHA-256 at the four default OpenTimestamps calendars (at least two must answer) into `<n>.json.ots`, and commits both as the owner. It does nothing when the root is unchanged. `--upgrade` asks each pending calendar (only hosts on the reference whitelist) for the completed proof, checks every block it names against the header both explorers agree on, and commits the completed proof.
- wire: after each ingest, `knowledge/wire.json` gets the newest 80 items across feeds (titles with entities decoded and dashes undone, one per thread title).
- usage: model sessions and minutes today on the owner's Claude subscription, from `var/budget/runs.jsonl`. There is no API key path: `roleCredential` passes only `CLAUDE_CODE_OAUTH_TOKEN`.

## How to reach it

- `pnpm brain check <run id|run dir|claim id>`, `pnpm brain research <topic> [--kind seed] [--no-verify] [--no-publish]`, `pnpm brain publish <run id> [--no-commit] [--push]`, `pnpm brain ingest [--force] [--only <adapter>]`, `pnpm brain budget`.

## How to check it

Static: `pnpm lint`; `pnpm test` (brain/test/text.test.ts, brain/test/publish.test.ts).

Runtime:

```sh
pnpm -s brain check halvings-and-supply.first-halving; echo "exit $?"
pnpm -s brain ingest --only optech --force
python3 -I -c "import json;print(json.load(open('var/inbox/health.json'))['optech'])"
pnpm -s brain usage
pnpm -s brain bips --no-commit
pnpm -s brain snapshot
pnpm -s brain snapshot --upgrade
python3 -I -c "import json;d=json.load(open('knowledge/wire.json'));print(len(d['items']), d['updated'])"
node --input-type=module -e "import {get} from './brain/src/http.ts'; for (const u of ['https://github.com/bitcoin/bitcoin/commits/master.atom','https://gnusha.org/pi/bitcoindev/','https://gnusha.org/pi/bitcoindev/new.atom']) { const s=Date.now(); const r=await get(u,{maxAge:0}); console.log(r.status, ((Date.now()-s)/1000).toFixed(1)+'s', u, r.status?'':r.body.slice(0,60)); }"
```

Proves it when: check prints `PASS  halvings-and-supply.first-halving  (quotes 2/2, chain 4/4 (esplora pair agreed))` and exits 0; ingest prints `ingest optech: N new` and `health.json` shows `failures: 0` with `lastRun` equal to `lastOk` and both just now; budget prints "model roles spent X of 60 USD today (UTC)"; bips prints "bips: index unchanged at <sha>" or "bips: N BIPs at <sha>, K changes" with one line per change; snapshot prints "the claims are as snapshot N recorded them" when nothing changed (or, after a publish, "snapshot N: C claims at block H, root R, stamped at K calendars" and a commit touching only the two snapshot files); upgrade prints each calendar's answer ("not in a block yet" for about the first hour or two) and, once one completes, "snapshot N: in block H" and a commit of the `.ots` only; the wire has 80 items and a fresh `updated`; the robots line prints `0` and "robots.txt at https://github.com disallows" for the Atom URL, then `200` for both gnusha pages with the second taking about 10 s (its Crawl-delay).

For research and publish, prove them on a real run, not a test one: the run folder holds `checks.json`, `verdicts/`, `research.log.json` and `verifier.log.json`; the commit it makes is authored `Xaxis <william.neeley@gmail.com>` and touches only `knowledge/`; `node core/cli.ts validate` then reports 0 errors.

## Gotchas

- A snapshot file is never rewritten: its proof commits to its exact bytes. What the proof attests (pending calendars, blocks) is read from the `.ots` itself, so only the `.ots` changes on upgrade.
- Calendars aggregate submissions and commit about once an hour, so an upgrade straight after a stamp always finds nothing.

- Without `--force`, ingest skips an adapter whose cadence has not come round and prints nothing for it.
- `research` uses the owner's Claude subscription (it refuses without `CLAUDE_CODE_OAUTH_TOKEN`) and shares the plan's limits with the owner's own Claude use: never start one without a reason.
- Run several `research` jobs with `--no-publish` in parallel, then `publish` them one at a time: publishes commit to git and must not race.
- The roles must never see the repo: staging lives outside it so no CLAUDE.md is found. Do not move it back under `var/`.
- GitHub is read without the API quota (git mirrors, `git ls-remote`, raw files); `GITHUB_TOKEN` is used only when set in the environment. GitHub's robots.txt forbids its Atom feeds and commit lists: never add an adapter that reads them.
- A fetch refused by robots.txt returns status 0 with the reason in the body; the check report shows it.
