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
| Q2 | Who signs snapshots? | Built 2026-11-21 (ORANGECHECK.md): a publisher key on the devbox signs every edition with an OC Stamp and every evaluator decision as an OC Agent action; the owner's own Bitcoin key, attested for `dns:blocklore.space`, delegates to it from the admin and can revoke it there. |
| Q3 | Lightning backend for L402 and question boosts (a BTCPay store, LND, an Alby Hub, other). | Boosts and L402 off; interface only. |
| Q4 | Budget: a daily ceiling for brain research runs. | Decided 2026-11-21: every model session runs on the owner's Claude subscription, never an API key, so nothing is billed per token. The owner sets sessions a day, minutes and turns per session in the admin. The site runs no model for readers. |
| Q5 | Nostr identity for publishing digests and snapshots, and which relays. | Snapshot stamps, the attestation, the delegation and revocations publish on the OrangeCheck family's relays (nos.lol, relay.primal.net, nostr.mom, nostr.oxtr.dev, relay.ochk.io) under a Nostr key derived from the publisher key, from the hourly tick once the key exists. Built 2026-11-23: the channel people follow (ORANGECHECK.md, "The Nostr channel") posts the daily digest as a NIP-23 article, sealed editions and the security watch's changes under a sibling key, `_@blocklore.space` by NIP-05, on the same relays, while the owner's "Post to Nostr" switch in the admin is on (off by default). |
| Q6 | License for Blocklore's own text (CC BY-SA 4.0 would match Stack Exchange and keep quotes simple) and code (MIT). | Chosen 2026-11-21: code MIT (LICENSE, as Bitcoin Core), the store CC BY 4.0 (knowledge/LICENSE) so agents, wallets and other references can reuse claims with credit; quotes stay their authors'. |
| Q7 | The owner's own opinions: where and how they appear, labeled as the owner's. | Nowhere yet. |

## Risks

