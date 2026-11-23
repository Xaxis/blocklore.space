# The loop

What keeps the brain working without a session: the timers (hourly ingest and shipping, a daily recheck of the stalest claims, a weekly bench) and the brain daemon, which syncs with the owner's admin, applies the owner's signed commands and runs research sessions on the owner's schedule (ADMIN.md).

<!-- covers: cli:brain recheck, cli:brain tick, cli:brain review-loop, cli:timers, cli:brain daemon, cli:brain session, cli:brain job, cli:brain ship, cli:brain admin-link, api:POST /api/control/sync, api:GET /api/v1/brain -->

## Sub-features

- recheck (`brain/src/recheck.ts`, `pnpm brain recheck [--limit 30] [--no-commit] [--push]`): the least recently verified claims (by `last_verified` height, then time, then id), checked with `checkClaim` while `capCacheAge(3600)` (`brain/src/http.ts`) makes every source that can change be read again (files at a commit keep their cache). A pass writes `last_verified` with run `<day>-reverify` and method `recheck, <checks>` (not a revision; `claimHash` leaves it out, so snapshot roots do not move). A failure leaves the claim alone and records `{at, problems}` in `knowledge/rechecks.json` (`Recheck` in `core/src/schema.ts`, loaded by `loadStore`, on each bundle claim as `recheck`). Writes the run `knowledge/runs/<year>/<day>-reverify.yaml` (kind `reverify`: what it read, what is open). Exits 1 when any claim failed.
- site: a claim with an open failed recheck shows a callout with the problems on `/claims/<id>` and a "Recheck failed" chip in its topic line (`web/components/ClaimLine.tsx`); `GET /api/v1/claims/<id>` and the export carry `recheck`.
- tick (`brain/src/tick.ts`, `pnpm brain tick <kind> [--force]`): reads the owner's settings first (`tickSkip`): paused, or that tick turned off, records one `skip` line and exits 0; `--force` (a tick the owner starts from the admin) runs anyway. `hourly` ingest, bips (commit), snapshot `--upgrade` (commit), queue pull of new reader suggestions (when `QUEUE_PULL_TOKEN` is set, queue.md), reports (pull, recheck each reported claim first, send the outcomes; problems.md), ship; `daily` recheck (30, commit), snapshot (only when the root changed), ship; `weekly` bench (retrieval only, `--publish --commit` to `knowledge/bench.json`, gaps.md), lab, review (the week that just ended, below), ship; `research` (by hand only) one `daily` research run on the topic `planResearch` picks, then ship. Ship (`ship()`, also `pnpm brain ship`) commits `knowledge/wire.json`, pushes `HEAD:main` when ahead, and deploys with `tools/deploy.sh` per `deployDecision`: never when the live build (`GET /api/v1` `edition.build`) is HEAD, at once when `knowledge/claims`, `topics`, `snapshots` or `rechecks.json` changed since it, otherwise at most every 6 hours (`var/loop/state.json`). Does nothing when the checkout is not on `main`. One JSON line per step in `var/loop/<day>.jsonl`.
- timers (`tools/timers.sh`, `tools/systemd/`): `blocklore-tick@.service` (oneshot, `flock -w 3600 var/loop/tick.lock pnpm -s brain tick %i`, Nice 10) and three timers: hourly (random delay 5 min), daily 04:20 UTC, weekly Monday 05:10 UTC; `blocklore-brain.service` (the daemon, `Restart=always`). `install` fills in the repo root and PATH, removes the old research timer if present, enables the timers, and enables and restarts the daemon; `status`; `uninstall` removes only `blocklore-*` units.
- daemon (`brain/src/daemon.ts`, `pnpm brain daemon [--cycles N]`): POSTs `SyncRequest` to `{BLOCKLORE_SITE}/api/control/sync` with bearer `BRAIN_SYNC_TOKEN` every 20 s (3 s while the reply says `watch`, 0.5 s right after commands; backs off 5 to 60 s on failure, never exits). `dispatch` verifies each returned envelope with `verifyEnvelope` under `CONTROL_KEY`; forged or replayed ones get no result (a log line only), expired ones a failed result. Quick commands apply in-process (`ping`, `settings` via `applyPatch`, `lesson.add|remove`, `research.stop`, which refuses while the session is `publishing`); long ones are queued in `var/control/jobs.json` and run one at a time as `brain job <id>` children (under `flock` on the tick lock, except `research.start`), with results `received`, `running`, then `done` or `failed` (the job's last `RESULT:` line). Review decisions are checked against the pending candidates' hashes (`choose` in `brain/src/review.ts`) before queueing and again in the job. A successful rejection with `lesson` adds a lesson (`afterJob`). The schedule (`researchDecision`, pure) queues a gap-planner session per the owner's mode: off, daily at `dailyAt` UTC, or continuous after `restMinutes`, never past `maxRunsPerDay` or when spent today plus two `perRunUsd` would pass `dailyUsd`; exit 3 (nothing to research) backs off an hour. State (`brain/src/state.ts`): spend from `var/budget/runs.jsonl`, tick status from `var/loop/*.jsonl` and `systemctl --user show ... NextElapseUSecRealtime`, runs (sessions plus published run logs), agenda with gap scores, review count; the ReviewItem list only when its hash changed; live events from `var/control/live.jsonl` (`liveReset` when `current.json` names a new run).
- review-loop (`core/src/loopreview.ts` compiles, `brain/src/loopreview.ts` gathers; `pnpm brain review-loop [--week YYYY-MM-DD] [--write]`; BACKLOG 31): one UTC week, Monday 00:00 to the next, counted to the moment it runs or the week's end. Inputs: `var/control/sessions.jsonl` (research `daily` and evaluator `evaluate` sessions), every `knowledge/runs` log (research kinds, `reverify` with its `open` and `read`, evaluator batches), `var/evaluator/decisions.jsonl` (read whole), `knowledge/rechecks.json`, `var/reports/items.json`, the agenda, the gap scores, `var/review/claims` and the published claims, the owner's settings and whether the devbox has the subscription token. Output: counts (research, evaluator with test claims caught and missed, claims by topic, the rules `heldBack` finds, rechecks, reports, the queue, the agenda) and findings, each a fixed code (`FINDING_CODES`), numbers, evidence ids and a proposal that is an existing `Command` or null; thresholds are the constants at the top of the core file. `--write` and the weekly tick's `review` step (the previous week, `weeklyReview`) save `var/loop/reviews/<week>.json`; the daemon sends the newest to the admin (admin.md, weekly review). Read only otherwise.
- session (`brain/src/session.ts`, `pnpm brain session [--topic] [--focus]`): plans (or takes the owner's topic), runs `researchRun` with `publish: false` (the model phase holds no lock), then `flock ... brain publish <run>` and `brain ship`; appends a RunSummary to `var/control/sessions.jsonl`. Research writes `var/control/current.json` (run, topic, phase, pid) and phase events.
- agent (`brain/src/agent.ts`): model, turns and minutes per session from the owner's settings (`limitsFor`, `usage`); the only credential is the owner's Claude subscription (`roleCredential` passes `CLAUDE_CODE_OAUTH_TOKEN`, never an API key); a session the plan's usage limit stopped backs model work off until the reset (`usageLimit`, `memory.limited`); the daemon starts no session without the token (`researchDecision`); `--output-format stream-json --verbose`, the stream in `<role>.log.jsonl`, one condensed live event per tool call, message and result (`condense`), the outcome from the result line (`parseResult`). The owner's lessons and focus reach the task as "## Notes from the owner" (`ownerNotes` in `brain/src/plan.ts`).
- admin-link (`brain/src/adminlink.ts`): POSTs `signLinkRequest(CONTROL_KEY, now, nonce)` to `/api/control/link` and prints the `url` it answers.
- sync route (`web/app/api/control/sync/route.ts`): the site's side; 401 without the bearer token, 400 for a body that is not `SyncRequest`.

- feed (`core/src/feed.ts`, `brain/src/feed.ts`): the brain's public, live feed. Steps append `FeedEvent` lines to `var/control/feed.jsonl` (validated; a bad event is logged to stderr and dropped, never thrown): ingest (items read), recheck (claims checked, ids, outcome), the tick loop (`STEP_FEED`: what runs now via `feed-now.json`; sealed editions, deploys, bench), research sessions (start, verifier survivors, published ids, close). `publicTopic` lets only published topics through; unpublished candidates appear only as counts. The daemon builds a `BrainFeed` every sync (`buildFeed`: now, next from the tick timers and the research schedule, events, `dayCounts`) and sends it in `SyncRequest.feed`; the site keeps it in Redis (`KEYS.feed`, `pub:brain`) and serves `GET /api/v1/brain` as `{online, feed}` (online when the copy is under 5 minutes old; `s-maxage=5`, CORS open).

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

The weekly review: `node --test core/test/loopreview.test.ts brain/test/loopreview.test.ts` (a quiet week yields no finding; three days without research while the evaluator took the sessions is the first finding, with its cause, evidence and a research proposal; each cause's proposal; a rule broken by 3 real claims proposes its own description as a lesson, none once kept; a canary let through; the queue's wait; rechecks counted only for runs that read the claim; source numbers from 1 in rechecks and from 0 in the evaluator; reports past a week; stale agenda topics by gap score; Monday weeks; no dash in any text; the run logs, the latest file and the text). Against the devbox's real state, read only, from a checkout that is not the devbox's own:

```sh
R=/path/to/the/devbox/checkout
BLOCKLORE_KNOWLEDGE=$R/knowledge BLOCKLORE_CONTROL_DIR=$R/var/control BLOCKLORE_EVALUATOR_DIR=$R/var/evaluator \
  BLOCKLORE_REVIEW_DIR=$R/var/review BLOCKLORE_ENV_FILE=$R/.env node brain/cli.ts review-loop [--week 2026-11-16]
```

Proves it when it prints the week's counts and its findings, most weight first, each with its evidence and proposal, and nothing under `$R` changed. On the devbox itself, `pnpm brain review-loop` is the same with its own paths.

Feed: `node --test brain/test/feed.test.ts` (private topics stay out, bad events dropped, day counts, now and next). Live: `curl -s https://blocklore.space/api/v1/brain | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d['online'],d['feed']['now'],d['feed']['day'])"` prints `True` and what the brain does now once the daemon runs this code.

## Gotchas

- Every tick holds `var/loop/tick.lock`, and so do the daemon's jobs that commit (review, publish, ship, agenda, ticks). A manual `pnpm brain tick` does not take it, so do not run one while a timer's tick is running (`systemctl --user list-units 'blocklore-tick@*'`).
- Ship deploys whatever HEAD is, committed only (deploy.sh uses `git archive`). A session's uncommitted work never ships; its commits on `main` do.
- Ship takes in what reached `origin/main` from elsewhere first (`takeInOrigin` in `brain/src/git.ts`: a merge, never a rebase), so a prompt PR the owner merges on GitHub does not make every later push fail. On a conflict, or local edits the merge would overwrite, it leaves the checkout as it was and returns `not shipped: N commits on GitHub do not merge into this checkout (...)`; a person merges them. `brain/test/git.test.ts` proves both against real repos.
- A scheduled slot goes to the evaluator or to research by `slotFor` (`brain/src/daemon.ts`): while the evaluator has claims due and research has a topic they take turns, so a review backlog cannot take all of the owner's sessions a day. To see what the next slot would be on real state without starting one, call `slotFor` with `evaluatorWanted(settings)`, `agendaStatus(settings).next` and the last line of `var/control/sessions.jsonl` (`kind` "evaluate" or "daily").
- Every research task carries "What the evaluator held back lately" (`brain/src/heldback.ts`): the structural rules `core/src/evaluate.ts` broke in the evaluator's last 80 decisions (`var/evaluator/decisions.jsonl`), most often first, canaries and verifier verdicts left out. A failed rules stage is split only at the names in `EVALUATOR_RULES`, since a rule's text can hold "; ". To see what the next session will read, print `heldBackSection(heldBack(evaluatorFiles().decisions()))`; `brain/test/heldback.test.ts` covers the split and the order.
- Every research task on a topic also carries "Drafts on this topic the evaluator rejected by rule" (`brain/src/redraft.ts`): each id on the topic whose latest real decision was a rejection by the rules stage, not published and not waiting again, newest first, at most 8, with its statement (cut at 300 characters) and each rule it broke. Verifier rejections, holds and canaries are left out. Research may draft one again under the same id; the evaluator keys decisions by id and hash, so the redraft is evaluated afresh. To see a topic's section, run `rejectedSection(rejectedOnTopic(decisions, slug, taken))` over `var/evaluator/decisions.jsonl` read-only; on 2026-11-23 it held 17 drafts on 6 topics (taproot's two are Murch's mailing-list figures, rejected only for no `attributed_to` link). `brain/test/redraft.test.ts` covers what is kept, what is left out, the latest-decision rule and the cap.
- Research's check report also carries the evaluator's code rules for each candidate the gate will mark (`brain/src/rulecheck.ts`, `where: evaluator rules`), so the repair rounds fix a missing attribution link or a second independent source before the evaluator sees the draft; a rule-only failure still passes on to the verifier (`passesChecks`). Proves it: `cd brain && node --test test/rulecheck.test.ts` passes 5, and over the 11-20 seed runs the rules flag 51 of 335 drafts, including all 17 the evaluator rejected by rule and none it passed.
- The planner scores an agenda topic with nothing published and nothing in review as thin at all five depths (`UNSTARTED` in `brain/src/plan.ts`, the same as an empty topic in `core/src/gaps.ts`), so a new agenda topic ranks above topics that are only a little thin. The admin's Agenda shows the same score.
- The daily recheck exits 1 when a claim fails; the tick records that step as ok with a note, since a failing claim is a finding, not a broken loop.
- `brain tick research` and `brain session` use the owner's Claude plan. Research sessions are the owner's to schedule (admin settings); never start one to test the daemon: use ping, settings or a failing agenda command.
- Never send the daemon a review command against the real `var/review` to test it; approvals are the owner's alone. Test `choose` and dispatch with in-memory pending items (daemon.test.ts).
- Restarting the daemon (`systemctl --user restart blocklore-brain`) kills its running job; the next daemon reports it as failed ("restarted while this ran") and marks an unfinished session stopped.
- After `pnpm bundle`, the dev server can keep serving the old bundle on routes it compiled before (the JSON import is not reloaded everywhere). Restart it before checking a bundle change in dev; production builds read the bundle once and are not affected.
- A topic's lede is rendered apart from its sections, so a failed recheck on the lede shows as a note under it (`.lede-recheck`), not as a chip in a line.
