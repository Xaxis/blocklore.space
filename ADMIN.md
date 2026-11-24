# The admin

The owner runs Blocklore from `/admin` on the site: the evaluator, the research brain on the
devbox, its schedule, limits and model, the agenda, the gate policy, standing lessons, reader
suggestions and reader reports.
Everything a person decides happens there; the CLI (`pnpm review`, `pnpm brain ...`) stays as a
fallback that does the same things.

## The pages

| Page | What the owner does there |
| --- | --- |
| Overview | Sees the brain's status, how many gated claims wait, today's spend, the next session and the ticks; starts a session, pauses, deploys, runs a tick now. |
| Evaluator | Chooses who decides gated claims: the evaluator (the default) or the owner, which brings back the queue to approve with a note or reject with a reason. Sets the canary threshold and batch sizes; runs a batch now; reads each decision with every check's reason and the calibration numbers; withdraws any published claim with a reason. `/admin/review` leads here. |
| Research | Starts a session on a topic or the planner's pick, with a focus; stops it; watches it live; sets mode, hour, count, rest, model and the per-session limits, and shows whether the devbox is connected to the owner's Claude subscription. |
| Runs and usage | Every session with what it published and held and how many minutes it took; use of your plan by day. |
| Weekly review | The brain's review of its own loop for the latest week (`core/src/loopreview.ts`): the week in numbers (research and evaluator sessions, the days since the last research session, claims drafted, published, rejected and held by topic, test claims caught and missed, the rules that held claims back, rechecks, reader reports, the review queue's longest wait, agenda topics no session touched in 14 days), then its findings, most weight first, each with the records it rests on linked to the page that shows them. A finding you can act on carries a proposal: an existing command (a standing lesson built from the rule's own words, a research session on a topic, a batch for the evaluator, a setting), sent only when you press its button. The Overview has one line linking here while the latest review has findings. |
| Agenda | The topics by need; edits scopes, adds and removes topics, starts research on one. A topic the gate policy does not list says so ("Not in the gate policy": every claim on it waits for the evaluator) with a link to Gate policy. Under Proposed, topics drafted in `brain/agenda/proposed.yaml` (research never reads that file) open in the editor to read, change and add. |
| Gate policy | Every topic on the agenda or published, with its flags as `brain/policy/topics.yaml` sets them ("Not listed: every claim on it waits for the evaluator" when it does not) and how many of its claims wait now; picks Yes or No for contested (every claim on it waits for the evaluator's closer checks) and for safety advice (its claims also need two independent sources and no advice voice) and saves the row; nothing is pre-selected for a topic the file does not list. Then the contested terms, which hold a claim that names one on any topic: adds one, removes one. The brain writes the file, commits it as yours and ships it; claims already waiting keep waiting for the evaluator. |
| Debate maps | Every published map with its positions and claim count; withdraws one with a reason (`debate.withdraw`). Its claims stay published; the map leaves every list, its page and the API say when and why, and no map publishes under its slug again. Withdrawn maps are listed below with the reason. |
| Threat map | Every threat on the security map by layer, those with a gap first: the published claims it lists as what it is and as what defends against it (a withdrawn one marked), and code's suggestions, published claims it does not list whose statement names one of its terms or its id's words (`threatSuggestions` in `core/src/threatadmin.ts`), each with where it is filed. Links a suggestion as either list, links any other published claim by its id, unlinks one (`threat.link`, `threat.unlink`). Code links nothing by itself. |
| Lessons and focus | The current focus and the standing lessons research reads. |
| Reader suggestions | Every suggestion, including waiting and declined ones; triages it (being researched, answered with the claims that answer it, or declined) and writes the public note. Nothing a reader suggests is public until it is triaged here or by the brain. |
| Reader reports | Every problem readers reported with a claim, with their private notes and what the brain found; dismisses a report as abuse (it stays listed in public as dismissed and research drops it), restores one, or sends one back for another recheck. |
| Security embargo | Reads each finding the disclosure gate held (a failed lab run, or a research claim that may describe an undisclosed weakness) with why it was held and the projects' private reporting addresses; releases it once the project has published, or dismisses it (SECURITY.md, T9). |
| Advisories and NVD | Every advisory the watch read that no rule files under a threat: files it under one or more of the threats (by title, grouped by layer) or says it concerns none. Every NVD finding of the threat map: settles one whose record rightly names another project by recording that project as the one expected for the CVE id (a new project made from NVD's vendor:product pairs, or one the map has), or leaves it open; an id NVD has no record of stays open. Your placements and settled findings, each with Undo. The brain writes `knowledge/security/advisory-map.yaml` and ships it; the public threat pages and `/gaps` follow on the next deploy. |
| Signing | The publisher key and the owner's: shows the exact attestation text and delegation id to sign in your own wallet (any BIP-322 wallet, hardware included), checks the pasted signatures, sends them; revokes the delegation the same way (ORANGECHECK.md). |
| Settings | Pauses everything, turns ticks on or off, pings the brain, deploys; turns "Post to Nostr" on or off and reads, under the switch, exactly the notes that would go out next and what the screen holds back (ORANGECHECK.md, "The Nostr channel"); signs out everywhere. |

Triage of reader suggestions and actions on reader reports change the site's Redis directly and
apply at once; everything
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
- An approval names each claim with the SHA-256 of the pending candidate the owner was shown, and
  a withdrawal the hash of the published claim. If the file changed since, nothing is done and the
  admin says so.
- The daemon also posts the evaluator's view (`ctl:evaluator`) when it changes: its state, the
  calibration and the last 60 decisions with every check's reason. It stays in Redis for the
  admin; readers see only `knowledge/evaluator.json`.
- It posts the Nostr channel's view (`ctl:nostr`) the same way: the channel key, the switch, and
  the next notes exactly as they would be signed, with what the screen holds and why.
- And the weekly review of the loop (`ctl:loop`, `LoopReview` in `core/src/loopreview.ts`): the
  newest `var/loop/reviews/<week>.json`, sent when a review is written. The weekly tick writes the
  week that just ended; `pnpm brain review-loop [--week YYYY-MM-DD] [--write]` prints any week on
  the devbox (and with `--write` saves it for the admin). Every proposal in it must parse as a
  `Command` (`LoopReviewView`), or the sync is refused. It holds private evaluator detail, so it
  stays in Redis for the admin and never reaches the bundle or a public route.
- And the advisory map's view (`ctl:advisories`, `AdvisoryAdminView` in
  `core/src/advisoryadmin.ts`), built from its checkout whenever HEAD or the map changes: the
  advisories to map, the owner's placements, the NVD findings and the owner's expectations. It is
  written before the results of the same sync, so a page that sees its command done finds the map
  that command made.
- And the gate policy's view (`ctl:policy`, `GatePolicyView` in `core/src/gatepolicy.ts`), built
  from its checkout whenever HEAD, the policy, the agenda or the review queue changes: every topic
  on the agenda or published, its flags as `brain/policy/topics.yaml` sets them (or that the file
  does not list it), how many claims on it wait, and the contested terms. It too is written before
  the results of the same sync.
- And the threat map's view (`ctl:threats`, `ThreatAdminView` in `core/src/threatadmin.ts`), built
  from its checkout whenever HEAD or a threat's file changes: every threat with the claims it
  lists, the lists that have no published claim yet, code's suggestions, and every published
  claim's id. It too is written before the results of the same sync.
- Owner text (notes, reasons, focus, lessons, agenda scopes, contested terms) is length-limited and
  refuses control characters; a contested term is also refused when it looks like a secret. It reaches the research model as the owner's words, in a section of its
  own; reader text never does.

| Command | What the daemon does |
| --- | --- |
| `ping` | Answers, to prove the round trip. |
| `settings` | Changes `var/control/settings.json` (schema `Settings`). |
| `review.approve` | Checks each hash, publishes through `brain/src/review.ts` under the tick lock, ships. |
| `review.reject` | Checks each hash, records the rejection, optionally keeps the reason as a lesson, ships. |
| `evaluator.run` | Evaluates one batch of waiting gated claims now (`brain/src/evaljob.ts`), then applies it under the tick lock and ships. |
| `claim.revoke` | Checks the published claim's hash, appends a `withdrawn` revision with the reason, drops it from its topics, ships; the reason becomes a lesson and a canary case. |
| `debate.withdraw` | Checks the map is one the site shows, adds a `withdrawn` record (when, the run, the reason) to its file in `knowledge/debates/`, logs a review run, drops a map waiting under the same slug, ships; its claims stay published, and the reason becomes a lesson. |
| `research.start` | Starts a research session now, on a topic or the gap planner's pick. |
| `research.stop` | Stops the running session (its process group); nothing it staged publishes. |
| `tick` | Runs the hourly, daily or weekly tick now. |
| `ship` | Pushes and deploys now. |
| `agenda.save`, `agenda.remove` | Edits `brain/agenda/seed.yaml` and commits it as the owner. |
| `lesson.add`, `lesson.remove` | Edits the standing lessons. |
| `embargo.decide` | Releases an embargoed finding (a research candidate joins the review queue; a lab run is committed and shipped) or dismisses it. The site refuses one that already left the embargo. |
| `orangecheck.authorize` | Checks the owner's pasted BIP-322 signatures (the attestation binding their key to `dns:blocklore.space`, the delegation of `stamp:sign` to the publisher key), writes `knowledge/orangecheck/`, commits as the owner and ships (ORANGECHECK.md). |
| `orangecheck.revoke` | Checks the owner's signed revocation of that delegation, records it the same way and ships; from its time on the publisher key signs alone. |
| `nostr.post` | Saves the Nostr channel's switch at once, then writes `knowledge/nostr.json` (what NIP-05 and the Follow link read), ships it, and while the switch is on sends the notes that wait. Off sends nothing; the OrangeCheck records publish either way. |
| `advisory.assign`, `advisory.unassign` | Files an advisory (by its first CVE id, else its GHSA id, else its page) under threats, an empty list meaning none, in `knowledge/security/advisory-map.yaml`'s `assign`; or takes that placement out. |
| `advisory.expect`, `advisory.unexpect` | Records the project NVD's record names as the one expected for a CVE id (`expect`), first adding it to `products` with the chosen vendor:product pairs when the map does not have it; or takes the expectation out, with a project made for it that has no words or pages of its own and that no other expectation names. |
| `policy.topic` | Sets a topic's `contested` and `safety` flags in `brain/policy/topics.yaml`, in its own line and place, adding it at the end of `topics:` when the file does not list it; commits as the owner and ships. |
| `policy.term` | Adds a term (1 to 40 characters on one line) at the end of `contested_terms`, or removes one; commits as the owner and ships. |
| `threat.link`, `threat.unlink` | Adds a published claim at the end of a threat's `claims` (what it is) or `mitigations` (what defends against it) in `knowledge/security/threats/<id>.yaml`, or takes one off; commits as the owner and ships. |

The four advisory map commands are checked twice by `advisoryCommandProblem`: by the site against
the map the owner was shown (409 when it no longer fits) and by the job against its checkout. The
job edits the file as a YAML document (`brain/src/security/advisorymap.ts`), so its comments,
order and every line it does not touch stay as they were, formats it as lint does, checks the text
it would write against the map's schema, the threat map, the style rule and the command itself, and
only then writes it, commits it as the owner ("as the owner asked in the admin") and ships. The
site never writes the file.

The two gate policy commands work the same way (`policyCommandProblem`, `brain/src/policy.ts`). The
site refuses (409) a topic that is neither on the agenda nor published, flags the file already
sets, a term already listed (whatever its case) and the removal of one it does not list. The job
edits `brain/policy/topics.yaml` as a document, formats it, and writes it only when the text
parses as the policy, holds exactly what the command asked of the policy before it, and differs
from it only in the lines of the entry the command names. Only the owner changes the gate policy:
loosening it is the owner's decision, and claims already waiting keep waiting for the evaluator.

The two threat map commands work the same way again (`threatCommandProblem`,
`brain/src/security/threatlinks.ts`). The site refuses (409) a threat the map does not have, a
claim that is not published, one the threat already lists there, one it lists in its other list
(a claim sits in one of a threat's lists at most: unlink it first) and the unlinking of one it does
not list. The job edits that one threat's file as a document, formats it, and writes it only when
the text parses as a threat, is exactly the threat before with the command applied, and differs
from it only in the line of the list the command names. A link closes the threat's gap for the gap
map and the research task as soon as the site rebuilds. The page counts only claims not withdrawn,
so a threat whose only claim was withdrawn shows here as a gap, with that claim marked Withdrawn.

## The brain daemon

`pnpm brain daemon`, run by the user unit `blocklore-brain.service` (`Restart=always`). Each
cycle it syncs, applies what came back, and starts work when the schedule says so. Its jobs load
the code on disk afresh, but the daemon keeps the code it started with, so after a sync it exits
when the brain's committed code (`brain/src`, `core/src`, `brain/cli.ts` at HEAD) has changed, no
job or session runs and every result has reached the site; systemd starts it again on the new
code 15 seconds later (`shouldReload` in `brain/src/daemon.ts`). The journal says "the brain's code
changed at HEAD; exiting between jobs". Without this, on 2026-11-24 a field the new evaluator
wrote into the review queue failed every sync of the old daemon until it was restarted by hand.

- **Research modes** (owner's choice): `off` runs only what the owner starts; `daily` runs one
  session at the chosen UTC hour; `continuous` runs sessions back to back with a rest between,
  up to a number a day. Every session runs on the owner's Claude subscription; none starts
  until the devbox has its token, and when the plan's usage limit is reached, research waits for
  the reset.
- **A research session** is the existing pipeline (ARCHITECTURE.md, "Data flow of one claim"):
  the gap planner picks the topic (`brain/src/plan.ts`) unless the owner named one; the research
  role (Claude Code, headless, boxed in, `brain/src/agent.ts`) drafts claims; code checks them;
  the role repairs failures; a verifier model with fresh context tries to falsify them; the
  publisher merges what survives, and the gate holds what needs closer checks. The model phase
  does not hold the tick lock; publishing and shipping do.
- **The evaluator** (EDITORIAL.md, "The evaluator"): when it decides and gated claims are due, a
  session slot goes to it first. It rechecks due claims and applies the rules until
  `evaluator.batchSize` of them pass (scanning at most four times that many), plus canaries; a claim
  code fails is decided then without taking a verifier's place. It runs the verifier twice on the
  research model and the other of opus and sonnet, under the same limits and boxing as research. It
  needs `CLAUDE_CODE_OAUTH_TOKEN`; without it the admin says "waiting for the subscription token"
  and nothing runs. Held claims are tried again after 12 hours. Its private record is
  `var/evaluator/` (decisions, outcomes, canaries, withdrawal cases, batches); its public record is
  `knowledge/evaluator.json`, shown at `/verify/evaluator`. When the devbox has a publisher key,
  every decision, test claims included, is signed with it (ORANGECHECK.md) into
  `var/evaluator/signatures.jsonl`, and after each batch the envelopes alone (a hash of each
  decision, never its words) go to Nostr; the Evaluator page says who signed the last batch.
- **What it learns from**: the gap map (golden questions the store covers only in part or not at
  all, thin depths, failed rechecks), reader suggestions taken up for research, the owner's
  standing lessons (often a rejection's reason), and the owner's current focus. The owner's bench
  (`pnpm brain bench`, retrieval only) measures whether search finds what it learned.
- **Live**: the research role streams its turns (`--output-format stream-json`); the daemon
  forwards a condensed line per tool call and message to the admin.
- **The subscription**: every model session uses `CLAUDE_CODE_OAUTH_TOKEN`, the owner's Claude
  plan. The owner connects it on the Research page: run `claude setup-token` on any computer, paste
  the token, and the site seals it for the devbox, which checks it with a one-turn session, saves it
  to `.env` and uses it at once (SECURITY.md, T6b). The same form replaces it; Disconnect removes it.
  Connecting can also turn research on (continuous, within the daily count). `tools/subscription.sh`
  does the same from a terminal on the devbox. There is no API key path and nothing is
  billed per token; the plan's usage is shared with the owner's other Claude use. The role sees
  only that one secret.
- **The ticks** (hourly, daily, weekly) stay systemd timers; each reads the settings first and
  skips when the owner paused the brain or turned that tick off.

State lives in `var/control/` on the devbox: `settings.json`, `seen.json` (applied command ids),
`results.jsonl`, `jobs.json` (queued work), `live.jsonl` (the current session's events).
