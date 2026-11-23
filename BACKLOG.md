# Backlog

Prioritized. Each item ends in a check that proves it. Milestones follow the founding brief; the
owner's later instruction (2026-11-20) was to choose the stack and keep building, so work runs
through the milestones without stopping at M0.

Status: `[x]` done and proven, `[ ]` open, `[~]` built but waiting on the owner (the question number
refers to ARCHITECTURE.md), `[-]` removed by the owner's decision, kept here as history.

## M0: foundations

- [x] ARCHITECTURE.md with assumptions, open questions and risks at the top
- [x] CLAIMS.md, the claim schema
- [x] SOURCES.md, the source registry with tiers, fetch methods and licenses
- [x] EDITORIAL.md, voice, neutrality and style
- [x] SECURITY.md, threat model and privilege split
- [x] This backlog

## M1: the store, ingest, checks, the first ten topics

1. [x] Workspace: `core`, `brain`, `web`; biome, TypeScript, `node:test` (not vitest: Node 24 runs
   the TypeScript directly); `pnpm lint` includes the style check (no dashes) over everything we write.
2. [x] `core`: zod schemas for claims, topics, proposals, debates, runs; the loader; the compiler to
   one bundle; the gate; canonical hashing and Merkle roots; the revision replayer (as of).
3. [x] `brain check`: schema, style, locators resolve, quotes found, code and chain checks, with a
   cache so re-runs are cheap; a report a person and a model can both read.
4. [x] `ChainSource`: the Esplora pair that must agree; Core RPC adapter (`CoreRpc`) written against
   the same interface for when Q1 is answered.
5. [x] Ingest adapters for T1 and T2 feeds: BIPs, Core, bitcoindev, Delving, Optech, Stack Exchange,
   transcripts; cursors; health. Also Core and Knots releases, BOLTs and Inquisition.
6. [x] `brain publish`: merge verified candidates, apply the gate, append revisions, refuse history
   rewrites, compile, commit as the owner.
7. [x] `brain review`: list, show, approve, reject, approve a topic.
8. [x] Seed ten topics through the full loop: UTXO model; proof of work and difficulty; halvings
   and supply; SegWit; Taproot; Lightning basics; fee market and mempool policy; self-custody
   basics; the BIP process; covenant proposals overview. Eight are published; self-custody (safety)
   and covenants (contested) went through the loop and wait whole at the owner's gate.

## M2: the public knowledge base

9. [x] Site skeleton on Vercel (project `blocklore`), deploy script that proves the live commit,
   security headers, Overlook counter.
10. [x] Topic pages with the depth dial and the ladder (concept, BIP, code, review, Optech).
11. [x] Claim pages: sources with quotes and check marks, checks with reader commands, revisions,
    hash and snapshot.
12. [x] Research log, corrections log, review queue counts, about, editorial and security pages.
13. [x] Screenshots at desktop and phone width, light and dark (`tools/shots.ts`), axe clean
    (`pnpm a11y`: 22 pages, every doc among them, 4 views each, no violations on 2026-11-20).

## M3: what changed, and proposals

14. [x] The Pulse: every revision as an event with time and height, "since block N", RSS global and
    per topic. Done: `/pulse` with the chain now (two explorers that must agree, read on the server,
    a minute old at most), BIP status moves, recent revisions and the upstream wire
    (`knowledge/wire.json`, written by ingest); Atom and RSS 2.0 of every change; an Atom feed per
    topic (`/topics/<slug>/changes.xml`, linked from the topic's rail); "since block N" and "on
    topic T" in the API (`/api/v1/changes?since=&topic=`) and MCP (`list_changes`); on the site,
    `/changes/since/<block or date>` lists every change after that moment, from a form on Changes.
15. [x] Daily digest: `/digest/<date>` compiled from the day's events (corrections first, new claims
    by topic, revisions, BIP index moves, runs), so every line is a published claim. A written
    summary on top would be a later choice, checked like claims.
