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

1. [ ] Workspace: `core`, `brain`, `web`; biome, TypeScript, vitest; `pnpm lint` includes the
   style check (no dashes) over everything we write.
2. [ ] `core`: zod schemas for claims, topics, proposals, debates, runs; the loader; the compiler to
   one bundle; the gate; canonical hashing and Merkle roots; the revision replayer (as of).
3. [ ] `brain check`: schema, style, locators resolve, quotes found, code and chain checks, with a
   cache so re-runs are cheap; a report a person and a model can both read.
4. [ ] `ChainSource`: the Esplora pair that must agree; Core RPC adapter written against the same
   interface for when Q1 is answered.
5. [ ] Ingest adapters for T1 and T2 feeds: BIPs, Core, bitcoindev, Delving, Optech, Stack Exchange,
   transcripts; cursors; health.
6. [ ] `brain publish`: merge verified candidates, apply the gate, append revisions, refuse history
   rewrites, compile, commit as the owner.
7. [ ] `brain review`: list, show, approve, reject, approve a topic.
8. [ ] Seed ten topics through the full loop: UTXO model; proof of work and difficulty; halvings
   and supply; SegWit; Taproot; Lightning basics; fee market and mempool policy; self-custody
   basics; the BIP process; covenant proposals overview.

## M2: the public knowledge base

9. [ ] Site skeleton on Vercel (project `blocklore`), deploy script that proves the live commit,
   security headers, Overlook counter.
10. [ ] Topic pages with the depth dial and the ladder (concept, BIP, code, review, Optech).
11. [ ] Claim pages: sources with quotes and check marks, checks with reader commands, revisions,
    hash and snapshot.
12. [ ] Research log, corrections log, review queue counts, about, editorial and security pages.
13. [ ] Screenshots at desktop and phone width, light and dark, axe clean.

## M3: what changed, and proposals

14. [ ] The Pulse: every revision as an event with time and height, "since block N", RSS global and
    per topic. Done: `/pulse` with the chain now (two explorers that must agree, read on the server,
    a minute old at most), BIP status moves, recent revisions and the upstream wire
    (`knowledge/wire.json`, written by ingest); Atom and RSS 2.0 of every change. Left: "since block
    N" and per-topic feeds.
15. [ ] Daily digest written by the brain, every sentence citing claims, checked like claims.
16. [ ] Proposal Tracker: one page per proposal, BIP status from the BIPs repo, implementations,
    objections and responses, dated stances (gated), live version-bit signaling. Done: the BIP index
    at a commit with its change history (`pnpm brain bips`), `/proposals` (consensus BIPs by status
    with the claims citing each) and `/bips` (the whole index, filterable). Left: a page per
    proposal, implementations, objections and responses, stances, signaling.

## M4: Ask the Brain

17. [ ] Retrieval over claims (BM25), coverage score, synthesis with validated citations, refusal of
    secrets, daily budget, retrieval-only fallback.
18. [ ] Public research queue: submit, triage, show, pull to the brain; a failed question feeds the
    gap map.
19. [~] Lightning boosts that buy priority, never conclusions (Q3).

## M5: agents, snapshots, safety, debates

20. [ ] `/api/v1` read API with documentation; `/llms.txt`; `/exports/claims.jsonl`.
21. [ ] `/mcp` server with read-only tools: search claims, get claim, get topic, changes since,
    get proposal.
22. [ ] Snapshots: canonical hashes, Merkle root, OpenTimestamps proof, `/verify` instructions and
    a verifier script. [~] signature (Q2).
23. [ ] Safety Desk: threat-model guide and a sourced scam-pattern library (all gated).
24. [ ] Debate Maps: argument graphs with empirical and value nodes.

## M6: payments, time, Nostr

25. [ ] Time machine: any page as of a date or block height.
26. [~] Nostr publishing of digests and snapshots (Q5).
27. [~] L402 tier for heavy automated use (Q3).

## The loop

28. [ ] Timers on the devbox: chain every 2 minutes, ingest hourly, re-verification daily, research
    daily, bench weekly. Budget file and alerts.
29. [ ] Golden question set (200), weekly bench, published scorecard: accuracy, citation validity,
    calibration.
30. [ ] Gap map: thin topics, failed questions, unresolved contradictions; research plans from it.
31. [ ] Weekly self-review of the loop, proposed changes as pull requests.

## Later

- Email digest (Resend, the "Xaxis" team, double opt-in).
- More topics: mining and pools, Stratum v2, ecash, Ark, sidechains, quantum migration, privacy
  tools, history, regulation.
- Translations.
