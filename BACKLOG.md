# Backlog

Prioritized. Each item ends in a check that proves it. Milestones follow the founding brief; the
owner's later instruction (2026-11-20) was to choose the stack and keep building, so work runs
through the milestones without stopping at M0.

Status: `[x]` done and proven, `[ ]` open, `[~]` built but waiting on the owner (the question number
refers to ARCHITECTURE.md).

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

14. [ ] The Pulse: every revision as an event with time and height, "since block N", RSS global and
    per topic. Done: `/pulse` with the chain now (two explorers that must agree, read on the server,
    a minute old at most), BIP status moves, recent revisions and the upstream wire
    (`knowledge/wire.json`, written by ingest); Atom and RSS 2.0 of every change. Left: "since block
    N" and per-topic feeds.
15. [x] Daily digest: `/digest/<date>` compiled from the day's events (corrections first, new claims
    by topic, revisions, BIP index moves, runs), so every line is a published claim. A written
    summary on top would be a later choice, checked like claims.
16. [ ] Proposal Tracker: one page per proposal, BIP status from the BIPs repo, implementations,
    objections and responses, dated stances (gated), live version-bit signaling. Done: the BIP index
    at a commit with its change history (`pnpm brain bips`), `/proposals` (consensus BIPs by status
    with the claims citing each) and `/bips` (the whole index, filterable). Left: a page per
    proposal, implementations, objections and responses, stances, signaling.

## M4: Ask the Brain

17. [x] Ask the Brain: retrieval over claims (BM25 with a glossary of reader words and a
    definition boost, measured on the golden set), synthesis with checked citations
    (`core/src/ask.ts`), refusal of secrets, prices and advice, a daily budget and per-visitor
    limits in Redis, an answer cache, and the claims alone whenever no checked answer can be
    written. `/ask` and `POST /api/v1/ask`. Coverage is the model's verdict (answered, partial,
    not covered), scored against the golden set's labels.
18. [~] Public research queue. Done: an Ask answer that judged a question about Bitcoin and not
    covered carries a signed ticket; `POST /api/v1/queue` takes it, strips links and contacts,
    counts repeats, limits each visitor to 5 a day; `/queue` shows triaged questions only;
    `pnpm brain queue pull|accept|research|answer|decline` over bearer-token endpoints. Left: a
    gap map that ranks queued questions with the agenda (M6), and triage by the brain loop.
19. [~] Lightning boosts that buy priority, never conclusions (Q3).

## M5: agents, snapshots, safety, debates

20. [x] `/api/v1` read API with documentation (API.md, `/about/api`); BM25 search by POST so
    reader text never sits in a logged URL; `/llms.txt` and `/llms-full.txt`;
    `/exports/claims.jsonl`.
21. [x] `/mcp` server with read-only tools: search claims, get claim, list and get topics,
    changes since a height, get and list BIPs. Stateless; serves 2026-07-28 and the
    initialize-era revisions.
22. [x] Snapshots: canonical hashes, Merkle root, OpenTimestamps proof, `/verify` instructions and
    a verifier script (`pnpm verify:snapshot`), audit paths on claim pages. [~] signature (Q2).
23. [ ] Safety Desk: threat-model guide and a sourced scam-pattern library (all gated).
24. [ ] Debate Maps: argument graphs with empirical and value nodes.

## M6: payments, time, Nostr

25. [ ] Time machine: any page as of a date or block height.
26. [~] Nostr publishing of digests and snapshots (Q5).
27. [~] L402 tier for heavy automated use (Q3).

## The loop

28. [x] Timers on the devbox: `pnpm brain tick` and `tools/timers.sh` (systemd user units, one
    lock): ingest, the BIP index, proof upgrades and the queue hourly; `brain recheck` daily (the
    30 stalest claims read again, failures public in `knowledge/rechecks.json`); bench weekly; each
    tick commits, pushes and deploys when the site is behind. Installed and running since
    2026-11-20. Waiting on the owner: the daily research timer is installed off
    (`tools/timers.sh research on`, Q4). Moved on: live signaling with the proposal pages (item 16), budget
    alerts (SECURITY.md).
29. [x] Golden question set (200, `brain/bench/golden.yaml`) and `pnpm brain bench [--ask]`:
    retrieval hit rates and answer scores per kind, published at `/scorecard` and
    `/api/v1/scorecard` from `knowledge/bench.json`. Search is refreshed weekly by the timer;
    answers are scored on demand (paid) and say whether they came from the Ask that runs today.
30. [ ] Gap map: thin topics, failed questions, unresolved contradictions; research plans from it.
31. [ ] Weekly self-review of the loop, proposed changes as pull requests.

## Later

- Email digest (Resend, the "Xaxis" team, double opt-in).
- More topics: mining and pools, Stratum v2, ecash, Ark, sidechains, quantum migration, privacy
  tools, history, regulation.
- Translations.