16. [ ] Proposal Tracker: one page per proposal, BIP status from the BIPs repo, implementations,
    objections and responses, dated stances (gated), live version-bit signaling. Done: the BIP index
    at a commit with its change history (`pnpm brain bips`), `/proposals` (consensus BIPs by status
    with the claims citing each) and `/bips` (the whole index, filterable); a page per BIP at
    `/proposals/<n>` for every BIP in the index (`/bips/<n>` redirects there), built by
    `core/src/bipview.ts` from the bundle alone: the entry as the index states it at its commit with
    a link to its text there, its recorded changes, every published claim citing it by topic and
    depth with contested claims, stances and arguments marked, and the code and pull requests those
    claims cite (no claim, no line); the same as `GET /api/v1/bips/<n>` and the MCP tool `get_bip`,
    linked from `/proposals`, `/bips`, Pulse, the digests, every claim's BIP sources and the sitemap.
    Done 2026-11-23: version-bit signaling, from the chain itself. The hourly `watch` step's block
    following reads every block's version in the tip's difficulty period from both explorers, which
    must agree on it as on each hash, time and target (no second reader, timer or commit), at most
    about a minute a run; `core/src/signaling.ts` counts BIP 9's prefix, each bit 0 to 12, BIP
    320's bits 13 to 28 apart (never as signaling) and versions without the prefix, and keeps the
    last period's final tally; `knowledge/chain/signaling.json` goes in the watches' commit.
    `/proposals` shows "Version bits this period" (heights, blocks so far of 2016, the block it is
    as of, a row per deployment bit any block set or "No block set a deployment bit", the BIP 320
    count, the last period beside it), as do BIP 9's and BIP 320's pages; `GET /api/v1/signaling`,
    the MCP tool `signaling` and `pnpm brain signaling` (read-only) give the same. Counts and
    shares only, never a forecast. A deployment's name shows only from Bitcoin Core's mainnet
    `chainparams.cpp` at a pinned commit (v32.1: no deployment on bits 0 to 12, `DEPLOYMENT_TESTDUMMY`
    on bit 28, never active), so a BIP page shows its bit's row once a release defines one.
    Left: re-pinning chainparams when a release adds a deployment (by hand; `pnpm brain signaling`
    says when the newest release is past the pin); objections and responses, and dated stances,
    which wait on gated `argument` and `stance` claims that cite a BIP (the page marks them once
    they publish); proposals that span several BIPs (`knowledge/proposals/`, none written yet);
    owners, which the index names but the store leaves out on purpose (a BIP's text names them).

## M4: Ask the Brain (removed 2026-11-21) and the research queue

17. [-] Ask the Brain: retrieval over claims (BM25 with a glossary of reader words and a
    definition boost, measured on the golden set), synthesis with checked citations
    (`core/src/ask.ts`), refusal of secrets, prices and advice, a daily budget and per-visitor
    limits in Redis, an answer cache, and the claims alone whenever no checked answer can be
    written. `/ask` and `POST /api/v1/ask`. Coverage is the model's verdict (answered, partial,
    not covered), scored against the golden set's labels. Removed by the owner's decision on
    2026-11-21: readers bring their own model through the MCP server (`/connect`), so the site
    runs none. The pipeline in `core/src/ask.ts` stays for the owner's bench (item 29).
18. [~] Public research queue, now reader suggestions. Done: any reader suggests a question in
    the box on `/gaps` (a search with no match hands its words over in `#suggest=`); `POST
    /api/v1/queue` takes `{"q"}`, runs the secret detector, strips links and contacts, counts
    repeats, and takes 5 a day from each visitor and 200 a day for the site; `/gaps` lists
    triaged suggestions only; the owner triages in the admin, the brain with `pnpm brain queue
    pull|accept|research|answer|decline` over bearer-token endpoints. Until 2026-11-21 only an Ask
    answer's signed ticket could queue a question, and `/queue` was its own page; both went with
    Ask. Left: a gap map that ranks suggestions with the agenda (M6), and triage by the brain loop.
19. [-] Lightning boosts that buy priority, never conclusions. Dropped 2026-11-23 (Q3): paying to
    move a question up would let money steer what the record covers.

## M5: agents, snapshots, safety, debates

20. [x] `/api/v1` read API with documentation (API.md, `/about/api`); BM25 search by POST so
    reader text never sits in a logged URL; `/llms.txt` and `/llms-full.txt`;
    `/exports/claims.jsonl`.
21. [x] `/mcp` server with read-only tools: search claims, get claim, list and get topics,
    changes since a height, get and list BIPs. Stateless; serves 2026-07-28 and the
    initialize-era revisions. `/connect` shows readers how to add it to Claude Code, Claude,
    Cursor and VS Code.
