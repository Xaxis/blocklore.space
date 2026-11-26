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
| Q3 | Lightning backend for L402 and question boosts (a BTCPay store, LND, an Alby Hub, other). | Decided 2026-11-23, when the owner asked the work to stop waiting on them: no payments. Everything stays free for people and programs, with no account, and nobody can pay to move a question up, because money must not steer what an evenhanded record covers. Heavy automated use is asked to fetch the export. The owner can reopen this. |
| Q4 | Budget: a daily ceiling for brain research runs. | Decided 2026-11-21: every model session runs on the owner's Claude subscription, never an API key, so nothing is billed per token. The owner sets sessions a day, minutes and turns per session in the admin. The site runs no model for readers. |
| Q5 | Nostr identity for publishing digests and snapshots, and which relays. | Snapshot stamps, the attestation, the delegation and revocations publish on the OrangeCheck family's relays (nos.lol, relay.primal.net, nostr.mom, nostr.oxtr.dev, relay.ochk.io) under a Nostr key derived from the publisher key, from the hourly tick once the key exists. Built 2026-11-23: the channel people follow (ORANGECHECK.md, "The Nostr channel") posts the daily digest as a NIP-23 article, sealed editions and the security watch's changes under a sibling key, `_@blocklore.space` by NIP-05, on the same relays, while the owner's "Post to Nostr" switch in the admin is on (off by default). |
| Q6 | License for Blocklore's own text (CC BY-SA 4.0 would match Stack Exchange and keep quotes simple) and code (MIT). | Chosen 2026-11-21: code MIT (LICENSE, as Bitcoin Core), the store CC BY 4.0 (knowledge/LICENSE) so agents, wallets and other references can reuse claims with credit; quotes stay their authors'. |
| Q7 | The owner's own opinions: where and how they appear, labeled as the owner's. | Nowhere yet. |

## Risks

| Risk | What we do about it |
|---|---|
| Invented or mis-attributed citations, the Grokipedia failure | Every source carries a short exact quote. Deterministic code fetches the locator and finds the quote before anything publishes; a separate verifier with fresh context then judges whether the quote supports the statement. A locator that stops resolving is a bug with an alert. |
| Prompt injection from fetched pages | All fetched text is data. The research role has no secrets, cannot publish and cannot edit its own instructions. Hidden text is stripped before a model sees a page. Suspected injections are logged publicly. |
| Looking partisan on contested questions | Contested topics, stances and named people get the evaluator's closer checks: the rules in `core/src/evaluate.ts` and two verifiers on different models. Positions are steelmanned in proponents' own words, with links. The brain's voice never picks a side on value questions. |
| Link rot | Code and BIPs are cited at a commit hash. Mailing-list posts by message id. Each published locator is re-fetched on a schedule and a Wayback snapshot is requested for non-git URLs. |
| Explorer or node dishonesty | Two independent explorers must agree today; a node the owner runs replaces them. Checks are reproducible commands anyone can run against their own node. |
| Runaway model use | Sessions run only on the owner's Claude subscription, with turn and minute limits per session and a daily session cap the owner sets in the admin; the plan's own limit pauses work. Only the brain calls a model; readers who want written answers bring their own model through `/mcp`. |
| Safety advice that hurts someone | Safety Desk content always meets the evaluator's safety rules: two independent sources and no advice voice. The site never asks for or accepts seeds, keys, xpubs or identifying addresses; input that looks like one is refused before it is stored or sent anywhere. |
| The evaluator becomes a bottleneck | It decides in batches the owner sizes in the admin, where only claims that pass code take a verifier's place, and the site shows how many claims wait per topic, so the queue is visible. The owner loosens the gate policy over time. |
| Feed endpoints change | Each adapter has a health check; an adapter that fails three runs in a row raises an alert and the gap shows on the research log. |

## Components

