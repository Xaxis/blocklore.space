# Blocklore architecture

Blocklore is the current, cited, verifiable state of Bitcoin knowledge: what is true, what is
contested, what changed, and how to check it yourself. A long-running research process on the
owner's devbox (the brain) reads sources, writes claims, tries to falsify them and publishes what
survives. The public site at blocklore.space is the window into it.

This document is the map. The claim format is in [CLAIMS.md](CLAIMS.md), the sources in
[SOURCES.md](SOURCES.md), the voice and neutrality rules in [EDITORIAL.md](EDITORIAL.md), the threat
model in [SECURITY.md](SECURITY.md) and the order of work in [BACKLOG.md](BACKLOG.md).

## Assumptions

1. The owner asked Blocklore's founding session to choose the stack (2026-11-20), overriding the
   brief's "wait for the stack". The choice follows the owner's other projects so one person can run
   all of them: a pnpm workspace, TypeScript on Node 24, Next.js on Vercel (team `xaxis-projects`),
   Upstash Redis for the little runtime state there is, biome for lint and format.
2. The knowledge itself lives in git, in this public repository, as YAML a person can read and
   diff. Git is the audit trail; the site is a build of it.
3. The brain runs on the owner's devbox: deterministic ingest and checks on timers, and Claude Code
   in headless mode for the research and verifier roles, each with its own permission profile.
4. There is no Bitcoin node yet. Until the owner provides one, chain checks ask two independent
   Esplora explorers (mempool.space and blockstream.info) and pass only when both agree. Every check
   records which backend answered.
5. Readers are anonymous. Nothing on the site needs an account. The owner works on the devbox.

## Open questions for the owner

| # | Question | Default until answered |
|---|---|---|
| Q1 | Node access: an RPC URL and a read-only credential for Bitcoin Core (and an Electrum or Esplora index if there is one). | Two public explorers that must agree. |
| Q2 | Who signs snapshots? OC Stamp (BIP-322 over the snapshot id, OTS anchored) fits exactly; the spec is in `~/Projects/ochk/oc-stamp-protocol`. Should Blocklore get its own address, or sign with yours? | OpenTimestamps only, no signature. |
| Q3 | Lightning backend for L402 and question boosts (a BTCPay store, LND, an Alby Hub, other). | Boosts and L402 off; interface only. |
| Q4 | Budget: a daily ceiling for brain research runs and for Ask the Brain. | Research 10 runs a day; Ask 2 USD a day, then retrieval-only answers. |
| Q5 | Nostr identity for publishing digests and snapshots, and which relays. | Built, not switched on. |
| Q6 | License for Blocklore's own text (CC BY-SA 4.0 would match Stack Exchange and keep quotes simple) and code (MIT). | Not chosen; no LICENSE file. |
| Q7 | The owner's own opinions: where and how they appear, labeled as the owner's. | Nowhere yet. |

## Risks

| Risk | What we do about it |
|---|---|
| Invented or mis-attributed citations, the Grokipedia failure | Every source carries a short exact quote. Deterministic code fetches the locator and finds the quote before anything publishes; a separate verifier with fresh context then judges whether the quote supports the statement. A locator that stops resolving is a bug with an alert. |
| Prompt injection from fetched pages | All fetched text is data. The research role has no secrets, cannot publish and cannot edit its own instructions. Hidden text is stripped before a model sees a page. Suspected injections are logged publicly. |
| Looking partisan on contested questions | Contested topics, stances and named people pass the human gate. Positions are steelmanned in proponents' own words, with links. The brain's voice never picks a side on value questions. |
| Link rot | Code and BIPs are cited at a commit hash. Mailing-list posts by message id. Each published locator is re-fetched on a schedule and a Wayback snapshot is requested for non-git URLs. |
| Explorer or node dishonesty | Two independent explorers must agree today; a node the owner runs replaces them. Checks are reproducible commands anyone can run against their own node. |
| Runaway model spend | Per-run turn limits, a daily run ceiling, a daily Ask budget in Redis, alerts to the owner, retrieval-only answers once a budget is spent. |
| Safety advice that hurts someone | Safety Desk content always passes the human gate. The site never asks for or accepts seeds, keys, xpubs or identifying addresses; input that looks like one is refused before it is stored or sent anywhere. |
| The human gate becomes a bottleneck | Review is one command per claim or per topic, and the site shows how many claims wait, so the queue is visible. The owner loosens the gate rules over time. |
| Feed endpoints change | Each adapter has a health check; an adapter that fails three runs in a row raises an alert and the gap shows on the research log. |