22. [x] Snapshots: canonical hashes, Merkle root, OpenTimestamps proof, `/verify` instructions and
    a verifier script (`pnpm verify:snapshot`), audit paths on claim pages. [x] signature with
    OrangeCheck (ORANGECHECK.md, `pnpm verify:orangecheck`, `/verify/keys`).
23. [ ] Safety Desk: threat-model guide and a sourced scam-pattern library (all gated).
24. [~] Debate Maps: argument graphs with empirical and value nodes. Done: the rules a map keeps
    (`core/src/debateview.ts`, CLAIMS.md "Debate maps"): every node a published claim, value
    nodes attributed stances or arguments under a position, empirical nodes facts, mechanisms,
    events or traces, definitional nodes definitions, edges inside the map, every position with
    a value node, a question and labels in a neutral voice naming no one, and a contested topic.
    `brain check` reports on a run's `debates/*.yaml` beside its claims so research can repair
    them; `brain publish` writes a map only when it keeps every rule against the store after the
    commit, keeps one waiting on gated claims in `var/review/debates/` and retries it on every
    commit to the store, and drops one built on an evaluator test claim. The bundle rebuilds each
    map from the published claims, so a withdrawn node drops out and a map that then breaks a
    rule is hidden. `/debates`, `/debates/<slug>` (positions side by side with holders and dates,
    the shared ground, supports and rebuts as lists), a link on each topic it is filed under,
    `GET /api/v1/debates[/{slug}]` and the MCP tool `debates`. Research may write a map in its
    run folder (`brain/prompts/research.md`, "A debate map"; the role's `./debates/**` write
    permission) only when its task says the topic is contested. Left: the evaluator does
    not yet review a map's framing (its question, labels and which side a claim sits on are
    checked only by the rules as code); the owner cannot withdraw a whole map from the admin
    (today a map leaves only when its claims break a rule, or by a commit removing the file);
    and no published topic is contested yet, so no map can publish until one is: covenants is
    the only topic `brain/policy/topics.yaml` marks contested, and it has no published claims
    (a map on data carriers needs the owner to mark a topic for it contested).

## M6: payments, time, Nostr

25. [x] Time machine: a topic or a claim exactly as Blocklore stated it at a block height or a
    UTC date (`/topics/<slug>/at/<moment>`, `/claims/<id>/at/<moment>`, every topic at
    `/topics/at/<moment>`, linked from each sealed edition on `/verify`), with what changed
    since; `?at=` on the claim and topic API, `at` on the MCP tools `get_claim` and `get_topic`.
26. [x] Nostr publishing of digests and snapshots (Q5). Snapshot stamps and the owner's records
    publish (`pnpm brain orangecheck publish`, the hourly tick). The channel people follow
    (ORANGECHECK.md, "The Nostr channel"): its own HKDF sibling key, NIP-05 at
    `/.well-known/nostr.json`, the daily digest as a NIP-23 article and a note per sealed edition,
    behind the owner's "Post to Nostr" switch in the admin (off by default), with the next notes
    previewed under it and two relays for published. The owner turns it on.
27. [-] L402 tier for heavy automated use. Dropped 2026-11-23 (Q3): reading stays free for people
    and programs; heavy users fetch the export.

## The loop

28. [x] Timers on the devbox: `pnpm brain tick` and `tools/timers.sh` (systemd user units, one
    lock): ingest, the BIP index, proof upgrades and the queue hourly; `brain recheck` daily (the
    30 stalest claims read again, failures public in `knowledge/rechecks.json`); bench weekly; each
    tick commits, pushes and deploys when the site is behind. Installed and running since
    2026-11-20. Waiting on the owner: the daily research timer is installed off
    (`tools/timers.sh research on`, Q4). Moved on: live signaling with the proposal pages (item 16), budget
    alerts (SECURITY.md).
29. [x] Golden question set (200, `brain/bench/golden.yaml`) and `pnpm brain bench`:
    retrieval hit rates and answer scores per kind in `knowledge/bench.json`, which feeds the gap
    map. An internal measurement the owner runs: search is refreshed weekly by the timer, answers
    are scored on demand (paid). The public scorecard (`/scorecard`, `/api/v1/scorecard`) was
    removed with Ask on 2026-11-21.
