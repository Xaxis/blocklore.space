# Admin

The owner's console at `/admin`: email sign-in, the evaluator, research control with a live feed, runs and spend, the agenda, lessons and focus, triage of reader suggestions, and settings (ADMIN.md).

<!-- covers: page:/admin, page:/admin/login, page:/admin/auth, page:/admin/review, page:/admin/evaluator, page:/admin/research, page:/admin/runs, page:/admin/agenda, page:/admin/lessons, page:/admin/questions, page:/admin/settings, api:POST /api/admin/login, api:POST /api/admin/auth, api:POST /api/admin/logout, api:POST /api/admin/command, api:GET /api/admin/poll, api:POST /api/admin/queue, api:POST /api/control/link, cli:admin-check -->

## Sub-features

- sign-in (`web/lib/admin/auth.ts`): only `OWNER_EMAIL` gets a link. `POST /api/admin/login {email}` answers `{ok:true}` whatever the address (5 links an hour per visitor, 10 in all) and mails `/admin/auth#t=<token>` from `login@blocklore.space` through Resend (`RESEND_API_KEY`); without that key, `next dev` prints the link to its log. The token is in the fragment, so no server log sees it. `/admin/auth` shows a "Sign in" button that POSTs `{t}` to `/api/admin/auth` (mail scanners that open links cannot use it up); the token works once (Redis `getdel`) for 15 minutes. The session id goes in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-bl_admin` in production, `bl_admin` in dev); Redis keeps only its SHA-256 for 30 days. Sign out ends it; "Sign out everywhere" (Settings) ends them all.
- devbox link (`web/app/api/control/link/route.ts`, `pnpm brain admin-link`): a request signed under `CONTROL_KEY`, fresh and with an unused nonce, gets the same kind of link; anything else 401.
- guard: every page under `app/admin/(console)/` runs `requireOwner()` in its layout (307 to `/admin/login`); every `/api/admin/*` route runs `ownerFor(req)`: a session, and for POSTs an `Origin` that is the site's own and `Sec-Fetch-Site` same-origin (403 or 401 otherwise). `robots.txt` disallows `/admin`, `/api/admin/` and `/api/control/`; the pages set `noindex`.
- commands (`web/lib/admin/control.ts`, `POST /api/admin/command {cmd}`): the body must parse as `Command` (`core/src/control.ts`); a review decision whose ids or hashes no longer match the queue the daemon last sent is refused with 409 before signing, and so is a `claim.revoke` whose hash is neither the deployed claim's nor one the evaluator's view lists as just published. The site signs the envelope under `CONTROL_KEY` with the owner's address and pushes it to `ctl:cmd`.
- poll (`GET /api/admin/poll[?live=1][&results=id,...]`): the daemon's last state (online when it synced in the last 75 s), the live session events and the results of the page's commands; sets `ctl:watch` so the daemon syncs every 3 s. Pages poll it every 3 s while visible (`useBrain` in `web/components/admin/live.tsx`) and show each sent command's progress (Sent, Received, Running, Done or Failed).
- pages: Overview (status, gated claims waiting, spend, sessions today, devbox head versus the live build, next session, start, pause, deploy, the ticks with "Run now", recent sessions, results); Evaluator (`/admin/evaluator`, from `ctl:evaluator`: who decides, the evaluator or "Hold for me", which shows the old queue of held claims by topic to approve with a note or reject with a reason and "Teach research this"; the state, backlog and last batch; "Evaluate a batch now"; the threshold, window, batch size and test claims per batch; the catch rate lately and in all, by kind; withdraw a published claim by its row or by id, with a reason; recent decisions with every check's result; `/admin/review` redirects here); Research (start on a topic or the planner's pick with a focus, stop, the live feed, mode off/daily/continuous, hour, count, rest, model, credential api/plan with a warning when the devbox lacks it, daily and per-session budget, skip topics in review); Runs and spend (sessions, spend by day); Agenda (topics by need, research now, edit scope, add, remove when empty); Lessons and focus; Reader suggestions (`/admin/questions`: every status, including waiting and declined, triage to researching, answered or declined, public note, answering claims; `POST /api/admin/queue` runs `updateProblem` (the brain's rules: published claims, a styled, secret-free note) and then writes Redis through `updateQueue`, and a suggestion is public only once triaged here or by the brain, queue.md); Settings (pause, ticks on or off, ping, deploy, sign out everywhere). There is no Ask switch or budget: the site runs no model for readers.

## How to reach it

- Dev: `web/.env.development.local` (gitignored, mode 600) holds a throwaway `OWNER_EMAIL=owner@example.test`, `CONTROL_KEY` and `BRAIN_SYNC_TOKEN`; `next dev` reloads it without a restart. Make one with `node -e 'const r=()=>require("crypto").randomBytes(32).toString("hex");require("fs").writeFileSync("web/.env.development.local",`OWNER_EMAIL=owner@example.test\nCONTROL_KEY=${r()}\nBRAIN_SYNC_TOKEN=${r()}\n`,{mode:0o600})'`. Without Redis, dev keeps sessions, commands and state in memory.
- A daemon for the dev site, with its own state so nothing touches `var/control/` (run in the background): `set -a; . <(grep -E '^(CONTROL_KEY|BRAIN_SYNC_TOKEN)=' web/.env.development.local); set +a; BLOCKLORE_CONTROL_DIR=$SCRATCH/control BLOCKLORE_SITE=http://localhost:3721 exec node --env-file-if-exists=.env brain/cli.ts daemon`. It reads the real `var/review/` queue, so never approve or reject there.
- Production: https://blocklore.space/admin (or https://blocklore.vercel.app/admin), signed in with the owner's mail or `pnpm brain admin-link`.

## How to check it

Free API checks against the dev site:

```sh
H='-H Origin:http://localhost:3721 -H Content-Type:application/json'
curl -s $H -d '{"email":"someone@else.test"}' localhost:3721/api/admin/login           # {"ok":true}, no link in the log
curl -s -o /dev/null -w "%{http_code}\n" -H Content-Type:application/json -d '{"email":"x@y.z"}' localhost:3721/api/admin/login   # 403 (no Origin)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" localhost:3721/admin               # 307 .../admin/login
curl -s -o /dev/null -w "%{http_code}\n" localhost:3721/api/admin/poll                      # 401
curl -s -w " %{http_code}\n" -H Content-Type:application/json -d '{"at":"2026-11-21T10:00:00.000Z","nonce":"00112233445566778899aabbccddeeff","sig":"0000000000000000000000000000000000000000000000000000000000000000"}' localhost:3721/api/control/link   # Not authorized. 401
```

The browser run, with the dev daemon above: `heavy node tools/admin-check.ts $SCRATCH/admin --write`. It gets a link with `pnpm brain admin-link`, signs in, and prints one line per check: signed in with the token gone from the address bar, the session cookie, the link refused the second time, the brain online, ping answered, a lesson added and removed, the research mode changed and restored, gated claims held for the owner and handed back. Then it writes 32 screenshots (8 pages, desk and phone, light and dark). Proves it when every line says `ok` and the exit code is 0; look at `overview-desk-light.png` and `evaluator-desk-light.png`.

Against production, leave out `--write` (it changes the real daemon's settings): `node tools/admin-check.ts $SCRATCH/admin-live https://blocklore.vercel.app` signs in with the production `CONTROL_KEY` from `.env`, pings, and screenshots.

## Gotchas

- React runs effects twice in dev. `/admin/auth` reads the token from the fragment and clears it; the second run must keep the first run's token (it does: `setToken((prev) => m?.[1] ?? prev ?? "")`). Same for any future fragment handoff.
- Next's route announcer has `role="alert"`, so a test that waits for "the" alert picks it up; wait for text instead.
- Relative times ("12 s ago") differ between the server render and the browser; render them with `<Ago>` (`suppressHydrationWarning`), or the dev overlay counts an issue.
- A command waits in `ctl:cmd` for the daemon and expires after 15 minutes. If the admin shows "Waiting for the brain to pick it up", look at `journalctl --user -u blocklore-brain -n 50`.
- Approve, reject, withdraw and "Evaluate a batch now" act on the daemon's own checkout. Drive them only against a daemon run from a scratch clone ([review](review.md)), never the dev daemon above, which reads the real `var/review/`.
