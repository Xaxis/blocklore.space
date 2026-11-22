# Security

A reader sees every known way Bitcoin can be attacked, by layer, with its live status, the published claims that explain and defend against each, the watches' readings, the lab's latest run and the newest advisories; an assistant reads the same through the `threats` and `watches` MCP tools.

<!-- covers: page:/security, page:/security/[threat], cli:brain watch, cli:brain lab, cli:brain embargo -->

## Sub-features

- data: `bundle.security` (a `SecurityView` compiled by `core/src/security.ts` from `knowledge/security/threats/`, `watches.json` and `lab.json`), read through `web/lib/security.ts` (server-only: `security`, `allThreats`, `getThreat`, `watchById`, `claimsOf`, `securityScene`). The pure queries the MCP tools use are in `core/src/threatmap.ts` (`@blocklore/core/threatmap`).
- map (`/security`, `web/app/security/page.tsx`): the plain lede, counts in the header meta, a strip with one segment per threat in map order, the three statuses each with a one-line meaning, then every layer in `LAYERS` order with its counts and its threats. A threat row: status chip (a shape per status, so it reads without color: square defended, half watching, ring open), title linking to `/security/<id>`, published claim count (left out at zero), "being researched" when claims or mitigations are missing, watch count, lab tests (passing of total, or "not run yet"), "raised by a watch".
- watches: one line per watch (title, a line of context from its data, value in its unit, a sparkline of its history, status chip); opening one shows what it measures, its documented thresholds (`WATCHES` in `core/src/watch.ts`), its source and when it was read. Empty state when `watches.json` has no readings.
- lab: the newest published run (version, SHA256SUMS match, good builder signatures of signers, when, how long, jobs, machine, passed of total), or "The lab has not published a run yet".
- advisories: the 8 newest items of the advisories watch (title linked, source, date, severity when known).
- report: the rail lists each project's private security contact and policy from `DISCLOSURE` (`core/src/disclosure.ts`).
- threat (`/security/<id>`, `web/app/security/[threat]/page.tsx`): statically generated for every threat, `dynamicParams = false` (an unknown id is 404). Crumbs to the map and the layer, status chip and meaning, which watch raised it when `raisedBy` is set; "What it is" and "What defends against it" as `ClaimLine`s linking `/claims/<id>` (only published claims), each saying "Being researched" and that it is on the brain's research list when it has no published claim (`missing`); its watches with value, context, a wider sparkline, measures, thresholds, source and last read; its lab tests with Passed, Failed or Not run yet and the version and date; its public record (`history` refs linked, host and date); the rail links its topic and its layer.
- scene: `securityScene()` in `web/lib/security.ts` gives `SceneData["security"]` (layers, threats with live status) for the scene's security layer.
- mcp: `threats` (`id`, `layer`, `status`, all optional) and `watches` (`id` optional) in `web/lib/mcp.ts`; see mcp.md for the driver.

## How to reach it

- `/security`; a threat at `/security/<id>`, e.g. http://localhost:3721/security/time-warp.
- The Security mode in the app's bar (`web/lib/nav.ts`).
- MCP: `node .claude/skills/verify/mcpcheck.ts http://localhost:3721` calls both tools.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/security.test.ts for the view and live status; core/test/threatmap.test.ts for the threat and watch queries, also through `handleMcp`, including a secret refused in an argument).

Runtime:

```sh
B=http://localhost:3721
for p in /security /security/time-warp /security/no-such-threat; do curl -s -o /dev/null -w "%{http_code} $p\n" $B$p; done
curl -s $B/security | sed 's/<!-- -->//g' | grep -oE 'The threat map|[0-9]+ threats|Consensus and validation|People and social engineering|Mining pool concentration|Nodes on unmaintained versions|The lab has not published a run yet|Lab: Bitcoin Core [0-9.]+|security@bitcoincore.org' | sort -u
curl -s $B/security/time-warp | sed 's/<!-- -->//g' | grep -oE 'What it is|What defends against it|What Blocklore watches|What the lab tests|Public record|href="/claims/[a-z0-9.-]+"' | sort -u
node -e 'const s=require("./web/.generated/bundle.json").security;const t=s.layers.flatMap(l=>l.threats);console.log(t.length, t.find(x=>x.id==="time-warp").published)'
```

Proves it when: 200, 200, 404; the map names the threat count the bundle prints (40 on 2026-11-22), the first and last layer, two watch titles, the lab line (empty state or a version) and the Bitcoin Core contact; the threat page has its five sections and one `/claims/` link per published claim and mitigation the bundle lists (6 for time-warp on 2026-11-21).

Screenshots, light and dark at desktop and phone width:

```sh
~/.claude/claude-core/bin/heavy node tools/shots.ts <outdir> http://localhost:3721 /security /security/time-warp
```

Look at them: status chips read without color (their shapes and words), the watch rows keep one line each at desktop and fold value over chip on a phone with no horizontal scroll, sparklines sit beside the value, and an opened watch shows thresholds.

## The brain's side: watches, lab, embargo