30. [x] Gap map: `core/src/gaps.ts` compiles what the store lacks into the bundle (golden questions
    the store answers only in part or not at all in the bench's last scored run, placed on the
    nearest topic by search; thin depths; failed rechecks; review counts), shown at `/gaps` and
    `/api/v1/gaps`, linked from each topic. The research tick takes the topic with the most open
    gaps and gets them in its task (`brain/src/plan.ts`, `pnpm brain gaps`). Left: reader
    suggestions as gaps once triaged, contradictions between published claims beyond failed
    rechecks, and proposing new agenda topics for questions near none.
31. [x] Weekly self-review of the loop (2026-11-23, after research went three days without a
    session while every slot went to the evaluator and nothing said so). `core/src/loopreview.ts`
    compiles one UTC week, Monday to Monday, from the daemon's sessions, the run logs, the
    evaluator's decisions, rechecks, reader reports, the agenda, the gap map and the review queue:
    the week's counts, and findings, each a fixed code with its numbers and evidence (research gone
    longer than 2 days, and why: paused, no subscription, research off, every topic in review, or
    the evaluator taking the slots; a test claim let through; a gated claim waiting over 3 days;
    failed rechecks; a source's quote failing twice; reader reports open past a week; a rule broken
    by 3 claims; agenda topics no session touched in 14 days). One the owner can act on carries an
    existing admin command as a proposal; a lesson is built from the rule's own description, never
    from a model's words. The weekly tick writes `var/loop/reviews/<week>.json`, the daemon
    carries the latest to the admin's Weekly review (`/admin/loop`), whose buttons send only when
    pressed, and `pnpm brain review-loop` prints any week. Left: proposed changes to the role
    prompts as owner-reviewed pull requests, which this does not do; findings on research quality
    beyond counts (claims the verifier keeps sending back for the same reason).
32. [x] The brain daemon (ADMIN.md): `pnpm brain daemon` under `blocklore-brain.service` syncs with
    the site every 20 seconds (3 while the admin is open), applies the owner's signed commands
    (approve and reject bound to content hashes, settings, lessons, agenda edits, ticks, ship,
    start and stop a research session), and schedules research sessions as the owner set them:
    off, daily at an hour, or continuous with rest, a daily cap and the budget. The research role
    streams its turns to the admin; the owner's lessons and focus reach its task. Since
    2026-11-21 every session runs on the owner's Claude subscription, never an API key, and the
    plan's usage limit pauses research until it resets.
33. [x] The admin (ADMIN.md): `/admin`, signed in by a one-time mailed link (or `pnpm brain
    admin-link`), with the review queue, research control and its live feed, runs and spend, the
    agenda, lessons and focus, triage of reader suggestions, and settings. Ask's switch and
    budget went with Ask on 2026-11-21.
