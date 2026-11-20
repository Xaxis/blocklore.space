# Brain

The devbox brain checks claims against their sources, the chain and the code, researches topics with sandboxed model roles, publishes what passes, and polls the source feeds.

<!-- covers: cli:brain check, cli:brain research, cli:brain publish, cli:brain ingest, cli:brain budget -->

## Sub-features

- check: fetches every locator (raw GitHub at a commit, Delving and Stack Exchange APIs, mailing list by message id, PDFs, HTML with hidden text stripped), finds each quote, runs code.contains (at the commit and, with `live`, on the default branch), chain checks on mempool.space and blockstream.info that must agree, and bip.field.
- research: prepares a run folder under `/var/tmp/blocklore/staging/<run>/`, runs the research role (`claude -p --restricted`, own HOME, scrubbed env), checks, up to 2 repair rounds, the verifier role, then publish.
- publish: re-checks every verified candidate, gates by `brain/policy/topics.yaml`, holds gated claims in `var/review/`, appends revisions, drops links to claims that exist nowhere, compiles the would-be store and commits only when it has no errors.
- ingest: 11 adapters (GitHub Atom feeds, gnusha, Optech, Delving, Stack Exchange, transcripts) into `var/inbox/`, with cursors and `health.json`.
- budget: model spend today against `BRAIN_DAILY_BUDGET_USD` (default 60), from `var/budget/runs.jsonl`.

## How to reach it

- `pnpm brain check <run id|run dir|claim id>`, `pnpm brain research <topic> [--kind seed] [--no-verify] [--no-publish]`, `pnpm brain publish <run id> [--no-commit] [--push]`, `pnpm brain ingest [--force] [--only <adapter>]`, `pnpm brain budget`.

## How to check it

Static: `pnpm lint`; `pnpm test` (brain/test/text.test.ts, brain/test/publish.test.ts).

Runtime:

```sh
pnpm -s brain check halvings-and-supply.first-halving; echo "exit $?"
pnpm -s brain ingest --only optech --force
python3 -I -c "import json;print(json.load(open('var/inbox/health.json'))['optech'])"
pnpm -s brain budget
```

Proves it when: check prints `PASS  halvings-and-supply.first-halving  (quotes 2/2, chain 4/4 (esplora pair agreed))` and exits 0; ingest prints `ingest optech: N new` and `health.json` shows `failures: 0` with `lastRun` equal to `lastOk` and both just now; budget prints "model roles spent X of 60 USD today (UTC)".

For research and publish, prove them on a real run, not a test one: the run folder holds `checks.json`, `verdicts/`, `research.log.json` and `verifier.log.json`; the commit it makes is authored `Xaxis <william.neeley@gmail.com>` and touches only `knowledge/`; `node core/cli.ts validate` then reports 0 errors.

## Gotchas

- Without `--force`, ingest skips an adapter whose cadence has not come round and prints nothing for it.
- `research` spends real money (about 4 USD a topic with Opus) and refuses to start past the daily budget.
- Run several `research` jobs with `--no-publish` in parallel, then `publish` them one at a time: publishes commit to git and must not race.
- The roles must never see the repo: staging lives outside it so no CLAUDE.md is found. Do not move it back under `var/`.
- GitHub is read without the API quota (`git ls-remote`, Atom, raw); `GITHUB_TOKEN` is used only when set in the environment.