## Components

```
                      devbox (the brain)                                     public
 ┌──────────────────────────────────────────────────────────────┐   ┌──────────────────────────┐
 │ ingest (hourly, no LLM)  ─▶ var/inbox/*.jsonl                 │   │ blocklore.space (Vercel) │
 │ chain  (per block, no LLM) ─▶ checks, signaling ─▶ site API ──┼──▶│  pages from the bundle   │
 │                                                              │   │  /api/v1, /mcp, RSS      │
 │ research role (claude -p) ─▶ <staging>/<run>/*.yaml           │   │  Ask the Brain, queue ◀──┼── readers
 │        reads inbox, queue, gap map; no secrets, no publish   │   │  Redis: queue, budgets   │
 │ checks (deterministic): schema, locators, quotes, code, chain│   └────────────▲─────────────┘
 │ verifier role (claude -p, fresh context) ─▶ verdicts          │                │ deploy
 │ publisher (deterministic) ─▶ knowledge/ + gate ─▶ var/review  │   git push ────┘
 │ snapshot ─▶ hash, Merkle root, OpenTimestamps, signature      │
 │ owner: pnpm review (approve, reject)                          │
 └──────────────────────────────────────────────────────────────┘
```

### The knowledge store (`knowledge/`)

YAML files, one entity per file, validated by zod schemas in `core/`:

- `claims/<topic>/<id>.yaml`: the atomic unit. A statement, sources with exact locators and quotes,
  machine checks, depth, kind, status, confidence, first seen, last verified (time and block
  height), the run that produced it and an append-only revision log. See CLAIMS.md.
- `topics/<slug>.yaml`: a page. Sections, each with a depth level and an ordered list of claim ids.
  A topic holds no prose of its own beyond titles; every sentence a reader sees is a claim.
- `proposals/<slug>.yaml`: a consensus or policy proposal: BIPs, deployment parameters,
  implementations, and the claims that describe it, object to it and record stances on it.
- `debates/<slug>.yaml`: an argument graph over claims. Nodes are claims; edges support or rebut;
  each disagreement is marked empirical or about values.
- `runs/<date>/<run>.yaml`: the research log. What was read, what was proposed, what was rejected
  and why, what is still open.
- `snapshots/<n>.json` and `<n>.json.ots`: published states, hashed and timestamped on Bitcoin. A
  snapshot file is never rewritten; only its proof grows when a calendar completes it.
- `bips.json`: the BIP index at a commit (owners left out) and every change to it since.
- `wire.json`: the newest items the feeds saw upstream, titles and links only. Not claims.

The daily digest is not stored: `core/src/digest.ts` compiles each UTC day from the store's own
events at build time, so every line is a published claim and there is no second text to check.

Claims waiting for the human gate are not in the public repository. They live in `var/review/` on
the devbox; the site shows only how many wait, per topic.

### `core/` (pure TypeScript, no I/O in the model)

Schemas, the compiler that turns the store into one bundle (claims, topics, proposals, debates,
changes, search index), the review gate rules, canonical serialization and hashing (per-claim hash,
Merkle root per snapshot), the "as of" reconstruction from revision logs, BM25 retrieval, the style
check (no em dashes) and the secret detector. Node-only loading sits in `core/src/node/`. Nothing in
core reads the clock or randomness; time comes in as an argument.