34. [x] One app, not pages (the owner's decision, 2026-11-21). A persistent 3D scene of the store
    (`web/components/scene/`) beside a docked panel that every view renders into; six views in
    the bar (Explore, Changes, Proposals, Proof, Method, Connect; `web/lib/nav.ts`), with every
    URL still working on its own and `/topics` redirecting to `/`. No model for readers: `/ask`,
    `/scorecard` and `/queue` are gone, `/connect` shows how to bring your own over MCP, and
    suggestions live on `/gaps`. Proves it: every view at desktop and phone width, light and
    dark, axe clean, and no fact shown only in the scene.

## The security watch

35. [x] Threat map, watches, disclosure gate, lab, `/security` (ARCHITECTURE.md, SECURITY.md T9):
    40 threats over eight layers in `knowledge/security/threats/`; seven watches on the hourly tick
    (pools, block gaps, timestamps, difficulty, reorgs, advisories, node versions) with documented
    thresholds; the weekly lab running Bitcoin Core's own functional tests for known vulnerability
    classes in regtest against the verified release; the embargo with the owner's admin page;
    thin threats as research gaps; watch and lab feed events; MCP tools `threats` and `watches`.
36. [x] Advisories on their threats (`core/src/advisories.ts`, `brain/src/security/advisorylog.ts`):
    every advisory the watch has read is kept in `knowledge/security/advisories.json` and filed by
    code under six explicit rules, strongest first (the owner's placement, its page in the
    threat's record, a CVE or GHSA id the threat lists, every advisory of a project, a threat
    term in its title, the owner's words for the threat in its title), with the owner's
    `knowledge/security/advisory-map.yaml` holding the words, projects, placements and vetoes.
    `/security/<threat>` lists its own advisories, each saying which rule filed it and quoting the
    words of a match by words; `/security` shows each advisory's threats; one nothing files is
    listed on `/gaps` and in `GET /api/v1/gaps` for the owner to map, never for research; the
    MCP tool `threats` carries them. `pnpm brain advisories` prints the matching. Proves it: on
    2026-11-23, 34 advisories read, 23 filed under 6 threats, 11 to map; a test for each rule.
37. [ ] The gate policy from the admin. The control exists (2026-11-23): the admin's Gate policy
    page (`/admin/policy`, `core/src/gatepolicy.ts`, `brain/src/policy.ts`) shows every topic on
    the agenda or published with its flags as `brain/policy/topics.yaml` sets them and how many
    of its claims wait, and the owner sets a topic's contested and safety flags and adds or
    removes contested terms there; the brain's job edits the file keeping every other line,
    commits it as the owner's and ships it. Open, the owner's alone: setting the 8 agenda topics
    the file does not list (`consensus-security`, `p2p-network`, `cryptography`,
    `software-supply-chain`, `transactions`, `script`, `wallet-standards`,
    `bitcoin-core-development`; until then every claim on them waits for the evaluator), and a
    `security` group in the topic groups.
38. [x] The record against NVD (`brain/src/security/nvd.ts`, `checkCve` in
    `core/src/advisories.ts`): every CVE id a threat's record or terms name, and every
    advisory's, is looked up in NVD's public CVE API 2.0 (no key, 6.5 seconds apart, each record
    asked again only when it may have changed, 8 a run on the advisories watch). Each threat's
    page shows "Checked against NVD": whether each id exists, what NVD says it affects, since
    when, and a finding for the owner when NVD has no record, rejected it, or names another
    product than its advisory or cited page implies; the record is never changed to match.
    Proves it: on 2026-11-23, 21 CVE ids checked, 17 found, 8 mismatched (four replacement
    cycling ids NVD has no record of; OpenSSL, Trezor firmware, Libbitcoin Explorer and xz named
    where no Bitcoin project was expected), and 4 of the advisories' 32 ids not in NVD yet.
39. [x] Watch and lab alerts as Nostr notes (item 26): a note when a watch changes state and when
    a lab run passes. A failing run, and anything the embargo or the disclosure gate holds, never
    goes out (`noteScreen` in `core/src/nostr.ts`).
40. [ ] More lab coverage. Done: the lab on every maintained Core major (`maintainedReleases`,
    `MAINTAINED_MAJORS` = 3 per https://bitcoincore.org/en/lifecycle/): the newest point release
    of each, one after another under `heavy`, each with its own test list and its own pass
    through the disclosure gate, one run per release in `lab.json` (up to 12 of each major);
    `/security` shows each release's run newest first, a threat's page each test by release, and
    the MCP tools `watches` and `threats` carry the same. Releases before 32.0 write their
    `config.ini.in` components as `@X_TRUE@` prefixes, which `configIni` now fills, and the tests'
    ports start where nothing on the machine listens (`portBase`), since another project's server
    on 11600 failed a test and held a false finding. Proves it: on 2026-11-23, 31.3 (11 of 40
    builder signatures good, 47 of 47 passed, tests 285 s, whole run 416 s) and 30.5 (13 of 40, 45
    of 45, 294 s, 304 s) beside 32.1's run of 2026-11-22. Done: libsecp256k1's own `tests`,
    `noverify_tests` and `exhaustive_tests`, built with gcc from the copy each release ships, with
    the defines and modules read from that release's own CMake files (`secpBuild` in
    `brain/src/security/secp256k1.ts`), run in their default settings, recorded as
    `secp256k1/<program>` in the release's run and embargoed like any failing test; mapped to
    `signature-library` and, for the deterministic nonce tests, `nonce-reuse`. Proves it: on
    2026-11-23, 32.1 (libsecp256k1 0.8.1) 50 of 50, 31.3 (0.7.2) 50 of 50 and 30.5 (0.7.1) 48 of
    48, each program passing on each; 104 to 151 s of build and test time added per release.
    Left: LND, Core Lightning, Eclair and LDK test suites against their releases.
41. [ ] The node-versions watch from the owner's own node's peers once the owner provides one, so
    it no longer depends on one crawler.

## Later

- Email digest (Resend, the "Xaxis" team, double opt-in).
- More topics: mining and pools, Stratum v2, ecash, Ark, sidechains, quantum migration, privacy
  tools, history, regulation.
- Translations.