```
                      devbox (the brain)                                     public
 ┌──────────────────────────────────────────────────────────────┐   ┌──────────────────────────┐
 │ ingest (hourly, no LLM)  ─▶ var/inbox/*.jsonl                 │   │ blocklore.space (Vercel) │
 │ watch  (hourly, no LLM)  ─▶ readings, version bits            │   │  pages from the bundle   │
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
- `debates/<slug>.yaml`: a debate map, an argument graph over claims. A question, its positions'
  labels, nodes that are claims marked value, empirical or definitional, and edges that support or
  rebut. `core/src/debateview.ts` holds its rules and builds the view from the published claims
  at every build, so a withdrawn node drops out and a map that then breaks a rule is not shown.
  See CLAIMS.md, Debate maps.
- `runs/<date>/<run>.yaml`: the research log. What was read, what was proposed, what was rejected
  and why, what is still open.
- `snapshots/<n>.json` and `<n>.json.ots`: published states, hashed and timestamped on Bitcoin. A
  snapshot file is never rewritten; only its proof grows when a calendar completes it.
- `bips.json`: the BIP index at a commit (owners left out) and every change to it since.
- `core-bips.json`: Bitcoin Core's own list of the BIPs it implements (`doc/bips.md`), each entry in
  Core's words at the first commit read with them, and every change per BIP since. Not claims.
- `bolts.json`: BOLT #0, the Lightning specification's own index, at a commit, the SHA-256 of each
  BOLT's text there, and every change since (added, removed, retitled, text). Not claims.
- `at-head.json`: each passage a claim quotes from a file at a pinned GitHub commit, as last read
  at its repository's head (`current`, `changed` or `gone`, since when, at which head). Not claims.
- `wire.json`: the newest items the feeds saw upstream, titles and links only. Not claims.
- `security/threats/<id>.yaml`, `security/watches.json`, `security/lab.json`,
  `security/advisories.json`, `security/advisory-map.yaml`: the security watch (below). A threat
  holds a title, a layer, a status and claim ids, never prose. The advisory map is the owner's.

The daily digest is not stored: `core/src/digest.ts` compiles each UTC day from the store's own
events at build time, so every line is a published claim and there is no second text to check.

Claims waiting for the evaluator are not in the public repository. They live in `var/review/` on
the devbox; the site shows only how many wait, per topic. A debate map waiting for its claims sits
beside them in `var/review/debates/` (`brain/src/debates.ts`) and publishes in the commit that
publishes its last claim.

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
| `chain` | no worker of its own: the site reads the tip from two explorers itself, a minute old at most; the version bits are counted hourly inside the `watch` step, from the blocks it already follows (`brain/src/signaling.ts`, counted by `core/src/signaling.ts`) | no | `knowledge/chain/signaling.json` with the watches' readings, in their commit (see the data flow of the version bits below); `pnpm brain signaling` prints the tally from both explorers and writes nothing |
| `check` | on demand | no | verification records (locators, quotes, code, chain) |
| `recheck` | daily, the 30 least recently verified claims | no | a fresh `last_verified` on each claim that still holds (sources read again, not from cache); `knowledge/rechecks.json` for each that does not, shown on its page; a `reverify` run in the research log |
| `at head` | daily, after `recheck`; also `pnpm brain at-head` | no | `knowledge/at-head.json`: every pinned GitHub passage the store quotes, read again at its repository's head; a passage already read at an unchanged head is not read again, and a failed read keeps the last state (`brain/src/athead.ts`) |
| `reports` | hourly, in the tick | no | pulls reader reports, rechecks each reported claim first (as `recheck`, every source read fresh, run `<day>-reverify-reports`), sends the outcome to the site; a `wrong` or `outdated` report that still holds becomes a research target; `var/reports/` |
| `research` | daily, and for reader suggestions taken up with `brain queue research` | yes, research role | `<staging>/<run>/` candidates and a run log; claims readers reported that still held come before any gap, with their notes as escaped data |
| `verify` | after each research run | yes, verifier role | verdicts beside each candidate |
| `publish` | after verify | no | merges into `knowledge/`, gate to `var/review/`, commits |
| `snapshot` | after each publish that changed claims; `--upgrade` hourly until a block holds the proof | no | `knowledge/snapshots/`, OTS stamp at four public calendars |
| `bips` | with ingest | no | `knowledge/bips.json`: the BIP index at the head commit and its changes |
| `core bips` | hourly, after `bips`; also in `pnpm brain bips` | no | `knowledge/core-bips.json`: Bitcoin Core's `doc/bips.md` at bitcoin/bitcoin's head, written only when an entry changed (`brain/src/bips.ts`, `refreshCoreBips`) |
| `chainparams` | hourly, after `core bips`; also in `pnpm brain bips` | no | `knowledge/chain/chainparams.json`: the version bits deployments `CMainParams` defines at Bitcoin Core's newest release, read only when that release changes (`brain/src/chainparams.ts`) |
| `bolts` | hourly, after `chainparams`; also `pnpm brain bolts` | no | `knowledge/bolts.json`: BOLT #0, the Lightning specification's index, and the SHA-256 of each BOLT's text at lightning/bolts' head, written only when the index or a text changed (`brain/src/bolts.ts`) |
| `bench` | weekly, retrieval only | no | internal measurement, never shown to readers as answers: `var/bench/<time>.json` holds retrieval hit rates over the golden set (`brain/bench/golden.yaml`, 200 questions with known answers) and, with `--ask`, each answer the pipeline in `core/src/ask.ts` writes from the claims, scored by kind. `--publish` writes `knowledge/bench.json`, from which the gap map takes the questions the store covers only in part or not at all; a run without `--ask` keeps the last full answer scores |
| `review-loop` | weekly, in the tick, for the week that just ended; on demand for any week | no | the weekly review of the loop (`core/src/loopreview.ts`, BACKLOG 31): from the daemon's sessions, the run logs, the evaluator's decisions, rechecks, reader reports, the agenda, the gap map and the review queue, it counts the week and lists findings, each a fixed code with its numbers, its evidence and, when an admin command fits, that command as a proposal (a lesson from a rule's own description, research on a topic, a batch, a setting); `var/loop/reviews/<week>.json`, private, carried to the admin's Weekly review by the daemon and never in the bundle |
| `gaps` | on demand; the research tick reads it | no | prints the gap map (`core/src/gaps.ts`, compiled into the bundle and shown at `/gaps`: short golden answers placed by search, thin depths, failed rechecks, review counts) and the research run `planResearch` would start |
| `nostr` | hourly while the owner's switch is on; `nostr.post` from the admin | no | the channel's notes (`core/src/nostr.ts`) signed by its own key and sent until two relays serve each back; `var/nostr/published.json`; `knowledge/nostr.json`, the switch's public record for NIP-05 and the Follow link. `status` and `preview` send nothing |
| `review` | when the owner decides, in the admin or the CLI | no | approves or rejects gated claims; the admin's decisions name each claim by the hash of what the owner saw |
| `tick` | the timers' entry point (`tools/timers.sh`, systemd user units, one lock) | only `research` | hourly: ingest, BIP index, proof upgrades, pulling new reader suggestions, reader reports, the security watches that are due, the Nostr channel's notes while the owner has posting on; daily: recheck, snapshot; weekly: bench, published to `knowledge/bench.json`, the security lab on each maintained Core release and LND's newest, and the review of the loop's week that just ended (`review-loop`); research (by hand only): the topic `planResearch` picks from the gap map, with the gaps in its task; each then ships: commits the wire, pushes main, deploys at once when claims changed and otherwise at most every 6 hours. `var/loop/<day>.jsonl` records every step. Each tick skips when the owner paused the brain or turned it off in the admin. |
| `watch` | hourly, each watch at its own cadence | no | `knowledge/security/watches.json`: the seven security watches (below); `knowledge/security/advisories.json` when the advisories watch reads (every advisory it knows, and up to 8 NVD records a run); `knowledge/chain/signaling.json` once the tip's difficulty period is read to the tip (the version bits); `var/security/blocks.json`, which also keeps every block's version in the tip's period and the one before |
| `lab` | weekly, under `heavy`, each maintained Core release one after another, with the libsecp256k1 it ships, then LND's newest release, then LDK's, then Eclair's, then Core Lightning's | no | `knowledge/security/lab.json` (one run per release), or the embargo for a release where anything failed; `var/security/lab/<version>/`, `var/security/lab/lnd/<version>/`, `var/security/lab/go/`, `var/security/lab/ldk/<version>/`, `var/security/lab/rust/`, `var/security/lab/eclair/<version>/`, `var/security/lab/java/`, `var/security/lab/cln/<version>/`, `var/security/lab/cln-deps/` |
| `embargo` | when the owner decides, in the admin or the CLI | no | releases or dismisses a finding the disclosure gate held in `var/embargo/` |
| `daemon` | always (`blocklore-brain.service`) | no; it starts sessions | the control plane's devbox side (ADMIN.md): syncs with the site, applies the owner's signed commands, runs research `session`s on the owner's schedule (off, daily, continuous) as children, the model phase without the tick lock and publishing under it; `var/control/` |

The owner runs all of this from `/admin` on the site (ADMIN.md). The devbox takes no inbound
connection: the daemon calls the site's `/api/control/sync` every few seconds with its state and
takes back the owner's commands, each signed by the site under `CONTROL_KEY` and checked on the
devbox. The owner's settings (`var/control/settings.json`) set the research schedule, model,
per-session limits (every session runs on the owner's Claude subscription), focus and standing lessons; the research
role's task carries the owner's notes in a section of their own, and its turns stream to the
admin as they happen. The task also carries what the evaluator's code held back lately, rule by
rule, and the topic's own drafts that the code rejected by rule, so research can draft one again
with the fix (a link to where a named person said it, a second independent source) instead of
losing it; then the drafts a verifier judged fixable ("revise", none "reject"), with code's own
account of the usual faults. Only code's reasons and a verifier's verdict are passed on, never a
verifier's words: a verifier reads fetched pages, so its reason could carry what a page said.

The roles are separated by permission profile, not by convention (SECURITY.md): the research role
can fetch and write only in its run folder, the verifier can fetch and write only verdict files,
and only deterministic code writes `knowledge/` or holds a secret.

### `web/` (Next.js on Vercel)

- The site is one app. A persistent 3D scene of the store (`web/components/scene/`) sits beside a
  docked panel that every view renders into. The bar holds four modes and one button, mapped in
  `web/lib/nav.ts`: Brain (`/`: what Blocklore is and what its brain is doing now, live from
  `/api/v1/brain`; then what it learns next, the change log with corrections, digests and the
  Pulse, and the research log), Knowledge (the topics, a topic, a claim, the proposals and the BIP
  index, a BIP at `/proposals/<n>` assembled by `core/src/bipview.ts` from the index and the claims
  citing it; any topic or claim as it stood at a past block height or UTC date, the time machine at
  `/topics/<slug>/at/<moment>` and `/claims/<id>/at/<moment>`, rebuilt by `core/src/replay.ts`; the
  version bits blocks set this difficulty period on `/proposals` and on BIP 9's and BIP 320's
  pages; debate maps at `/debates` and `/debates/<slug>`, the positions side by side with each
  stance and argument's holders and dates, then the claims of fact and definition the sides
  share, linked from each topic they are filed under), Security (`/security`: every known threat to Bitcoin by layer, the watches, the lab's
  run on each maintained Bitcoin Core release and the advisories; a threat at `/security/<id>`; the
  Safety Desk at `/safety`, the threats to a person who holds bitcoin grouped by threat model in
  `core/src/desk.ts`, with the claims the threat map links to each) and
  Proof (sealed editions, their
  signatures, the evaluator's record, each month's progress at `/progress/<YYYY-MM>` compiled by
  `core/src/progress.ts` from the public record, and the method), with "Connect your AI" (`/connect` and the
  API docs) as the bar's one call to action. A mode's pages are tabs at the top of the panel.
  Every URL still works on its own, for links and search engines; moving between them changes only
  the panel. The scene is drawn for pointers only: every fact it shows is also in the panel. Pages
  are rendered at build time from the compiled bundle.
- Readers talk to no model on the site. Live parts: the chain tip on Pulse (read on the server
  from two explorers that must agree, cached a minute; the version bits are counted hourly by the
  brain and reach the site with the next deploy, 6 hours later at most), and reader suggestions
  (the box on `/gaps`, `POST /api/v1/queue`: a question for the brain to research, checked for secrets, links and contacts stripped, repeats counted, at most 5
  per visitor and 200 for the site a day, public only once the brain or the owner triages it;
  `pnpm brain queue` pulls and reports back; the `blocklore-kv` Redis that `tools/env.sh`
  provisions, no identity stored), and reader reports ("Report a problem" on every claim page,
  `POST /api/v1/claims/<id>/reports`: wrong, outdated, the source does not say this, broken link
  or unclear, with an optional note for the brain and the owner only; the same secret check,
  stripping and caps as suggestions, a repeat of the same kind on the same version counted; the
  hourly tick rechecks each reported claim and the outcome shows on the claim's page, under
  Corrections and in `GET /api/v1/reports`; the owner reads the notes and dismisses abuse in the
  admin's Reader reports page).
- Machine surfaces: `/api/v1/*` JSON (API.md), `/mcp` (Model Context Protocol: twelve
  read-only tools, stateless, protocol in `core/src/mcp.ts`; readers bring their own model
  through it, and `/connect` shows the setup for Claude Code, Claude, Cursor and VS Code),
  `/llms.txt`, `/llms-full.txt`, `/exports/claims.jsonl`, Atom and RSS of every change. Their use
  is counted as numbers per UTC day (`core/src/reach.ts`; `web/proxy.ts` before the cache, the MCP
  route by tool name), shown on each month's progress page. Free for
  people and programs alike, with no account or key (Q3).

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

```

## Data flow of one claim

1. **Ingest** sees a new Delving post and appends it to `var/inbox/delving.jsonl`.
2. **Research** (daily) reads new inbox items, reader suggestions taken up for research, claims
   readers reported as wrong or outdated that still passed their recheck, and the gap map, reads
   the sources, and writes candidate claims to its run folder, each with locators and short exact
   quotes. It writes a run log: what it read, what it proposed, what it skipped and why.
3. **Check** (deterministic) validates the schema and the style rules, fetches every locator, finds
   every quote, runs every code and chain check, and looks for existing claims that say something
   close (possible duplicates or contradictions). For a candidate the gate will mark, it also runs
   the evaluator's code rules (`brain/src/rulecheck.ts`), so the research role learns that a named
   person lacks a link, or safety advice has one publisher, while it can still repair the draft. It
   gets two repair rounds against this report. A rule that still fails after them does not stop the
   draft: the evaluator decides it.
4. **Verify** (fresh context) receives each candidate with its fetched evidence and tries to falsify
   it: does the quote support the statement, is the statement stronger than the evidence, does it
   contradict a published claim, is the status and confidence right. Verdict: accept, revise (with a
   reason) or reject (with a reason).
5. **Publish** (deterministic) merges accepted claims. Gate rules (`core/src/gate.ts`) mark which
   need closer checks: contested topics or statuses, stances and arguments, named people, safety
   advice. Those wait in `var/review/` for the evaluator (`brain/src/evaluator.ts`), which publishes
   only what passes a fresh recheck, the rules in `core/src/evaluate.ts` and two verifiers on
   different models (EDITORIAL.md, The evaluator); a claim its verifiers only asked to revise goes
   back once in a verifier's own rewording, for two fresh verifiers. The rest are written to `knowledge/`, the
   revision log is appended, the bundle is compiled, the change is committed as the owner and
   pushed. A debate map from the run (`debates/<slug>.yaml`) is written to `knowledge/debates/`
   only when it keeps every rule against the claims as they stand after the commit; one whose
   claims still wait for the evaluator waits in `var/review/debates/` and is retried by every
   later commit to the store.
6. **Snapshot** hashes every claim canonically, builds a Merkle root, writes the manifest and stamps
   the root with OpenTimestamps. The site rebuilds and shows the change in the Pulse.

## Data flow of the version bits

1. **Follow.** Each hourly `watch` step reads the newest blocks from mempool.space and
   blockstream.info, which must agree on every block's hash, time, target and version
   (`blocksBetween` in `brain/src/security/watches.ts`), and keeps each version from the start of
   the difficulty period before the tip's in `var/security/blocks.json`.
2. **Fill.** The rest of the tip's period is read in chunks of 150 blocks, pages aligned so the
   year-long cache answers any block more than 100 deep the next time. A step spends about a
   minute of it at most under the tick lock: the first fill of a whole period (up to 135 requests
   to one explorer and 202 to the other, at one a second each, side by side) takes 2 to 4 minutes,
   so it spreads over a few hours, or one `pnpm brain signaling` warms the cache first.
3. **Count.** Once every block from the period's first to the tip is read, `core/src/signaling.ts`
   counts them (BIP 9's prefix, bits 0 to 12, BIP 320's bits 13 to 28 apart, versions without
   the prefix); a period that ends is tallied once and kept as the last period. Counts and shares
   only, never a forecast (EDITORIAL.md, "No predicted outcomes").
4. **Ship.** `knowledge/chain/signaling.json` goes into the watches' own commit, the bundle
   carries it, and `/proposals`, BIP 9's and BIP 320's pages, `GET /api/v1/signaling` and the MCP
   tool `signaling` show it. A deployment's name appears beside its bit only when Bitcoin Core's
   mainnet `chainparams.cpp` at its newest release defines it: the hourly `chainparams` step
   (`brain/src/chainparams.ts`) reads `CMainParams` at the release tag's commit into
   `knowledge/chain/chainparams.json` whenever a new release comes out.

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
  with the rule to describe a threat only as far as its public sources do. Research names in
  run.yaml the threats its claims explain or defend against, and the hourly tick links each once
  its claim is published and its statement names the threat (`researchLinks` in
  `core/src/threatadmin.ts`, `brain/src/security/threatlinks.ts`). The owner links and unlinks
  from the admin's Threat map page too (`threat.link`, ADMIN.md), where code suggests the
  published claims whose statement names one of its terms or its id's words. Either way the brain
  edits only that list of that threat's file.
- **Watches** (`core/src/watch.ts` for the readings and their documented thresholds,
  `brain/src/security/watches.ts` for the fetching) run on the hourly tick: pool concentration,
  long block gaps, timestamps near difficulty boundaries, difficulty adjustments, reorgs,
  security advisories (bitcoincore.org and the GitHub advisories of Bitcoin Core, LND, Core
  Lightning, Eclair and LDK, through the ingest feeds) and the share of reachable nodes on Bitcoin
  Core versions past end of life, from two independent crawls (Bitnodes at btcnodes.io and Luke
  Dashjr's), the lower share counting so neither alone raises the watch, and a crawl over 7 days
  old left out. Blocks come from two explorers that must agree.
  Each watch keeps a status (ok, elevated, alert, unknown) and a short history; a chain watch past
  its threshold raises the live status of the threats that list it, advisories and node versions
  never do.
- **Advisories on their threats** (`core/src/advisories.ts`, `brain/src/security/advisorylog.ts`).
  Every advisory the watch has read is kept in `knowledge/security/advisories.json` and filed
  under the threats it concerns by code, when the bundle compiles, under explicit rules: the
  owner's placement in `knowledge/security/advisory-map.yaml`, its page in the threat's record, a
  CVE or GHSA id the threat lists, every advisory of a project the map names, one of the threat's
  terms in its title, or the map's words for the threat in its title. The threat's page says which
  rule filed each one and quotes the words of a match by words. An advisory nothing files is a gap
  for the owner on `/gaps`, never a research topic.
- **The record against NVD.** Every CVE id a threat's record or terms name, and every advisory's,
  is looked up in NVD's public CVE API 2.0 (no key, one request every 6.5 seconds, each record
  asked again only when it may have changed). A CVE NVD has no record of, one it rejected, or one
  whose record names a project other than the one its advisory or cited page implies is a finding
  on the threat's page for the owner; the record itself is never changed to match.
- **The lab** (`brain/src/security/lab.ts`) runs weekly under `heavy` on the newest point release
  of each major version Bitcoin Core maintains (three, `MAINTAINED_MAJORS`, per
  https://bitcoincore.org/en/lifecycle/; `maintainedReleases` picks them from `git ls-remote`,
  skipping a major with only release candidates), one after another, with a modest `-j`. For
  each it downloads the release, checks `SHA256SUMS` and the builder signatures, and runs that
  release's own functional tests for known vulnerability classes in regtest against its binaries:
  the threat map's tests as far as that release has them, so an older release is never failed
  for a test added after it shipped. Then it builds libsecp256k1's own test programs (`tests`,
  `noverify_tests`, `exhaustive_tests`, recorded as `secp256k1/tests` and so on) from the copy
  that release ships in `src/secp256k1`, which the verified source tarball covers, with gcc and
  the modules and defines the release's own CMake files give Core's build (`secpBuild` in
  `brain/src/security/secp256k1.ts` reads them from `cmake/secp256k1.cmake` and the subtree's two
  `CMakeLists.txt`; a file it cannot read is a build error), and runs each in its default settings
  under `heavy` with a time limit. A program that fails or does not build fails like a test. Each
  release is its own run through the disclosure gate, recording version, test, result and
  duration, mapped to threats; `lab.json` keeps up to 12 runs of each major. A release that cannot run (a failed download) does not stop the others. The test
  framework's ports start where nothing on the shared machine listens (`portBase`), so another
  project's server can not fail a test and hold a false finding. Readers see the run on the newest
  release of each of the three newest majors it has (`labReleases`).
- **LND in the lab** (`brain/src/security/lnd.ts`) follows Core's runs: LND's newest final
  release (`newestLndRelease`, never an rc), checked the way LND's own `scripts/verify-install.sh`
  does, with that script and `scripts/keys/` read from LND's repository at the release tag (a
  sparse checkout), never from the release's files: each of the 16 maintainers' signatures over
  `manifest-v<version>.txt` against a keyring holding that maintainer's key alone, at least
  `MIN_REQUIRED_SIGNATURES` (5) good by the script's count, none bad, then the source tarball's
  SHA-256 against the manifest. The published count is GOODSIG alone, as Core's is; a signature
  gpg calls good but made by a key past its expiry (EXPKEYSIG) counts toward LND's 5, as the
  script counts it, and not toward the published number. A release that does not verify is never
  extracted. A verified one is built with the Go its `go.mod` names, from go.dev with go.dev's
  SHA-256, unpacked under `var/security/lab/go/` with GOROOT, GOPATH, GOMODCACHE, GOCACHE, HOME
  and TMPDIR all under the lab, `GOTOOLCHAIN=local`, `GOFLAGS=-mod=readonly` and every Go setting
  of the caller's environment dropped; the modules `go.sum` pins are fetched once with
  `go list -deps -test`, and the tests then run offline (`GOPROXY=off`). Each package the threat
  map lists (`LND_PACKAGES`: contractcourt, htlcswitch, lnwallet, sweep, watchtower/lookout) runs
  as LND's `make unit pkg=<package>` does, with its tags from `make/testing_flags.mk`,
  `-count=1` and a 20 minute limit, under `heavy`, one package at a time, and is one lab test
  (`lnd/contractcourt`), its time the test binary's own from `go test -json`. The header of
  `lnd.ts` names, file and function, what each package's tests check and why channel jamming and
  replacement cycling have no LND package. Every run records its project (`bitcoin-core`, `lnd`,
  `ldk` or `cln`, `LabRun.project`); an LND run that fails goes to the owner with LND's contact alone.
- **LDK in the lab** (`brain/src/security/ldk.ts`) follows LND's: LDK's newest final release
  (`newestLdkRelease`, `vX.Y` or `vX.Y.Z`, never an rc or beta). LDK publishes no release files,
  so the trust anchor is its signed annotated tag: the lab clones the repository at the tag, reads
  the maintainers' fingerprints from SECURITY.md at the tag and at the release before it
  (`ldkMaintainers`, `countedMaintainers`: only a key both list counts, so a tag never vouches for
  a key it adds), fetches each counted key from keys.openpgp.org by its fingerprint into a keyring
  of its own and exports only that fingerprint into the one it verifies with, then checks the
  tag's signature over the tag object's bytes as `git verify-tag` does (`splitSignedTag`,
  `tagSigner`: GOODSIG with VALIDSIG naming a counted primary key), that the tag names itself and
  the commit checked out, and that the tree is clean (`ldkVerified`). `verified.sha256` records
  that checkout match and `signatures` is 0 or 1 of `signers` counted keys. A tag that does not
  verify is never built. A verified one is built with Rust stable from static.rust-lang.org's
  channel manifest (rustc, cargo and rust-std, each `.tar.xz` checked against its `.sha256` and
  the manifest's `xz_hash`, unpacked under `var/security/lab/rust/<version>/`), with CARGO_HOME,
  the target folder, HOME and TMPDIR all under the lab and every CARGO and RUST setting of the
  caller's environment dropped (`cargoEnv`). LDK commits no Cargo.lock: the lab resolves one at a
  release's first run, keeps it beside the release, fetches the crates once
  (`cargo fetch --locked`), and builds and tests `--locked --offline`. Each module the threat map
  lists (`LDK_MODULES`: chain/package, ln/functional_tests, ln/monitor_tests,
  ln/onion_route_tests) runs as `cargo test -p lightning --lib <module>::` under `heavy`, one at a
  time, and is one lab test (`ldk/ln/monitor_tests`), its time libtest's own. A module whose
  filter matches no test is missing, never passed. The header of `ldk.ts` names the tests behind
  each mapping and why channel jamming and replacement cycling have no LDK module. A failing LDK
  run goes to the owner with LDK's contact alone.
- **Eclair in the lab** (`brain/src/security/eclair.ts`) follows LDK's: Eclair's newest final
  release (`newestEclairRelease`, `vX.Y.Z`). Its tag is not signed; its release notes say to
  check `SHA256SUMS.asc` with "our release signing key" and then the zips against it. The lab
  reads the key id the notes name and takes it only when it ends a fingerprint pinned in code
  (`ECLAIR_KEYS`, with where ACINQ publishes each key), fetches that key from acinq.co or a
  keyserver into a keyring of its own and exports only that fingerprint, decrypts the sums as the
  notes do and reads them only from what gpg says was signed, downloads the eclair-node zip they
  list and checks it, then reads the full commit eclair-node's jar records in its manifest
  (`Specification-Version`), which must be the commit the tag names, checked out clean
  (`eclairVerified`). Only then does anything build: Temurin 21.0.12.1+1 (the JDK the notes
  name; SHA-256 pinned, the release's `.sha256.txt` and its `.sig` by Adoptium's key) and Maven
  3.9.9 (what Eclair's wrapper pins; SHA-512 pinned, Apache's `.sha512` and its `.asc` by the key
  Apache Maven's KEYS lists), unpacked under `var/security/lab/java/`, with HOME, every JVM's
  user.home (`JAVA_TOOL_OPTIONS`), the temporary folder and the Maven repository under the lab
  (`mavenEnv`). The first run of a release resolves its dependencies online with
  `--strict-checksums` and keeps the SHA-256 of every file (`resolved.sha256`); later runs check
  them all and build and test offline. The build is the notes' own (`clean install -DskipTests`),
  and the record says whether it reproduced the signed zip byte for byte. Each group of
  eclair-core suites the threat map lists (`ECLAIR_SUITES`) runs as `mvn -pl eclair-core test`
  with `-DwildcardSuites` (a package) or `-Dsuites` (one suite) under `heavy`, and is one lab
  test (`eclair/channel/states`). The header of `eclair.ts` names the tests behind each mapping
  and why pinning and channel jamming have no Eclair group. channel/publish runs one suite at a
  time (`ONE_SUITE_AT_A_TIME`: each of its suites starts its own bitcoind and waits on it with
  fixed timeouts, which a loaded devbox misses). A group whose failures are timeouts in Akka
  TestKit's own words, and failures that each come right after a timed out test in the same suite
  in scalatest's recap (whose transactions stay in that suite's bitcoind; `rerunnable`,
  `afterTimeouts`), runs once more, alone (`heavy --solo`) and one suite at a time, and that
  attempt counts only if it runs every test and passes them all; the record keeps both, and the
  public test says why it ran twice (`rerun`). Any other failure, or any failure on the second
  attempt, fails the group. A failing Eclair run goes to the owner with Eclair's contact alone.
- **Core Lightning in the lab** (`brain/src/security/cln.ts`): its newest final release
  (`newestClnRelease`, `vYY.MM` or `vYY.MM.N`, never an rc), checked as its repro.md says. A bare
  partial clone at the tag gives SECURITY.md and `contrib/keys/`; only a key SECURITY.md lists at
  the tag and at the release before it counts (`clnReleaseKeys`, `countedMaintainers`), each taken
  by its fingerprint from `contrib/keys/` and both keyservers. The zip must match
  `SHA256SUMS-v<version>`, gpg must find no signature over the sums bad, and one must be good by a
  counted key (`sumsSignatures`, `clnVerified`); `verified.signatures` is the good ones of
  `signers` counted. Only then the tools the build needs and the machine lacks (`CLN_DEPS`: m4,
  autoconf, automake, libtool, gettext, libsodium, SQLite, zlib, lowdown), each pinned by SHA-256 and
  checked the way its publisher documents (`minisignVerify` for libsodium, in Node), are built
  into `var/security/lab/cln-deps/prefix/` under `heavy`, each kept while its archive and configure stay the same (`depsToBuild`); Mako comes
  from the verified release's own uv.lock, hashes required, into a venv of the release's. The
  build runs in the lab's environment alone (`clnEnv`, and `clnCompiler`, a cc that adds the prefix): `./configure
  --disable-rust --disable-valgrind`, then `make` of the test programs only. The groups
  (`CLN_PROGRAMS`: channels, htlcs, onions, gossip, penalties) are each one lab test
  (`cln/penalties`) and one `heavy` step, each program run as the Makefile's `unittest/%` rule
  runs it (`groupArgv`, `parseGroup`). The header of `cln.ts` names the programs behind each
  mapping and why pinning, channel jamming and replacement cycling have no group. A failing Core
  Lightning run goes to the owner with Core Lightning's contact alone.
- **The disclosure gate** (`core/src/disclosure.ts`) is code with tests. A lab run with any failure
  or a release that did not verify, and a research candidate that reads as a security finding
  and either says the weakness is unfixed or undisclosed, names a CVE or GHSA no published
  advisory lists, or names nothing publicly known, are embargoed: written only to
  `var/embargo/` (mode 600), sent to the owner's admin with the projects' private reporting
  addresses (an LND run's: LND's alone; an LDK run's: LDK's alone; an Eclair run's: Eclair's
  alone; a Core Lightning run's: Core Lightning's alone), and absent from `knowledge/`, the run log, the feed and the site. Only the owner
  releases or dismisses one (SECURITY.md, T9).
- **The site** shows `/security` (layers and threats, the watches with their history, the lab's
  run on each release it tests, each named with its project, Core's newest first and then LND's, LDK's, Eclair's and Core Lightning's, the latest advisories with their threats) and
  `/security/<threat>` (its claims, its advisories, its NVD check, its watches, its lab tests in a
  table per project, by release, and its record); the MCP tools `threats` (each test's result per release) and
  `watches` (with the lab's run per release) serve the same data. Watch and lab results become feed events (`brain/src/security/events.ts`)
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
