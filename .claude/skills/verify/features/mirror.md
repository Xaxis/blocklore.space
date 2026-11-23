# Mirror

Anyone runs Blocklore in production from a fresh clone with no environment, keeps it current with `tools/mirror-update.sh`, and proves with `pnpm mirror:check` that it serves the same store as the origin (MIRROR.md).

<!-- covers: cli:mirror:check, cli:mirror-update, cli:mirrorcheck -->

## Sub-features

- judgement: `core/src/mirror.ts`, pure. `readEdition` and `readMcp` parse the answers at the edge; `mirrorPosition` places the mirror (same, behind, ahead, differs) from the two editions (store moment, newest sealed edition, build) and, when the builds differ, git history; one line each from `editionLine`, `snapshotLines` (every `/snapshots/<n>.json` by SHA-256; a different file under one number always differs), `exportLine` (the whole export, then every claim in it), `claimsLine` over `compareClaim` (the hash a site names and its content as served; behind only when the claim says exactly what the origin's said at an earlier revision, rebuilt with `claimAtRevision`), `textLine` (`/llms.txt`) and `mcpLine` (initialize); `mirrorVerdict` gives the exit code.
- check: `tools/mirror-check.ts` (`pnpm mirror:check <mirror> [--origin URL] [--sample N] [--seed N]`, origin https://blocklore.space by default) fetches both sites, every request with `X-Blocklore-Check: 1`, only GETs and one POST of initialize to each `/mcp`; orders two builds with `git merge-base --is-ancestor` in the clone it runs from. Exit 0 all ok, 1 any difference, 2 only behind or only ahead, 3 the origin could not be read.
- update: `tools/mirror-update.sh ROOT [-- RESTART...]` keeps `ROOT/a` and `ROOT/b`; the first run builds `ROOT/a` and links `ROOT/current`; later runs fetch origin's HEAD branch into the clone not served, build it with `BLOCKLORE_BUILD` set to its commit, swap `ROOT/current` in one rename and run RESTART; nothing to build says "up to date".
- what a mirror leaves out (MIRROR.md's table): admin 307 to login and 401s, login 403 off blocklore.space, control 401, `/api/v1/brain` `{"online":false,"feed":null}`, suggestions and reports 503 with their message, pulls 401, reach not counted. `.claude/skills/verify/mirrorcheck.ts BASE_URL [OUT_DIR]` checks each, and in Chromium what a reader sees; it posts, so never run it against blocklore.space.

## How to reach it

- `pnpm mirror:check http://127.0.0.1:3726 --origin http://127.0.0.1:3727`; `tools/mirror-update.sh "$S/mirror"`. Against https://blocklore.space it reads only, like `tools/deploy.sh --check`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/mirror.test.ts: positions, every line's verdicts, a claim at an earlier revision is behind and one changed byte is not, related links dropped for unpublished claims, the sample, exit codes).

Runtime, end to end, with two production servers of your own on 3726 and 3727 (never 3721 to 3725), every install and build under `heavy`, nothing from the repo's node_modules, and an empty environment (`env -i PATH=... HOME=...`, no `.env`):

```sh
S=$SCRATCH/mirror-proof; E="env -i PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin HOME=$HOME"
SHA=$(git rev-parse --short=7 HEAD); OLD=$(git log -1 --format=%h -- knowledge)^   # one knowledge/ commit behind
# The origin: a fresh clone of HEAD, built and started on 3727.
git clone "$PWD" "$S/origin"
(cd "$S/origin" && heavy $E pnpm install --frozen-lockfile && heavy $E BLOCKLORE_BUILD=$SHA pnpm build)
(cd "$S/origin/web" && $E pnpm exec next start --port 3727 --hostname 127.0.0.1)          # run_in_background
# The mirror follows a scratch upstream whose default branch (master) starts at OLD.
git init --bare "$S/upstream.git"
(cd "$S/upstream.git" && git fetch "$PWD" HEAD:refs/heads/head && git branch master "$OLD")
git clone "$S/upstream.git" "$S/mirror/a"
heavy $E "$S/origin/tools/mirror-update.sh" "$S/mirror"                 # builds a, links current to it
(cd "$S/mirror/current/web" && $E pnpm exec next start --port 3726 --hostname 127.0.0.1)  # run_in_background
pnpm mirror:check http://127.0.0.1:3726 --origin http://127.0.0.1:3727; echo "exit $?"   # behind, 2
(cd "$S/upstream.git" && git fetch "$PWD" HEAD:refs/heads/master)
heavy $E "$S/origin/tools/mirror-update.sh" "$S/mirror" -- echo restart # builds b, swaps, runs the hook
# stop 3726 and start it again from $S/mirror/current/web, then:
pnpm mirror:check http://127.0.0.1:3726 --origin http://127.0.0.1:3727; echo "exit $?"   # ok, 0
# Change one byte of one claim's statement in $S/mirror/current/knowledge/claims, then
# (cd "$S/mirror/current" && heavy $E BLOCKLORE_BUILD=$SHA pnpm build), restart 3726, and:
pnpm mirror:check http://127.0.0.1:3726 --origin http://127.0.0.1:3727; echo "exit $?"   # differs, 1
```

What a mirror leaves out, on the same-commit mirror (3726), then `grep -ciE 'error|exception' <its log>`:

```sh
heavy node .claude/skills/verify/mirrorcheck.ts http://127.0.0.1:3726 "$SCRATCH/mirror-shots"; echo "exit $?"
```

Proves it when: the mirror one knowledge/ commit behind prints `behind` on the edition (an older commit) and on `mcp initialize`, `ok` on what did not change, and exits 2; after the update every line is `ok` and it exits 0; with one changed byte `exports/claims.jsonl` and `api/v1/claims` say `differs` and name the claim, and it exits 1. The left-out routes answer: GET `/admin` and `/admin/review` 307 to `/admin/login`, `/admin/login` 200, `/api/admin/poll` 401, `/api/v1/brain` 200, queue and both report reads 503, both pulls 401, `/progress/2026-11` 200; POST login and auth 403, command, sync and link 401, queue and report 503 with their message; POST queue and reports status 401; in Chromium the claim's "Reader reports" block says they are not available and offers no form, the Brain view says "Not reporting yet", the box on `/gaps` answers "Suggestions are not available right now.", and no page error; `mirrorcheck.ts` prints 25 `ok` lines and "mirror leaves out what it should, quietly", exit 0; the server log has no error. A header-logging proxy in front of either side sees `x-blocklore-check=1` on every request.

## Gotchas

- Build the mirror with `BLOCKLORE_BUILD` set (the update script does). A `dev` build cannot be placed in history, so its edition line differs.
- A served claim's `related` leaves out links to claims not published, while its `hash` is the stored claim's, so a claim's hash cannot be recomputed from the API alone. The check compares the hash each site names and the content each serves, and never recomputes one from the other.
- The worktree guard refuses `git update-ref` and `symbolic-ref`; in a scratch bare repo use `git branch` and `git fetch <repo> <rev>:refs/heads/<name>` instead.
- `next start` binds every interface unless given `--hostname 127.0.0.1`.
- `tools/shots.ts` waits for `networkidle`, which a loaded box may never reach on the claim page (180 s timeout); `mirrorcheck.ts` waits for the text it needs instead.
- Reach counting starts on 2026-11-24 (`REACH_SINCE` in `web/app/progress/[month]/page.tsx`); before it the month says "Counted from", after it a mirror's month says the counts cannot be read.
