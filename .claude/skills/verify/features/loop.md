# The loop

What keeps the brain working without a session: the timers (hourly ingest and shipping, a daily recheck of the stalest claims, a weekly bench) and the brain daemon, which syncs with the owner's admin, applies the owner's signed commands and runs research sessions on the owner's schedule (ADMIN.md).

<!-- covers: cli:brain recheck, cli:brain tick, cli:timers, cli:brain daemon, cli:brain session, cli:brain job, cli:brain ship, cli:brain admin-link, api:POST /api/control/sync -->

## Sub-features

- recheck (`brain/src/recheck.ts`, `pnpm brain recheck [--limit 30] [--no-commit] [--push]`): the least recently verified claims (by `last_verified` height, then time, then id), checked with `checkClaim` while `capCacheAge(3600)` (`brain/src/http.ts`) makes every source that can change be read again (files at a commit keep their cache). A pass writes `last_verified` with run `<day>-reverify` and method `recheck, <checks>` (not a revision; `claimHash` leaves it out, so snapshot roots do not move). A failure leaves the claim alone and records `{at, problems}` in `knowledge/rechecks.json` (`Recheck` in `core/src/schema.ts`, loaded by `loadStore`, on each bundle claim as `recheck`). Writes the run `knowledge/runs/<year>/<day>-reverify.yaml` (kind `reverify`: what it read, what is open). Exits 1 when any claim failed.
- site: a claim with an open failed recheck shows a callout with the problems on `/claims/<id>` and a "Recheck failed" chip in its topic line (`web/components/ClaimLine.tsx`); `GET /api/v1/claims/<id>` and the export carry `recheck`.
- tick (`brain/src/tick.ts`, `pnpm brain tick <kind> [--force]`): reads the owner's settings first (`tickSkip`): paused, or that tick turned off, records one `skip` line and exits 0; `--force` (a tick the owner starts from the admin) runs anyway. `hourly` ingest, bips (commit), snapshot `--upgrade` (commit), queue pull of new reader suggestions (when `QUEUE_PULL_TOKEN` is set, queue.md), ship; `daily` recheck (30, commit), snapshot (only when the root changed), ship; `weekly` bench (retrieval only, `--publish --commit` to `knowledge/bench.json`, gaps.md), ship; `research` (by hand only) one `daily` research run on the topic `planResearch` picks, then ship. Ship (`ship()`, also `pnpm brain ship`) commits `knowledge/wire.json`, pushes `HEAD:main` when ahead, and deploys with `tools/deploy.sh` per `deployDecision`: never when the live build (`GET /api/v1` `edition.build`) is HEAD, at once when `knowledge/claims`, `topics`, `snapshots` or `rechecks.json` changed since it, otherwise at most every 6 hours (`var/loop/state.json`). Does nothing when the checkout is not on `main`. One JSON line per step in `var/loop/<day>.jsonl`.
- timers (`tools/timers.sh`, `tools/systemd/`): `blocklore-tick@.service` (oneshot, `flock -w 3600 var/loop/tick.lock pnpm -s brain tick %i`, Nice 10) and three timers: hourly (random delay 5 min), daily 04:20 UTC, weekly Monday 05:10 UTC; `blocklore-brain.service` (the daemon, `Restart=always`). `install` fills in the repo root and PATH, removes the old research timer if present, enables the timers, and enables and restarts the daemon; `status`; `uninstall` removes only `blocklore-*` units.
- daemon (`brain/src/daemon.ts`, `pnpm brain daemon [--cycles N]`): POSTs `SyncRequest` to `{BLOCKLORE_SITE}/api/control/sync` with bearer `BRAIN_SYNC_TOKEN` every 20 s (3 s while the reply says `watch`, 0.5 s right after commands; backs off 5 to 60 s on failure, never exits). `dispatch` verifies each returned envelope with `verifyEnvelope` under `CONTROL_KEY`; forged or replayed ones get no result (a log line only), expired ones a failed result. Quick commands apply in-process (`ping`, `settings` via `applyPatch`, `lesson.add|remove`, `research.stop`, which refuses while the session is `publishing`); long ones are queued in `var/control/jobs.json` and run one at a time as `brain job <id>` children (under `flock` on the tick lock, except `research.start`), with results `received`, `running`, then `done` or `failed` (the job's last `RESULT:` line). Review decisions are checked against the pending candidates' hashes (`choose` in `brain/src/review.ts`) before queueing and again in the job. A successful rejection with `lesson` adds a lesson (`afterJob`). The schedule (`researchDecision`, pure) queues a gap-planner session per the owner's mode: off, daily at `dailyAt` UTC, or continuous after `restMinutes`, never past `maxRunsPerDay` or when spent today plus two `perRunUsd` would pass `dailyUsd`; exit 3 (nothing to research) backs off an hour. State (`brain/src/state.ts`): spend from `var/budget/runs.jsonl`, tick status from `var/loop/*.jsonl` and `systemctl --user show ... NextElapseUSecRealtime`, runs (sessions plus published run logs), agenda with gap scores, review count; the ReviewItem list only when its hash changed; live events from `var/control/live.jsonl` (`liveReset` when `current.json` names a new run).
- session (`brain/src/session.ts`, `pnpm brain session [--topic] [--focus]`): plans (or takes the owner's topic), runs `researchRun` with `publish: false` (the model phase holds no lock), then `flock ... brain publish <run>` and `brain ship`; appends a RunSummary to `var/control/sessions.jsonl`. Research writes `var/control/current.json` (run, topic, phase, pid) and phase events.
- agent (`brain/src/agent.ts`): model, per-session ceiling, daily budget and credential from the owner's settings (`limitsFor`, `dailyBudgetUsd`, `roleCredential`: plan means `CLAUDE_CODE_OAUTH_TOKEN` instead of the API key); `--output-format stream-json --verbose`, the stream in `<role>.log.jsonl`, one condensed live event per tool call, message and result (`condense`), the outcome from the result line (`parseResult`). The owner's lessons and focus reach the task as "## Notes from the owner" (`ownerNotes` in `brain/src/plan.ts`).
- admin-link (`brain/src/adminlink.ts`): POSTs `signLinkRequest(CONTROL_KEY, now, nonce)` to `/api/control/link` and prints the `url` it answers.
- sync route (`web/app/api/control/sync/route.ts`): the site's side; 401 without the bearer token, 400 for a body that is not `SyncRequest`.

## How to reach it

- `pnpm brain recheck --limit 6 --no-commit`; `pnpm brain tick hourly`; `tools/timers.sh status`; `journalctl --user -u 'blocklore-tick@*' -n 50`; `journalctl --user -u blocklore-brain -n 50`; `cat var/control/settings.json`; `tail var/control/results.jsonl`.

## How to check it

Static: `pnpm test` (brain/test/recheck.test.ts; brain/test/tick.test.ts: the deploy rule; brain/test/daemon.test.ts: forged, expired and replayed commands do nothing, settings and lessons persist, stale review hashes refuse and nothing is queued, a rejection's lesson, quick versus queued commands, the schedule in every mode, the live condenser on a recorded real stream (`brain/test/data/stream.jsonl`), the owner's notes, plan credentials, tick skips, agenda edits that keep comments, tick history and job messages; core/test/control.test.ts: signing).

The daemon end to end without the site: start a throwaway HTTP server on a free port that answers `POST /api/control/sync` with `{commands: [<signed ping>, <signed settings patch>], watch: true, at}` once and empty afterwards (sign with `signCommand` from `core/src/control.ts` under a throwaway key), then:

```sh
CD=$(mktemp -d)
BLOCKLORE_SITE=http://127.0.0.1:$PORT BRAIN_SYNC_TOKEN=$TOK CONTROL_KEY=$KEY BLOCKLORE_CONTROL_DIR=$CD \
  node brain/cli.ts daemon --cycles 4
cat $CD/settings.json                     # the patch applied
```

Proves it when: every body the server receives parses as `SyncRequest` (its `state` as `DaemonState`); the second carries `ping done "pong from <host> at <head>"` and `settings done "saved: ..."`; later states show the new settings and `research.next.why` follows the mode (for daily: "daily at HH:00 UTC"). A queued job the same way: send a signed `agenda.remove` for a slug not on the agenda; the results go `received`, `running` (activity `agenda`), then `failed "<slug> is not on the agenda"`, and `brain/agenda/seed.yaml` is untouched.

The real route: `curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3721/api/control/sync` answers 401.

Under systemd (after `tools/timers.sh install`): `systemctl --user status blocklore-brain` is active; `journalctl --user -u blocklore-brain -n 5` shows "daemon: syncing with https://blocklore.vercel.app"; a ping from the admin comes back done within 20 s.

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

## Gotchas

- Every tick holds `var/loop/tick.lock`, and so do the daemon's jobs that commit (review, publish, ship, agenda, ticks). A manual `pnpm brain tick` does not take it, so do not run one while a timer's tick is running (`systemctl --user list-units 'blocklore-tick@*'`).
- Ship deploys whatever HEAD is, committed only (deploy.sh uses `git archive`). A session's uncommitted work never ships; its commits on `main` do.
- The daily recheck exits 1 when a claim fails; the tick records that step as ok with a note, since a failing claim is a finding, not a broken loop.
- `brain tick research` and `brain session` spend model budget. Research sessions are the owner's to schedule (admin settings); never start one to test the daemon: use ping, settings or a failing agenda command.
- Never send the daemon a review command against the real `var/review` to test it; approvals are the owner's alone. Test `choose` and dispatch with in-memory pending items (daemon.test.ts).
- Restarting the daemon (`systemctl --user restart blocklore-brain`) kills its running job; the next daemon reports it as failed ("restarted while this ran") and marks an unfinished session stopped.
- After `pnpm bundle`, the dev server can keep serving the old bundle on routes it compiled before (the JSON import is not reloaded everywhere). Restart it before checking a bundle change in dev; production builds read the bundle once and are not affected.
- A topic's lede is rendered apart from its sections, so a failed recheck on the lede shows as a note under it (`.lede-recheck`), not as a chip in a line.