- watches (`pnpm brain watch`, `brain/src/security/watches.ts`; readings and thresholds in `core/src/watch.ts`): each due watch (or all with `--force`, one with `--only <id>`) reads public data through `brain/src/http.ts`, stamps a reading into `knowledge/security/watches.json` (status ok, elevated, alert or unknown; a short history) and logs a `watch` event per status change to the public feed log `var/control/feed.jsonl` (through `logEvent` in `brain/src/security/events.ts`; the daemon sends it to the site, the front page shows it as "Watching"). Blocks come from mempool.space and blockstream.info, which must agree on every id, time and target; `var/security/blocks.json` follows the last 160 blocks for reorgs. The hourly tick runs `watch({ force: false, commit: true })`.
- lab (`pnpm brain lab`, `brain/src/security/lab.ts`): the newest Core release, `SHA256SUMS` and builder signatures checked, the release's functional tests mapped to threats run in regtest against its binaries (`-j` modest), under `heavy`. A passing run is prepended to `knowledge/security/lab.json`; any failure or a release that did not verify is embargoed and nothing public changes. The weekly tick runs `lab({ publish: true, commit: true })`.
- embargo (`pnpm brain embargo`, `brain/src/security/embargo.ts`, `cli.ts`): `var/embargo/<id>.json` (mode 600); `list`, `show`, `release`, `dismiss` (by hand; the owner's way is the admin, admin.md).
- disclosure gate (`core/src/disclosure.ts`, used by `brain/src/publish.ts` through `brain/src/security/gate.ts`): see SECURITY.md, T9.

## How to check the brain's side

Static: `pnpm test` (core/test/disclosure.test.ts: the embargo holds for unpatched wording, unknown CVEs and unnamed findings, passes with an advisory or a known threat, accepts only advisory and CVE sources, holds a failed lab run; core/test/watch.test.ts: every threshold boundary; core/test/security.test.ts: the threat map validates, a chain watch raises a threat and context watches never do, a thin threat becomes a gap; brain/test/security.test.ts: the public run log keeps no trace of a held finding, the embargo store, the event log takes only public watch and lab events; brain/test/lab.test.ts).

Every published claim must pass the gate (a held one would mean the gate is too broad):

```sh
node --input-type=module -e '
const {loadStore}=await import("./core/src/node/index.ts");
const {embargoReasons}=await import("./core/src/disclosure.ts");
const {disclosureContext}=await import("./brain/src/security/gate.ts");
const {store}=loadStore();const ctx=disclosureContext(store);
console.log(store.claims.filter(c=>embargoReasons(c,ctx).length).map(c=>c.id));'
```

Proves it when it prints `[]`.

Watches, for real (free, about a minute, public APIs only; writes the worktree's `knowledge/security/watches.json`, so restore it if you do not mean to commit it):

```sh
pnpm brain watch --force
node -e 'for (const w of require("./knowledge/security/watches.json").watches) console.log(w.id, w.status, w.value, w.history.length, w.error ?? "")'
```

Proves it when all seven ids print with a status other than `unknown` and no error (advisories needs `pnpm brain ingest --only core-advisories` first, or it reads an empty inbox).

### The disclosure gate end to end

Stage a fixture run under a scratch root (never the devbox's staging) whose candidate says "A flaw in Bitcoin Core 32.1 lets a remote peer stall block relay to a node ... and it remains unpatched in every release", with an `accept` verdict, a `run.yaml` whose summary and open questions mention the flaw and whose `skipped` holds one statement that reads as a finding and one that does not, then:

```sh
BLOCKLORE_AGENT_ROOT=$SCRATCH/e2e BLOCKLORE_EMBARGO_DIR=$SCRATCH/e2e/embargo node brain/cli.ts publish <run id> --no-commit
cat knowledge/runs/2026/<run id>.yaml; ls $SCRATCH/e2e/embargo
```

Proves it when the publisher prints "is embargoed for the owner", the run log's summary is "The notes of this run are withheld while the owner reviews part of it." with `read`, `open` and `injections` empty and only the harmless skipped statement in `rejected`, `git status knowledge/claims` is clean, and one `<id>.json` sits in the embargo dir. Remove the run log and restore `knowledge/review-queue.json` afterwards.

The lab, for real: `pnpm brain lab --jobs 3` (network for bitcoincore.org and git; the tests run under `heavy` on their own; downloads that still match are reused; about 140 MB under `var/security/lab/` per release). It prints "lab: SHA256SUMS matched; N good builder signatures", "lab: N of N passed in S s", then "published to knowledge/security/lab.json" or "embargoed for the owner (<id>)". After a pass: `node -e 'const r=require("./knowledge/security/lab.json").runs[0];console.log(r.version,r.verified,r.tests.filter(t=>t.ok).length+"/"+r.tests.length)'`, `node core/cli.ts validate` (0 errors), `pnpm brain embargo list` ("nothing is embargoed") and the newest `"kind":"lab"` line in `var/control/feed.jsonl`. After a failure: `lab.json` unchanged, no new lab event, and `pnpm brain embargo show <id>` gives the reasons, the reporting address and the private log tail. Only the owner releases or dismisses a held run on the devbox. Gate only: `cd brain && node --test test/lab.test.ts`.

## Gotchas

- The page is static: new watch readings or a lab run show after `pnpm bundle` and a deploy. The brain's hourly tick writes `knowledge/security/watches.json`; the weekly lab writes `lab.json` only for runs that passed or that the owner released from the embargo, so a failed run never appears here.
- Every sentence about a threat itself is a published claim. A threat whose claims are not yet published says "Being researched" in that section, never draft text.
- `page:/admin/security` (the owner's embargo queue) is covered by admin.md, not here.
