# The claim schema

A claim is the atomic unit of Blocklore: one statement, the sources that support it with exact
locators and quotes, the machine checks that confirm it against the chain or the code, and the
history of every change to it. Pages, proposals, debates, the Pulse and the digests are views
over claims.

The normative schema is code: `core/src/schema.ts` (zod). This document explains it. When they
disagree, the code wins and this document has a bug.

## A complete example

```yaml
id: taproot.activation-height
statement: >-
  Taproot's consensus rules have been enforced on mainnet since block 709,632, mined on
  14 November 2021.
kind: event
topics: [taproot]
depth: user
status: established
confidence: high
people: []
sources:
  - tier: T1
    kind: code
    title: Bitcoin Core chainparams.cpp, mainnet Taproot deployment
    url: https://github.com/bitcoin/bitcoin/blob/<commit>/src/kernel/chainparams.cpp#L110-L113
    locator: CMainParams, DEPLOYMENT_TAPROOT
    quote: min_activation_height = 709632
    accessed: 2026-11-20
    supports: direct
  - tier: T2
    kind: optech
    title: Bitcoin Optech Newsletter #175
    url: https://bitcoinops.org/en/newsletters/2021/11/17/
    locator: News, Taproot activated
    quote: <a short exact sentence from the page>
    accessed: 2026-11-20
    supports: direct
checks:
  - type: code.contains
    repo: bitcoin/bitcoin
    ref: <40-hex commit>
    path: src/kernel/chainparams.cpp
    text: min_activation_height = 709632
  - type: chain.block-hash
    height: 709632
    expect: <64-hex block hash>
first_seen: { time: 2026-11-20T15:00:00Z, height: 976744 }
last_verified:
  time: 2026-11-20T15:00:00Z
  height: 976744
  run: 2026-11-20-seed
  method: quotes 2/2, code 1/1, chain 1/1 (esplora pair agreed)
run: 2026-11-20-seed
related: [segwit.witness-versions]
revisions:
  - rev: 1
    at: { time: 2026-11-20T15:00:00Z, height: 976744 }
    run: 2026-11-20-seed
    change: created
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `<primary topic>.<slug>`, lowercase, `[a-z0-9-]`. Never changes and never reused. A claim that must say something different in substance is superseded by a new id. |
| `statement` | yes | One self-contained statement in the brain's voice (EDITORIAL.md). Readable on its own and in sequence with its section. 12 to 80 words. Numbers carry units. No em dashes. |
| `kind` | yes | `definition`, `fact`, `mechanism`, `event`, `trace`, `stance`, `argument` or `open-question`. |
| `topics` | yes | Topic slugs. The first is the primary topic and the folder the file lives in. |
| `depth` | yes | The lowest reader level the claim is written for: `curious`, `user`, `holder`, `builder`, `researcher`. |
| `status` | yes | `established`, `contested`, `speculative`, `superseded` or `withdrawn`. |
| `confidence` | yes | `high`, `medium` or `low` (meanings below). |
| `people` | yes | Named people the statement mentions or attributes to. Non-empty means the gate's closer checks. |
| `attributed_to` | for `stance`, `argument`, and any claim with `people` | `{ name, url }` per person or group, linking to where they said or did it. For a stance or argument, who holds the position; for any other claim, each person in `people` with the place the statement draws on (the paper they wrote, their post, their commit). The evaluator holds back a claim that names a person without one (EDITORIAL.md, "The evaluator"). |
| `sources` | yes, 1 or more | See Sources. |
| `checks` | no | Deterministic checks against the chain or code. See Checks. |
| `first_seen` | yes | When and at what block height the brain first published the claim. |
| `last_verified` | yes | When, at what height, by which run and how the claim was last re-checked. |
| `run` | yes | The research run that produced the current revision. |
| `related` | no | Claim ids a reader should see next. |
| `supersedes`, `superseded_by` | no | Claim ids, when one claim replaces another. |
| `review` | when gated | Why the gate held it and who let it through: `{ by: evaluator, reasons, at, batch, checks, models }` or `{ by: owner, reasons, at, note }`. |
| `revisions` | yes | The append-only change log. See Revisions. |

### Kinds

- `definition`: what a term means. "A UTXO is ..."
- `fact`: a checkable state of the world. "The block subsidy is 3.125 BTC since block 840,000."
- `mechanism`: how something works. "Nodes recompute the target every 2,016 blocks by ..."
- `event`: something that happened at a time or height.
- `trace`: where an idea lives in specs, code and review history. "BIP 341's signature hash is implemented in Bitcoin Core's `SignatureHashSchnorr` in `src/script/interpreter.cpp`."
- `stance`: a named person's or group's public position, dated, in their own words, linked. Always attributed, never the brain's view. Always gated.
- `argument`: a reason given for or against a proposal or position, attributed to who makes it. Always gated.
- `open-question`: something unresolved, stated as a question with what would resolve it.

### Status

- `established`: the sources agree and nothing credible disputes it.
- `contested`: informed people disagree about it. Every contested claim links the sides.
- `speculative`: a projection, a proposal's claimed effect, or a result not yet reproduced.
- `superseded`: no longer current. Kept, linked to its replacement, shown in the time machine.
- `withdrawn`: the owner withdrew it. Reached only by a `withdrawn` revision with the reason in its
  note, and never left: a fix is a new claim with a new id. Kept with its page and history, left
  out of every topic, list and search.

### Confidence

- `high`: verified against the chain or the code, or supported directly by two or more independent
  T1 or T2 sources.
- `medium`: supported directly by one T1 or T2 source, not mechanically verified.
- `low`: supported only partially, only by T3 or T4 sources, or by inference the verifier accepted.

A claim whose sources are all T3 or T4 carries a visible "media and social sources only" label,
whatever its confidence.

## Sources

```yaml
- tier: T1                # T1, T2, T3, T4 (SOURCES.md)
  kind: bip               # see the list below
  title: BIP 341          # what a reader sees
  url: https://...        # the exact locator
  locator: Specification, Script validation rules   # where inside it, in words
  quote: an exact passage of at most 50 words found at url
  published: 2020-01-19   # optional, when the source said it
  accessed: 2026-11-20    # when the brain read it
  supports: direct        # direct, partial or background