| Risk | What we do about it |
|---|---|
| Invented or mis-attributed citations, the Grokipedia failure | Every source carries a short exact quote. Deterministic code fetches the locator and finds the quote before anything publishes; a separate verifier with fresh context then judges whether the quote supports the statement. A locator that stops resolving is a bug with an alert. |
| Prompt injection from fetched pages | All fetched text is data. The research role has no secrets, cannot publish and cannot edit its own instructions. Hidden text is stripped before a model sees a page. Suspected injections are logged publicly. |
| Looking partisan on contested questions | Contested topics, stances and named people pass the human gate. Positions are steelmanned in proponents' own words, with links. The brain's voice never picks a side on value questions. |
| Link rot | Code and BIPs are cited at a commit hash. Mailing-list posts by message id. Each published locator is re-fetched on a schedule and a Wayback snapshot is requested for non-git URLs. |
| Explorer or node dishonesty | Two independent explorers must agree today; a node the owner runs replaces them. Checks are reproducible commands anyone can run against their own node. |
| Runaway model use | Sessions run only on the owner's Claude subscription, with turn and minute limits per session and a daily session cap the owner sets in the admin; the plan's own limit pauses work. Only the brain calls a model; readers who want written answers bring their own model through `/mcp`. |
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
 │ research role (claude -p) ─▶ <staging>/<run>/*.yaml           │   │  MCP, suggestions ◀──────┼── readers
 │        reads inbox, queue, gap map; no secrets, no publish   │   │  Redis: queue, control   │
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
- `security/threats/<id>.yaml`, `security/watches.json`, `security/lab.json`: the security watch
  (below). A threat holds a title, a layer, a status and claim ids, never prose.

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
| `reports` | hourly, in the tick | no | pulls reader reports, rechecks each reported claim first (as `recheck`, every source read fresh, run `<day>-reverify-reports`), sends the outcome to the site; a `wrong` or `outdated` report that still holds becomes a research target; `var/reports/` |
| `research` | daily, and for reader suggestions taken up with `brain queue research` | yes, research role | `<staging>/<run>/` candidates and a run log; claims readers reported that still held come before any gap, with their notes as escaped data |
| `verify` | after each research run | yes, verifier role | verdicts beside each candidate |
| `publish` | after verify | no | merges into `knowledge/`, gate to `var/review/`, commits |
| `snapshot` | after each publish that changed claims; `--upgrade` hourly until a block holds the proof | no | `knowledge/snapshots/`, OTS stamp at four public calendars |
| `bips` | with ingest | no | `knowledge/bips.json`: the BIP index at the head commit and its changes |
| `bench` | weekly, retrieval only | no | internal measurement, never shown to readers as answers: `var/bench/<time>.json` holds retrieval hit rates over the golden set (`brain/bench/golden.yaml`, 200 questions with known answers) and, with `--ask`, each answer the pipeline in `core/src/ask.ts` writes from the claims, scored by kind. `--publish` writes `knowledge/bench.json`, from which the gap map takes the questions the store covers only in part or not at all; a run without `--ask` keeps the last full answer scores |
| `gaps` | on demand; the research tick reads it | no | prints the gap map (`core/src/gaps.ts`, compiled into the bundle and shown at `/gaps`: short golden answers placed by search, thin depths, failed rechecks, review counts) and the research run `planResearch` would start |
| `nostr` | hourly while the owner's switch is on; `nostr.post` from the admin | no | the channel's notes (`core/src/nostr.ts`) signed by its own key and sent until two relays serve each back; `var/nostr/published.json`; `knowledge/nostr.json`, the switch's public record for NIP-05 and the Follow link. `status` and `preview` send nothing |
| `review` | when the owner decides, in the admin or the CLI | no | approves or rejects gated claims; the admin's decisions name each claim by the hash of what the owner saw |
| `tick` | the timers' entry point (`tools/timers.sh`, systemd user units, one lock) | only `research` | hourly: ingest, BIP index, proof upgrades, pulling new reader suggestions, reader reports, the security watches that are due, the Nostr channel's notes while the owner has posting on; daily: recheck, snapshot; weekly: bench, published to `knowledge/bench.json`, and the security lab; research (by hand only): the topic `planResearch` picks from the gap map, with the gaps in its task; each then ships: commits the wire, pushes main, deploys at once when claims changed and otherwise at most every 6 hours. `var/loop/<day>.jsonl` records every step. Each tick skips when the owner paused the brain or turned it off in the admin. |
| `watch` | hourly, each watch at its own cadence | no | `knowledge/security/watches.json`: the seven security watches (below); `var/security/blocks.json` |
| `lab` | weekly, under `heavy` | no | `knowledge/security/lab.json`, or the embargo when anything failed; `var/security/lab/` |
| `embargo` | when the owner decides, in the admin or the CLI | no | releases or dismisses a finding the disclosure gate held in `var/embargo/` |
| `daemon` | always (`blocklore-brain.service`) | no; it starts sessions | the control plane's devbox side (ADMIN.md): syncs with the site, applies the owner's signed commands, runs research `session`s on the owner's schedule (off, daily, continuous) as children, the model phase without the tick lock and publishing under it; `var/control/` |

The owner runs all of this from `/admin` on the site (ADMIN.md). The devbox takes no inbound
connection: the daemon calls the site's `/api/control/sync` every few seconds with its state and
takes back the owner's commands, each signed by the site under `CONTROL_KEY` and checked on the
devbox. The owner's settings (`var/control/settings.json`) set the research schedule, model,
per-session limits (every session runs on the owner's Claude subscription), focus and standing lessons; the research
role's task carries the owner's notes in a section of their own, and its turns stream to the
admin as they happen.

The roles are separated by permission profile, not by convention (SECURITY.md): the research role
can fetch and write only in its run folder, the verifier can fetch and write only verdict files,
and only deterministic code writes `knowledge/` or holds a secret.

### `web/` (Next.js on Vercel)

- The site is one app. A persistent 3D scene of the store (`web/components/scene/`) sits beside a
  docked panel that every view renders into. The bar holds four modes and one button, mapped in
  `web/lib/nav.ts`: Brain (`/`: what Blocklore is and what its brain is doing now, live from
  `/api/v1/brain`; then what it learns next, the change log with corrections, digests and the
  Pulse, and the research log), Knowledge (the topics, a topic, a claim, the proposals and the BIP
  index), Security (`/security`: every known threat to Bitcoin by layer, the watches, the lab's
  latest run and the advisories; a threat at `/security/<id>`) and Proof (sealed editions, their
  signatures, the evaluator's record, each month's progress at `/progress/<YYYY-MM>` compiled by
  `core/src/progress.ts` from the public record, and the method), with "Connect your AI" (`/connect` and the
  API docs) as the bar's one call to action. A mode's pages are tabs at the top of the panel.
  Every URL still works on its own, for links and search engines; moving between them changes only
  the panel. The scene is drawn for pointers only: every fact it shows is also in the panel. Pages
  are rendered at build time from the compiled bundle.
- Readers talk to no model on the site. Live parts: the chain tip on Pulse (read on the server
  from two explorers that must agree, cached a minute; signaling to follow from the brain's chain
  worker), and reader suggestions (the box on `/gaps`, `POST /api/v1/queue`: a question for the
  brain to research, checked for secrets, links and contacts stripped, repeats counted, at most 5
  per visitor and 200 for the site a day, public only once the brain or the owner triages it;
  `pnpm brain queue` pulls and reports back; the `blocklore-kv` Redis that `tools/env.sh`
  provisions, no identity stored), and reader reports ("Report a problem" on every claim page,
  `POST /api/v1/claims/<id>/reports`: wrong, outdated, the source does not say this, broken link
  or unclear, with an optional note for the brain and the owner only; the same secret check,
  stripping and caps as suggestions, a repeat of the same kind on the same version counted; the
  hourly tick rechecks each reported claim and the outcome shows on the claim's page, under
  Corrections and in `GET /api/v1/reports`; the owner reads the notes and dismisses abuse in the
  admin's Reader reports page).
- Machine surfaces: `/api/v1/*` JSON (API.md), `/mcp` (Model Context Protocol: ten
  read-only tools, stateless, protocol in `core/src/mcp.ts`; readers bring their own model
  through it, and `/connect` shows the setup for Claude Code, Claude, Cursor and VS Code),
  `/llms.txt`, `/llms-full.txt`, `/exports/claims.jsonl`, Atom and RSS of every change. Their use
  is counted as numbers per UTC day (`core/src/reach.ts`; `web/proxy.ts` before the cache, the MCP
  route by tool name), shown on each month's progress page. Free for
  people; an L402 tier for heavy automated use comes with the Lightning backend (Q3).

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
  sign?(digest: Uint8Array): Promise<SignedEnvelope>;   // OC Stamp: brain/src/orangecheck.ts
}

// Payments for boosts and the L402 tier, once Q3 is answered.
interface PaymentProvider {
  invoice(sats: number, memo: string): Promise<{ bolt11: string; paymentHash: string; expiresAt: string }>;
  settled(paymentHash: string): Promise<boolean>;
}
```

## Data flow of one claim

1. **Ingest** sees a new Delving post and appends it to `var/inbox/delving.jsonl`.
2. **Research** (daily) reads new inbox items, reader suggestions taken up for research, claims
   readers reported as wrong or outdated that still passed their recheck, and the gap map, reads
   the sources, and writes candidate claims to its run folder, each with locators and short exact
   quotes. It writes a run log: what it read, what it proposed, what it skipped and why.
3. **Check** (deterministic) validates the schema and the style rules, fetches every locator, finds
   every quote, runs every code and chain check, and looks for existing claims that say something
   close (possible duplicates or contradictions).
4. **Verify** (fresh context) receives each candidate with its fetched evidence and tries to falsify
   it: does the quote support the statement, is the statement stronger than the evidence, does it
   contradict a published claim, is the status and confidence right. Verdict: accept, revise (with a
   reason) or reject (with a reason).
5. **Publish** (deterministic) merges accepted claims. Gate rules (`core/src/gate.ts`) mark which
   need closer checks: contested topics or statuses, stances and arguments, named people, safety
   advice. Those wait in `var/review/` for the evaluator (`brain/src/evaluator.ts`), which publishes
   only what passes a fresh recheck, the rules in `core/src/evaluate.ts` and two verifiers on
   different models (EDITORIAL.md, The evaluator). The rest are written to `knowledge/`, the
   revision log is appended, the bundle is compiled, the change is committed as the owner and
   pushed.
6. **Snapshot** hashes every claim canonically, builds a Merkle root, writes the manifest and stamps
   the root with OpenTimestamps. The site rebuilds and shows the change in the Pulse.

## The security watch

A continual, public check of every known threat to Bitcoin, built defensively: it reads only
public data, Blocklore's own claims and a local regtest, never probes a node, service or person,
and never publishes something that could be an undisclosed vulnerability.

- **The threat map** (`knowledge/security/threats/`, `core/src/security.ts`) is curated by the
  owner. Each threat has a layer (consensus, network, mining, cryptography, wallets, layers,
  supply chain, people), a status (defended, watching, open), the claims that describe it and the
  claims that describe its defences, history links (advisories, papers), the watches and lab tests
  that cover it, and the terms by which it is publicly known. A threat with no describing claim or
  no mitigation claim is a gap: the gap map scores it on its topic and the research task lists it,
  with the rule to describe a threat only as far as its public sources do.
- **Watches** (`core/src/watch.ts` for the readings and their documented thresholds,
  `brain/src/security/watches.ts` for the fetching) run on the hourly tick: pool concentration,
  long block gaps, timestamps near difficulty boundaries, difficulty adjustments, reorgs,
  security advisories (bitcoincore.org and the GitHub advisories of Bitcoin Core, LND, Core
  Lightning, Eclair and LDK, through the ingest feeds) and the share of reachable nodes on Bitcoin
  Core versions past end of life (btcnodes.io). Blocks come from two explorers that must agree.
  Each watch keeps a status (ok, elevated, alert, unknown) and a short history; a chain watch past
  its threshold raises the live status of the threats that list it, advisories and node versions
  never do.
- **The lab** (`brain/src/security/lab.ts`) runs weekly under `heavy`: it downloads the newest
  Bitcoin Core release, checks `SHA256SUMS` and the builder signatures, and runs the release's own
  functional tests for known vulnerability classes in regtest against the release binaries, with a
  modest `-j`. It records version, test, result and duration, mapped to threats.
- **The disclosure gate** (`core/src/disclosure.ts`) is code with tests. A lab run with any failure
  or a release that did not verify, and a research candidate that reads as a security finding
  and either says the weakness is unfixed or undisclosed, names a CVE or GHSA no published
  advisory lists, or names nothing publicly known, are embargoed: written only to
  `var/embargo/` (mode 600), sent to the owner's admin with the projects' private reporting
  addresses, and absent from `knowledge/`, the run log, the feed and the site. Only the owner
  releases or dismisses one (SECURITY.md, T9).
- **The site** shows `/security` (layers and threats, the watches with their history, the latest
  lab run, the latest advisories) and `/security/<threat>`; the MCP tools `threats` and `watches`
  serve the same data. Watch and lab results become feed events (`brain/src/security/events.ts`)
  with the threat and the outcome; nothing embargoed is ever logged there.

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
