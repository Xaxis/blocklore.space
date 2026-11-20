# The loop

The timers that keep the brain working without a session: hourly ingest and shipping, a daily recheck of the stalest claims, a weekly bench, and a paid daily research run that the owner switches on.

<!-- covers: cli:brain recheck, cli:brain tick, cli:timers -->

## Sub-features

- recheck (`brain/src/recheck.ts`, `pnpm brain recheck [--limit 30] [--no-commit] [--push]`): the least recently verified claims (by `last_verified` height, then time, then id), checked with `checkClaim` while `capCacheAge(3600)` (`brain/src/http.ts`) makes every source that can change be read again (files at a commit keep their cache). A pass writes `last_verified` with run `<day>-reverify` and method `recheck, <checks>` (not a revision; `claimHash` leaves it out, so snapshot roots do not move). A failure leaves the claim alone and records `{at, problems}` in `knowledge/rechecks.json` (`Recheck` in `core/src/schema.ts`, loaded by `loadStore`, on each bundle claim as `recheck`). Writes the run `knowledge/runs/<year>/<day>-reverify.yaml` (kind `reverify`: what it read, what is open). Exits 1 when any claim failed.
- site: a claim with an open failed recheck shows a callout with the problems on `/claims/<id>` and a "Recheck failed" chip in its topic line (`web/components/ClaimLine.tsx`); `GET /api/v1/claims/<id>` and the export carry `recheck`.
- tick (`brain/src/tick.ts`, `pnpm brain tick <kind>`): `hourly` ingest, bips (commit), snapshot `--upgrade` (commit), queue pull (when `QUEUE_PULL_TOKEN` is set), ship; `daily` recheck (30, commit), snapshot (only when the root changed), ship; `weekly` bench (retrieval only); `research` one `daily` research run on `nextTopic` (the agenda topic with nothing waiting for the owner and the fewest published claims), then ship. Ship commits `knowledge/wire.json`, pushes `HEAD:main` when ahead, and deploys with `tools/deploy.sh` per `deployDecision`: never when the live build (`GET /api/v1` `edition.build`) is HEAD, at once when `knowledge/claims`, `topics`, `snapshots` or `rechecks.json` changed since it, otherwise at most every 6 hours (`var/loop/state.json`). Does nothing when the checkout is not on `main`. One JSON line per step in `var/loop/<day>.jsonl`.
- timers (`tools/timers.sh`, `tools/systemd/`): `blocklore-tick@.service` (oneshot, `flock -w 3600 var/loop/tick.lock pnpm -s brain tick %i`, Nice 10) and four timers: hourly (random delay 5 min), daily 04:20 UTC, weekly Monday 05:10 UTC, research 06:00 UTC (installed, not enabled). `install` fills in the repo root and PATH and enables the three free timers; `research on|off`; `status`; `uninstall` removes only `blocklore-*` units.

## How to reach it

- `pnpm brain recheck --limit 6 --no-commit`; `pnpm brain tick hourly`; `tools/timers.sh status`; `journalctl --user -u 'blocklore-tick@*' -n 50`.

## How to check it

Static: `pnpm test` (brain/test/recheck.test.ts: stalest order, a pass refreshes and closes a failure, a failure records errors only; brain/test/tick.test.ts: the deploy rule, the research topic; core/test/rechecks.test.ts: rechecks.json reaches the bundle claim, a bad file is an error).

Recheck without committing (network; about 10 s for 6 claims):

```sh
pnpm -s brain recheck --limit 6 --no-commit
git status --short knowledge                 # 6 claims, knowledge/rechecks.json, the reverify run
git diff knowledge/claims | grep -A3 '^+  run:'   # run: <day>-reverify, method: recheck, ...
node core/cli.ts validate | tail -1          # 0 errors
git checkout -- knowledge/claims && rm -f knowledge/rechecks.json knowledge/runs/*/*-reverify*.yaml   # if this was only a check
```

Proves it when: "recheck <day>-reverify at block N: 6 of 6 passed"; the cache files for the claims' changeable sources have a `fetchedAt` from this minute (files at a commit do not).

A failing recheck on the site, locally: put `{"<claim id>": {"at": {"time": "2026-11-21T04:20:00Z", "height": 976900}, "problems": ["source 2: quote not found"]}}` in `knowledge/rechecks.json`, `pnpm bundle`, open `/claims/<claim id>` (the callout lists the problem) and its topic page (the chip), then remove the file and bundle again.

A tick, for real (it commits, pushes and may deploy):

```sh
pnpm -s brain tick hourly
tail -n 5 var/loop/$(date -u +%F).jsonl
```

Proves it when: one `ok` line per step (ingest, bips, snapshot upgrade, queue pull, ship); ship's note says what it pushed and whether it deployed and why; after a deploy, `tools/deploy.sh --check` agrees.

Timers: `tools/timers.sh install`, then `tools/timers.sh status` lists the three free timers with next runs and the research timer inactive; `systemctl --user start blocklore-tick@weekly.service` runs a tick under systemd and `journalctl --user -u blocklore-tick@weekly -n 20` shows the bench lines.

## Gotchas

- Every tick holds `var/loop/tick.lock`. A manual `pnpm brain tick` does not take it, so do not run one while a timer's tick is running (`systemctl --user list-units 'blocklore-tick@*'`).
- Ship deploys whatever HEAD is, committed only (deploy.sh uses `git archive`). A session's uncommitted work never ships; its commits on `main` do.
- The daily recheck exits 1 when a claim fails; the tick records that step as ok with a note, since a failing claim is a finding, not a broken loop.
- `brain tick research` spends model budget. Leave its timer to the owner.
- After `pnpm bundle`, the dev server can keep serving the old bundle on routes it compiled before (the JSON import is not reloaded everywhere). Restart it before checking a bundle change in dev; production builds read the bundle once and are not affected.
- A topic's lede is rendered apart from its sections, so a failed recheck on the lede shows as a note under it (`.lede-recheck`), not as a chip in a line.