```

| `kind` | Tier | Locator form | How the checker reads it |
|---|---|---|---|
| `bip` | T1 | `github.com/bitcoin/bips/blob/<commit>/bip-NNNN.(mediawiki\|md)`, optional `#anchor` | raw file at that commit |
| `bolt` | T1 | `github.com/lightning/bolts/blob/<commit>/NN-name.md` | raw file at that commit |
| `code` | T1 | `github.com/<org>/<repo>/blob/<commit>/<path>#Lx-Ly` | raw file at that commit |
| `commit` | T1 | `github.com/<org>/<repo>/commit/<commit>` | commit message and metadata (GitHub API) |
| `pr`, `issue` | T1 | `github.com/<org>/<repo>/pull/<n>`, optional `#issuecomment-<id>` or `#discussion_r<id>` | title, body and the named comment (GitHub API) |
| `release-notes` | T1 | release notes file in the repo at a commit, or the project's release page | raw file or page text |
| `mailing-list` | T1 | `gnusha.org/pi/bitcoindev/<message-id>/` or `mailing-list.bitcoindevs.xyz/bitcoindev/<message-id>/`; older posts at `lists.linuxfoundation.org/pipermail/<list>/<yyyy-Month>/<n>.html` | the raw message |
| `delving` | T1 | `delvingbitcoin.org/t/<slug>/<topic-id>/<post-number>` | that post's raw text (Discourse JSON) |
| `chain` | T1 | optional `mempool.space/block/<hash>` for people; the evidence is a `chain.*` check | the chain source |
| `optech` | T2 | `bitcoinops.org/en/newsletters/<yyyy>/<mm>/<dd>/#<anchor>` or `bitcoinops.org/en/topics/<topic>/` | page text |
| `stackexchange` | T2 | `bitcoin.stackexchange.com/a/<answer-id>` or `/q/<question-id>` | the post body (Stack Exchange API) |
| `transcript` | T2 | `btctranscripts.com/<path>`, the locator names the timestamp | page text |
| `paper` | T2 | DOI or stable URL, the locator names section or page | page text; PDFs as extracted text |
| `docs` | T2 | project documentation at a commit or versioned URL | page text |
| `media` | T3 | article URL | page text |
| `social` | T4 | post URL (X, Nostr via a public gateway, Stacker News) | page text when public |