### `brain/` (the devbox processes)

| Process | Cadence | LLM | Writes |
|---|---|---|---|
| `ingest` | hourly | no | `var/inbox/<source>.jsonl`, new items since the cursor; `knowledge/wire.json` |
| `chain` | not built: the site reads the tip from two explorers itself, a minute old at most; signaling waits on this worker | no | tip, retarget window, version-bit signaling, sent to the site |
| `check` | on demand | no | verification records (locators, quotes, code, chain) |
| `recheck` | daily, the 30 least recently verified claims | no | a fresh `last_verified` on each claim that still holds (sources read again, not from cache); `knowledge/rechecks.json` for each that does not, shown on its page; a `reverify` run in the research log |
| `research` | daily, and for queued questions | yes, research role | `<staging>/<run>/` candidates and a run log |
| `verify` | after each research run | yes, verifier role | verdicts beside each candidate |
| `publish` | after verify | no | merges into `knowledge/`, gate to `var/review/`, commits |
| `snapshot` | after each publish that changed claims; `--upgrade` hourly until a block holds the proof | no | `knowledge/snapshots/`, OTS stamp at four public calendars |
| `bips` | with ingest | no | `knowledge/bips.json`: the BIP index at the head commit and its changes |
| `bench` | weekly, retrieval only (`--ask` on demand) | `--ask` only | `var/bench/<time>.json`: retrieval hit rates over `brain/bench/golden.yaml`, and with `--ask` each answer scored by kind |
| `review` | when the owner runs it | no | approves or rejects gated claims |
| `tick` | the timers' entry point (`tools/timers.sh`, systemd user units, one lock) | only `research` | hourly: ingest, BIP index, proof upgrades, queue pull; daily: recheck, snapshot; weekly: bench; each then ships: commits the wire, pushes main, deploys at once when claims changed and otherwise at most every 6 hours. `var/loop/<day>.jsonl` records every step. The paid `research` timer is installed off. |

The roles are separated by permission profile, not by convention (SECURITY.md): the research role
can fetch and write only in its run folder, the verifier can fetch and write only verdict files,
and only deterministic code writes `knowledge/` or holds a secret.

### `web/` (Next.js on Vercel)

- Pages are rendered at build time from the compiled bundle: home, topics with the depth dial,
  claims, proposals, debates, the Pulse, the research log, corrections, the review queue counts,
  snapshots and how to verify them, Safety Desk, about and editorial policy.
