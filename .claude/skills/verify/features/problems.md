# Reader reports

A reader reports a problem with a published claim ("Report a problem" on its page, or `POST /api/v1/claims/<id>/reports`); the hourly tick rechecks the claim first and the outcome shows on the claim's page, under Corrections and in the API. Notes go to the brain and the owner only.

<!-- covers: api:GET /api/v1/claims/[id]/reports, api:POST /api/v1/claims/[id]/reports, api:OPTIONS /api/v1/claims/[id]/reports, api:GET /api/v1/reports, api:GET /api/v1/reports/pull, api:POST /api/v1/reports/status, api:POST /api/admin/reports, page:/admin/reports, cli:brain reports, cli:reportcheck -->

## Sub-features

- core (`core/src/report.ts`): `REPORT_KINDS` (wrong, outdated, unsupported, broken-link, unclear) and labels; `REPORT_STATUSES` (received, holds, failed, researching, researched, dismissed) and labels; `ReportItem` (stored: one per claim, kind and claim hash; `count`, `at`, `last`, `outcome`, `notes` at most 10 of 500 characters); `publicReport` (the public view, field by field, no notes); `readReport` (the detector over every string in the body first, then the strict `{kind, note?}` shape, then `cleanNote`: control and format characters, links, domains, Nostr keys and handles out); `intakeReport` (published claim, site cap 200, visitor cap 5, a repeat counts and goes back to the brain's next pull); `ReportUpdate` and `reportUpdateProblem` (the brain's outcome: no dashes, no secrets except a 64-hex hash in a failed check, problems only on failed, a dismissed report stays dismissed); `ReportOwnerAction` (dismiss, reopen); `reportOutcomeText` (one sentence per status for every surface).
- the store (`web/lib/reports.ts`): Redis keys `report:item:<id>`, `report:ids`, `report:claim:<claim>`, `report:new` (what the next pull returns) and the shared daily counter `report:v:<visitor>:<day>` (`countDay` in `web/lib/kv.ts`, the queue's `queue:v:` beside it); `next dev` without KV keeps them on globalThis. `fileReport` takes only claims in the bundle (withdrawn ones are 404).
- routes: `GET /api/v1/claims/<id>/reports` (`{edition, claim, reports}`; 404 for an unknown id; `public, max-age=30`), `POST` the same path (`{added, report}`; body at most 2000), `OPTIONS` (CORS), `GET /api/v1/reports` (`{edition, counts, reports}` with each claim's statement; `max-age=60`), `GET /api/v1/reports/pull[?all=1]` and `POST /api/v1/reports/status` (bearer `QUEUE_PULL_TOKEN`; 409 for a dismissed report), `POST /api/admin/reports` (owner session and same origin; `{id, action}`).
- the claim page (`web/components/Report.tsx`, `ClaimReports`, the last block of the rail, `#reports`): the record ("No reader has reported a problem with this claim." or one line per report: status, kind, how often, when, the outcome and its run), a quiet "Report a problem" button (not on withdrawn claims) that opens a kind select, an optional note and "Send report"; the answer is a `role="status"` or `role="alert"` callout. When the record cannot be read (a mirror with no report store, or the store down) the block says "The reports on this claim are not available right now." and offers no form, never that there are none ([mirror](mirror.md)).
- corrections (`web/app/changes/corrections/page.tsx`, `ReportLog`): a "Reader reports" block under the corrections, every report newest first with its claim, date, block and outcome.
- admin (`/admin/reports`, `web/components/admin/Reports.tsx`, "Reader reports" in the nav): every report with its private notes, filtered by status; "Dismiss as abuse", "Restore and recheck" on a dismissed one, "Recheck again" on a decided one.
- brain (`brain/src/reports.ts`, `pnpm brain reports`): `pull [--all]` into `var/reports/items.json`; `list` (and the research targets); `run [--limit 10] [--no-commit] [--push]`, the hourly tick's `reports` step: sends what waits in `var/reports/outbox.json`, pulls, rechecks every reported claim waiting for one (`recheckRun` with `first` and `only`, `capCacheAge(0)`, run `<day>-reverify-reports`), and sends each outcome (`afterRecheck`: a failure is `failed` with the problems and joins `knowledge/rechecks.json`; a pass is `holds`, or `researching` for wrong and outdated). `planResearch` takes the agenda topic with the most such targets before any gap; `reportSection` puts them in the task with notes in escaped `<reader-note>` elements, a note that reads as instructions to a model left out; after the session `markResearched` sends `researched` with `changed` (after a publish, or after two sessions that published nothing; a claim with a revision waiting for review stays a target).

## How to reach it

- http://localhost:3721/claims/halvings-and-supply.first-halving#reports; http://localhost:3721/changes/corrections#reports; `/admin/reports`.
- The dev server needs `QUEUE_PULL_TOKEN` for the brain routes and `CONTROL_KEY` for the admin link: put throwaway values in `web/.env.development.local` (mode 600, gitignored), never the devbox's: `node -e 'const r=()=>require("crypto").randomBytes(32).toString("hex");require("fs").writeFileSync("web/.env.development.local",`OWNER_EMAIL=owner@example.test\nCONTROL_KEY=${r()}\nBRAIN_SYNC_TOKEN=${r()}\nQUEUE_PULL_TOKEN=${r()}\n`,{mode:0o600})'`. The brain then reads them from that file (reportcheck.ts does), with `BLOCKLORE_SITE` pointing at the dev site.

## How to check it

Static: `pnpm test` (core/test/report.test.ts: a seed refused without echo, kept and counted nowhere, a secret in an unknown field, the shape, note stripping, repeats counting with notes collected, the visitor and site caps and their rollover, 404 for an unknown claim, notes never in the public view, the brain's update rules, house style of every outcome and the public order; brain/test/reports.test.ts: reported claims rechecked first, the outcome decision, research targets, notes escaped and labeled, a note aimed at a model left out, and reported claims researched before any gap).

Free, against a dev server without KV (a fresh `X-Forwarded-For` per run):

```sh
B=http://localhost:3721/api/v1/claims/halvings-and-supply.first-halving/reports
V="X-Forwarded-For: 10.7.$((RANDOM % 250)).$((RANDOM % 250))"
post() { curl -s -X POST $B -H 'Content-Type: application/json' -H "$V" --data "$1" -w ' [%{http_code}]\n'; }
post '{"kind":"wrong","note":"abandon ability able about above absent absorb abstract absurd abuse access accident"}'  # 400, names a seed phrase, no "abandon"
post '{"kind":"wrong","email":"x"}'                                    # 400, the usage line
post '{"kind":"outdated","note":"PRIVATE see https://example.com"}'    # added true, status received
post '{"kind":"outdated"}'                                             # added false, count 2
curl -s $B | grep -c PRIVATE; curl -s localhost:3721/api/v1/reports | grep -c PRIVATE   # 0 and 0
for k in unclear broken-link unsupported; do post "{\"kind\":\"$k\"}"; done; post '{"kind":"wrong"}'   # 200 x3, then 429
curl -s localhost:3721/api/v1/reports/pull -w ' [%{http_code}]\n'      # 401
```

End to end in a browser, with the dev server above: `heavy node .claude/skills/verify/reportcheck.ts $SCRATCH/reports http://localhost:3721`. It prints one line per check: the claim page shows its reports, a seed phrase in the note is refused and not repeated, the report is taken and waits, the note is not on the page, the brain pulled and rechecked (`brain reports run --no-commit`, real sources), the outcome on the claim page and in the corrections view without the note, the admin shows the note, the owner dismissed it, the public record says dismissed, the brain's next pull sees it. It writes 20 screenshots (the claim's reports before and after, corrections, the admin; desk and phone, light and dark). Proves it when every line says `ok` and it exits 0. Then restore the store: `git checkout -- knowledge/claims knowledge/rechecks.json` and remove the new `knowledge/runs/<year>/<day>-reverify-reports*.yaml`.

Production: the refusals only (a seed, a stray field, `pull` 401) against https://blocklore.vercel.app. Do not file test reports in production.

## Gotchas

- Claim pages are built ahead of time, so the record is fetched in the browser; `curl /claims/<id>` shows the "Reader reports" heading and "Reading the record." but never a report.
- `GET` answers are cached at the edge (30 s per claim, 60 s for all), so an outcome can show up to a minute late in production.
- A report counts toward the caps only once it passes the content checks; a repeat counts. The caps are counted apart from suggestions.
- A report is about one version of a claim: after a revision (new hash) the same kind opens a new report, and the old one keeps its outcome.
- The hourly step commits the recheck on `main` like the daily one, and a claim whose `last_verified` changed deploys at once (tick.ts `URGENT`).