Rules the checker enforces:

1. Git-hosted sources (`bip`, `bolt`, `code`, `release-notes` in a repo) are cited at a 40-hex
   commit, never at a branch name.
2. Every source except `chain` has a `quote`. The quote must be found at the URL after normalizing
   whitespace, quotes and case. A quote that is not found blocks publishing.
3. Quotes are at most 50 words. Blocklore summarizes and links; it does not republish.
4. A claim needs at least one `direct` source. A claim resting only on T3 or T4 sources is labeled
   so on every surface that shows it.
5. Mailing-list posts are cited by message id, which outlives any one archive.

## Checks

Deterministic checks the brain re-runs on every verification. Each one also renders as a command a
reader can run against their own node or clone.

| `type` | Fields | Passes when | Reader's command |
|---|---|---|---|
| `chain.block-hash` | `height`, `expect` | the block at `height` has hash `expect` | `bitcoin-cli getblockhash <height>` |
| `chain.subsidy` | `height`, `expect_sats` | coinbase outputs minus fees equal `expect_sats` | `bitcoin-cli getblockstats <height> '["subsidy"]'` |
| `chain.header` | `height`, `field` (`version`, `time`, `bits`, `nonce`), `expect` | the header field equals `expect` | `bitcoin-cli getblockheader $(bitcoin-cli getblockhash <height>)` |
| `code.contains` | `repo`, `ref`, `path`, `text`, optional `live` | `text` occurs in `path` at commit `ref`; with `live: true`, also on the default branch | `git -C <repo> show <ref>:<path> \| grep -F '<text>'` |
| `bip.field` | `bip`, `field` (`Status`, `Type`, `Layer`, `Title`, `Authors`), `expect` | the BIP's preamble on the default branch has that value | `curl -s <raw url> \| sed -n '1,30p'` |

`live` checks and `bip.field` read the current default branch, so they catch drift: when a BIP's
status changes, the claim fails its check, the brain flags it stale and queues re-research. Pinned
checks prove provenance and never drift.

## Revisions

The claim's top-level fields are its current state. `revisions` is an append-only log from which
any earlier state can be rebuilt (the time machine).

```yaml
revisions:
  - rev: 1
    at: { time: 2026-11-20T15:00:00Z, height: 976744 }
    run: 2026-11-20-seed
    change: created
  - rev: 2
    at: { time: 2026-12-02T09:12:00Z, height: 978420 }
    run: 2026-12-02-daily
    change: corrected
    note: The activation height was right; the date was the median time past, not the block time.
    before: { statement: "... on 12 November 2021." }
```

- `change` is `created`, `corrected` (it was wrong), `refined` (clearer or more precise, same
  substance), `sources` (sources added, replaced or removed), `status`, `confidence`, `depth`,
  `superseded`, `reviewed` or `withdrawn`.
- `before` holds the previous values of exactly the fields that changed.
- `corrected` revisions are the corrections log. Nothing is ever edited without a revision; the
  publisher refuses a claim whose earlier revisions differ from the last snapshot.
- Re-verification that changes nothing updates `last_verified` only and adds no revision.

## Hashing

A claim's hash is SHA-256 over its canonical JSON: keys sorted, no insignificant whitespace, UTF-8,
`last_verified` excluded (re-checking does not change what a claim says). A snapshot lists every
claim's hash and the Merkle root over them in id order: leaf = SHA-256(0x00 || hash), node =
SHA-256(0x01 || left || right), as in RFC 6962. Its file is timestamped with OpenTimestamps and
never rewritten. See ARCHITECTURE.md, "Verifying Blocklore itself", and /verify.

## Topics, proposals, debates

Topics are views:

```yaml
slug: taproot
title: Taproot
lede: taproot.what-it-is
contested: false
safety: false
related: [segwit, covenants]
sections:
  - id: basics
    title: What it is
    depth: curious
    claims: [taproot.what-it-is, taproot.why-it-matters]
```

A topic has no prose beyond its titles; every sentence on the page is a claim. Its ladder (concept,
BIP, code, review history, Optech coverage) is assembled from the sources of its claims.

Proposals (`knowledge/proposals/`) and debates (`knowledge/debates/`) follow the same rule: their
structure is fields, their sentences are claims. Their schemas live in `core/src/schema.ts` beside
the claim's.