- Live parts: the chain tip on Pulse (read on the server from two explorers that must agree,
  cached a minute; signaling to follow from the brain's chain worker), Ask the Brain (`/ask`, `POST /api/v1/ask`: retrieval in-process, one Anthropic API call checked by `core/src/ask.ts`, a daily budget, visitor limits and an answer cache in the `blocklore-kv` Redis that `tools/env.sh` provisions), the research
  queue (`/queue`, `/api/v1/queue`: questions Ask could not answer, queued with a signed ticket,
  shown once the brain triages them; `pnpm brain queue` pulls and reports back; Redis, no identity
  stored).
- Machine surfaces: `/api/v1/*` JSON (API.md), `/mcp` (Model Context Protocol: seven
  read-only tools, stateless, protocol in `core/src/mcp.ts`), `/llms.txt`, `/llms-full.txt`, `/exports/claims.jsonl`, Atom and RSS of every change. Free for people; an L402 tier
  for heavy automated use comes with the Lightning backend (Q3).

## Interfaces

These are the seams where one implementation will replace another.

```ts
// A chain backend. Esplora pair today, Bitcoin Core RPC when the owner provides a node.
interface ChainSource {
  name: string;                                    // "esplora:mempool.space+blockstream.info", "core:<host>"
  tipHeight(): Promise<number>;
  blockHash(height: number): Promise<string>;
  blockHeader(hashOrHeight: string | number): Promise<{ height: number; hash: string; version: number; time: number; bits: string }>;
  blockSubsidy(height: number): Promise<number>;   // sats, from coinbase value minus fees
}

// A feed of new items from one source.
interface SourceAdapter {
  id: string;                                      // "delving", "bitcoindev", "bips", ...
  tier: "T1" | "T2" | "T3" | "T4";
  poll(cursor: string | null): Promise<{ items: InboxItem[]; cursor: string }>;
}

// Fetch a locator's text for quote checking. One resolver per host family.
interface LocatorResolver {
  matches(url: URL): boolean;
  fetchText(url: URL): Promise<{ text: string; finalUrl: string; fetchedAt: string }>;
}

// Where the brain's chat runs: Claude Code headless today.
interface AgentRunner {
  run(role: "research" | "verifier", task: string, opts: { maxTurns: number; workdir: string }): Promise<RunResult>;
}

// Snapshot signing and timestamping.
interface Notary {
  timestamp(digest: Uint8Array): Promise<Uint8Array>;   // OpenTimestamps proof bytes
  sign?(digest: Uint8Array): Promise<SignedEnvelope>;   // OC Stamp, once Q2 is answered
}

// Payments for boosts and the L402 tier, once Q3 is answered.
interface PaymentProvider {
  invoice(sats: number, memo: string): Promise<{ bolt11: string; paymentHash: string; expiresAt: string }>;
  settled(paymentHash: string): Promise<boolean>;
}
```

## Data flow of one claim

1. **Ingest** sees a new Delving post and appends it to `var/inbox/delving.jsonl`.
2. **Research** (daily) reads new inbox items, the research queue and the gap map, reads the
   sources, and writes candidate claims to its run folder, each with locators and short exact
   quotes. It writes a run log: what it read, what it proposed, what it skipped and why.
3. **Check** (deterministic) validates the schema and the style rules, fetches every locator, finds
   every quote, runs every code and chain check, and looks for existing claims that say something
   close (possible duplicates or contradictions).
4. **Verify** (fresh context) receives each candidate with its fetched evidence and tries to falsify
   it: does the quote support the statement, is the statement stronger than the evidence, does it
   contradict a published claim, is the status and confidence right. Verdict: accept, revise (with a
   reason) or reject (with a reason).
5. **Publish** (deterministic) merges accepted claims. Gate rules decide which wait for the owner:
   contested topics or statuses, stances and arguments, named people, safety advice. The rest are
   written to `knowledge/`, the revision log is appended, the bundle is compiled, the change is
   committed as the owner and pushed.
6. **Snapshot** hashes every claim canonically, builds a Merkle root, writes the manifest and stamps
   the root with OpenTimestamps. The site rebuilds and shows the change in the Pulse.

## Verifying Blocklore itself

- Every claim page shows its canonical hash, its place in the newest snapshot and the Merkle audit
  path to the root (RFC 6962 tree, RFC 9162 inclusion proof).
- `knowledge/snapshots/<n>.json` lists each claim's hash, the Merkle root, the commit the hashes
  came from and the previous snapshot's root; `<n>.json.ots` proves the file existed before a
  Bitcoin block. The proof format is read and written in `core/src/ots.ts`; nothing else is needed.
- `pnpm verify:snapshot <n>` (and the instructions on /verify) recompute the hashes from the claim
  files at that commit, check the root and the chain of snapshots, and check the proof against a
  block header from `bitcoin-cli` or from two explorers that must agree. `ots verify` works too.
- `/snapshots/<file>` serves the files byte for byte; `/api/v1/snapshots` lists them.
- Chain and code checks print the exact command a reader can run against their own node or clone.

## Repository layout

```
knowledge/        the store (public)
core/             schemas, compiler, gate, hashing, retrieval, style (pure)
brain/            ingest, chain, checks, publish, snapshot, review, agent runner, prompts
web/              the site, API and MCP
tools/            deploy, environment, screenshots, style lint
var/              devbox state, never committed: inbox, staging, review, cache, budgets, logs
```
