# The admin

The owner runs Blocklore from `/admin` on the site: the review queue, the research brain on the
devbox, its schedule, budget and model, the agenda, standing lessons and reader suggestions.
Everything a person decides happens there; the CLI (`pnpm review`, `pnpm brain ...`) stays as a
fallback that does the same things.

## The pages

| Page | What the owner does there |
| --- | --- |
| Overview | Sees the brain's status, the review count, today's spend, the next session and the ticks; starts a session, pauses, deploys, runs a tick now. |
| Review | Reads each held claim with why it was held, the verifier's verdict, its sources and quotes; approves with a note or rejects with a reason, optionally kept as a lesson. |
| Research | Starts a session on a topic or the planner's pick, with a focus; stops it; watches it live; sets mode, hour, count, rest, model, credential and budget. |
| Runs and spend | Every session with what it published and held and what it cost; spend by day. |
| Agenda | The topics by need; edits scopes, adds and removes topics, starts research on one. |
| Lessons and focus | The current focus and the standing lessons research reads. |
| Reader suggestions | Every suggestion, including waiting and declined ones; triages it (being researched, answered with the claims that answer it, or declined) and writes the public note. Nothing a reader suggests is public until it is triaged here or by the brain. |
| Security embargo | Reads each finding the disclosure gate held (a failed lab run, or a research claim that may describe an undisclosed weakness) with why it was held and the projects' private reporting addresses; releases it once the project has published, or dismisses it (SECURITY.md, T9). |
| Settings | Pauses everything, turns ticks on or off, pings the brain, deploys; signs out everywhere. |

Triage of reader suggestions changes the site's Redis directly and applies at once; everything
else goes to the devbox as a signed command and shows its progress (sent, received, running, done
or failed). There is no model on the site to switch or budget: readers bring their own through
`/mcp` (2026-11-21).

## Signing in

- One address may sign in: `OWNER_EMAIL` (Vercel env and `.env`, never in the repository).
- `/admin/login` takes an address and, only when it is the owner's, mails a one-time link from
  `login@blocklore.space` (Resend, Xaxis team, a key that can only send from blocklore.space). The
  page answers the same either way, so it does not reveal the address. Links last 15 minutes, work
  once, and open a confirm button (a POST) so mail scanners that follow links do not use them up.
- When mail fails, `pnpm brain admin-link` on the devbox asks the site for the same kind of link,
  signed under `CONTROL_KEY`, and prints it.
- A session is a random id in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie; Redis keeps only
  its hash, for 30 days. Sign out ends it; "sign out everywhere" ends them all.
- Every admin page and route checks the session on the server. Every change is a POST that must
  come from the site's own origin.

## The control plane

```
  owner's browser                site (Vercel)                         devbox
  ---------------                -------------                         ------
  /admin  -- POST, session -->   signs the command      <-- POST /api/control/sync --  brain daemon
                                 (HMAC, CONTROL_KEY)        bearer BRAIN_SYNC_TOKEN:       |
                                 queues it in Redis         state, review queue, live      | verifies,
                                 ctl:cmd                    events, results                | applies
          <-- state, live --     ctl:state, ctl:review  --> queued commands                v
                                 ctl:live, ctl:result:*                                 var/control/
```

- The devbox takes no inbound connection and holds no Redis credential. The daemon calls the
  sync endpoint every 20 seconds, every 3 while the owner has the admin open (`ctl:watch`).
- A command is applied only with a valid HMAC under `CONTROL_KEY`, at most 15 minutes old, and
  once (`core/src/control.ts`). Redis never sees the key, so a leaked Redis or sync token can show
  or delay state but cannot approve a claim, start a run or change a setting.
- An approval names each claim with the SHA-256 of the pending candidate the owner was shown. If
  the file changed since, nothing is approved and the admin says so.
- Owner text (notes, reasons, focus, lessons, agenda scopes) is length-limited and refuses
  control characters. It reaches the research model as the owner's words, in a section of its
  own; reader text never does.

| Command | What the daemon does |
| --- | --- |
| `ping` | Answers, to prove the round trip. |
| `settings` | Changes `var/control/settings.json` (schema `Settings`). |
| `review.approve` | Checks each hash, publishes through `brain/src/review.ts` under the tick lock, ships. |
| `review.reject` | Checks each hash, records the rejection, optionally keeps the reason as a lesson, ships. |
| `research.start` | Starts a research session now, on a topic or the gap planner's pick. |
| `research.stop` | Stops the running session (its process group); nothing it staged publishes. |
| `tick` | Runs the hourly, daily or weekly tick now. |
| `ship` | Pushes and deploys now. |
| `agenda.save`, `agenda.remove` | Edits `brain/agenda/seed.yaml` and commits it as the owner. |
| `lesson.add`, `lesson.remove` | Edits the standing lessons. |
| `embargo.decide` | Releases an embargoed finding (a research candidate joins the review queue; a lab run is committed and shipped) or dismisses it. The site refuses one that already left the embargo. |

## The brain daemon

`pnpm brain daemon`, run by the user unit `blocklore-brain.service` (restarts on failure). Each
cycle it syncs, applies what came back, and starts work when the schedule says so:

- **Research modes** (owner's choice): `off` runs only what the owner starts; `daily` runs one
  session at the chosen UTC hour; `continuous` runs sessions back to back with a rest between,
  up to a number a day, while the day's budget allows another.
- **A research session** is the existing pipeline (ARCHITECTURE.md, "Data flow of one claim"):
  the gap planner picks the topic (`brain/src/plan.ts`) unless the owner named one; the research
  role (Claude Code, headless, boxed in, `brain/src/agent.ts`) drafts claims; code checks them;
  the role repairs failures; a verifier model with fresh context tries to falsify them; the
  publisher merges what survives, and the gate holds what needs the owner. The model phase does
  not hold the tick lock; publishing and shipping do.
- **What it learns from**: the gap map (golden questions the store covers only in part or not at
  all, thin depths, failed rechecks), reader suggestions taken up for research, the owner's
  standing lessons (often a rejection's reason), and the owner's current focus. The owner's bench
  (`pnpm brain bench`, with `--ask` for answer scores) measures whether it helps.
- **Live**: the research role streams its turns (`--output-format stream-json`); the daemon
  forwards a condensed line per tool call and message to the admin.
- **Credential**: `api` uses `ANTHROPIC_API_KEY`, billed per token against the daily budget;
  `plan` uses `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, the owner's Claude plan,
  shared with the owner's other sessions. Either way the role sees only that one secret.
- **The ticks** (hourly, daily, weekly) stay systemd timers; each reads the settings first and
  skips when the owner paused the brain or turned that tick off.

State lives in `var/control/` on the devbox: `settings.json`, `seen.json` (applied command ids),
`results.jsonl`, `jobs.json` (queued work), `live.jsonl` (the current session's events).
