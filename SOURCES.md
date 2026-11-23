# Sources

The registry of where Blocklore reads, how much weight each source carries, and how the brain
fetches it. The machine-readable copy is the source kinds in `core/src/schema.ts`, their default
tiers in `core/src/validate.ts` and the feeds the brain polls in `brain/src/ingest.ts` (`ADAPTERS`).
A change to this file or to them is a change to both, proposed as a pull request for the owner's
review (the brain never edits its own source list).

Every URL and license below was checked on 2026-11-20.

## Tiers

| Tier | What | Can support a claim alone? |
|---|---|---|
| T1 primary | The specification, the code, the place the author said it, the chain itself | Yes |
| T2 expert secondary | Careful technical summaries and Q&A by people who read the primaries | Yes, and the brain prefers to add the primary it summarizes |
| T3 media | Journalism and general-audience writing | Yes, but the claim is labeled "media and social sources only" when it has nothing better |
| T4 social | X, Nostr, Stacker News, Reddit, chat | Never alone. A signal of what to investigate |

A source's tier is set by what it is, not by who wrote it: a core developer's tweet is T4, a
first-time poster's mailing-list message is T1 for the fact that they said it. Who said it matters
to the verifier's judgment of support, not to the tier.

## T1 primary

| Source | What we take from it | Fetch method | Cadence | License and terms |
|---|---|---|---|---|
| BIPs repository, `bitcoin/bips` | BIP texts and preambles (status, type, layer), new and changed BIPs, BIP pull requests | git mirror for commits; raw files at a commit; PRs through the REST API when a claim cites one | hourly | Each BIP states its own license in its preamble; we quote short passages with attribution |
| Bitcoin Core, `bitcoin/bitcoin` | Merged PRs, releases and release notes, the code at a commit | git mirror for merges and release tags; raw files at a commit; PRs through the REST API when a claim cites one | hourly (tags every 6 hours) | MIT |
| Bitcoin Knots, `bitcoinknots/bitcoin` (default branch `29.x-knots`) | Policy and release differences from Core | git mirror for release tags (default branch read at poll time); raw files at a commit | every 6 hours | MIT |
| btcd `btcsuite/btcd`, Floresta `getfloresta/Floresta`, libsecp256k1 `bitcoin-core/secp256k1` | Alternative implementations and the signature library | raw files at a commit, on demand (not polled yet) | on demand | ISC; see repository; MIT |
| Bitcoin Inquisition, `bitcoin-inquisition/bitcoin` | Soft-fork proposals deployed on signet | git mirror of branch `29.x`; raw files at a commit | daily | MIT |
| BOLTs, `lightning/bolts` | The Lightning specification | git mirror; raw files at a commit | daily | See repository |
| LND, Core Lightning, Eclair, LDK (`lightningnetwork/lnd`, `ElementsProject/lightning`, `ACINQ/eclair`, `lightningdevkit/rust-lightning`) | Lightning implementations, releases | raw files at a commit, on demand (not polled yet) | on demand | MIT; see repository; Apache-2.0; see repository |
| Cashu NUTs and Nutshell (`cashubtc/nuts`, `cashubtc/nutshell`) | The Cashu ecash specification and reference mint | raw files at a commit, on demand (not polled yet) | on demand | MIT |
| Ark: arkd (`arkade-os/arkd`, formerly `ark-network/ark`) | An Ark implementation | raw files at a commit, on demand (not polled yet) | on demand | MIT |
| bitcoindev mailing list | Protocol discussion since 2024 (hosted on Google Groups) | Atom feed of the public-inbox mirror, `https://gnusha.org/pi/bitcoindev/new.atom`, with `https://mailing-list.bitcoindevs.xyz/bitcoindev/new.atom` as fallback; raw messages by message id | hourly | Authors' copyright; summarize and link, short quotes |
| bitcoin-dev and lightning-dev archives (Linux Foundation, to early 2024) | Historical discussion | `https://lists.linuxfoundation.org/pipermail/<list>/` pages, read on demand | on demand | Authors' copyright |
| Delving Bitcoin | Protocol, Lightning and mining research discussion | Discourse JSON: `/latest.json`, `/posts.json`, posts by `/posts/by_number/<topic>/<n>.json` | hourly | Authors keep copyright and license the forum only (its terms of service); summarize and link, short quotes |
| The chain | Heights, hashes, headers, subsidy, version-bit signaling | `ChainSource`: today the Esplora pair `mempool.space/api` and `blockstream.info/api`, which must agree; Bitcoin Core RPC when the owner provides a node | every new block | Public data |

Sources of the security watch (ARCHITECTURE.md, SECURITY.md T9). All public, read at the rates
above; nothing is probed or tested but a local regtest.

| Source | What we take from it | Fetch method | Cadence | License and terms |
|---|---|---|---|---|
| Bitcoin Core security advisories | Disclosed vulnerabilities, each with its severity | RSS `https://bitcoincore.org/en/rss.xml`, disclosure items only | every 6 hours | MIT (site content); titles and links |
| GitHub security advisories of `bitcoin/bitcoin`, `lightningnetwork/lnd`, `ElementsProject/lightning`, `ACINQ/eclair`, `lightningdevkit/rust-lightning` | Published advisories, severity, publication date | REST `/repos/<owner>/<repo>/security-advisories` (public, no token needed) | daily | GitHub terms; titles and links |
| NVD (NIST's National Vulnerability Database) | For every CVE id the threat map or an advisory names: whether the record exists, its status, its publication date, the products its CPE data and the CNA list as affected; its description only to check which product it names, never shown | CVE API 2.0, `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=<id>`, no API key, at most one request every 6.5 seconds (the public limit is 5 in 30 seconds), each record asked again a day after NVD lacked it, a week while it is being analyzed, otherwise a month | with the advisories watch, every 6 hours, 8 records at most | Public data (U.S. government work); ids, dates and product names |
| mempool.space mining API | Which pool mined each recent block | `/api/v1/mining/pools/1w` | hourly | Public data |
| btcnodes.io (formerly Bitnodes) | The user agents of reachable nodes, for the share on versions past end of life | `/api/v1/snapshots/latest/`, one request a day | daily | Public data; counts only, no addresses kept |
| Bitcoin Core release files | `SHA256SUMS`, its builder signatures (`guix.sigs`), the release archive for the lab | `bitcoincore.org/bin/bitcoin-core-<version>/`; release tags with `git ls-remote` | weekly | MIT |

## T2 expert secondary

| Source | What we take from it | Fetch method | Cadence | License and terms |
|---|---|---|---|---|
| Bitcoin Optech newsletters and topics | Weekly technical summaries, the topic index, links to primaries | RSS `https://bitcoinops.org/feed.xml`; pages; repository `bitcoinops/bitcoinops.github.io` | hourly | MIT. Optech's About page: "all materials and documentation produced are released under the MIT license". (The founding brief said CC BY-SA; the source says otherwise, and we follow the source.) We still attribute and quote briefly. |
| Bitcoin Stack Exchange | Expert answers to precise questions | Stack Exchange API 2.3, `site=bitcoin` | hourly | CC BY-SA, version by post date; attribute the author and link the post |
| Bitcoin Transcripts (Bitcoin Dev Project) | Talks and podcasts, with timestamps | Repository `bitcointranscripts/bitcointranscripts` (GitHub API, new files) and `btctranscripts.com` pages | daily | Repository is MIT; speakers' words are theirs; quote briefly with timestamp |
| Bitcoin TLDR (Bitcoin Dev Project) | Summaries of mailing-list and Delving threads, used to find threads, never cited instead of the thread | `https://tldr.bitcoinsearch.xyz/` pages | daily | See site; we cite the underlying thread |
| Academic papers | Peer-reviewed and preprint research (IACR ePrint, arXiv, Financial Cryptography) | arXiv API query, ePrint listing, read on demand | weekly | Per paper; quote briefly |
| Expert research blogs | Measurements and analysis with published data and methods (for example 0xB10C's blog and mempool.space research) | RSS or pages, added one by one by pull request | weekly | Per site |
| learnmeabitcoin.com | Careful technical explanations, useful at the Builder level | Pages, on demand | on demand | See site |
| Official statistics | Crime and fraud reports for the Safety Desk (FBI IC3 annual reports, FTC data) | Report pages and PDFs, on demand | on demand | Public |
| Physical attack incident list, `jlopp/physical-bitcoin-attacks` | An index of reported physical attacks, each linking its media source | Repository (GitHub API) | weekly | Unlicense; each incident is cited by its own media source (T3) |

## T3 media

General and trade press (for example Bitcoin Magazine, CoinDesk, The Block, Reuters, AP). Used for
events with no primary record (an arrest, a court ruling, an exchange failure), always with the
primary added when one exists (the court filing, the company's statement). Read on demand, never
polled.

## T4 social

X, Nostr, Stacker News (`https://stacker.news/rss`), Reddit. The brain may watch them for signals of
what to investigate. A T4 item never supports a claim by itself; a stance claim may cite a person's
own post only when the post is the person saying it, and then the claim says where they said it.

## How the brain fetches

- **Identifies itself.** User-Agent `BlockloreBot/0.1 (+https://blocklore.space/about#bot)`. No
  personal contact details.
- **Polite.** At most one request per second per host, or the host's `Crawl-delay` when it asks for
  more (gnusha.org asks for 10 seconds), conditional requests (ETag, If-Modified-Since) where the
  server supports them, backoff on 429 and 5xx, and a disk cache so re-running a check costs the
  host nothing.
- **robots.txt.** Read before any page on a host and obeyed for BlockloreBot (RFC 9309 matching;
  `brain/src/robots.ts`). A missing robots.txt allows everything; one that cannot be read blocks the
  host until it can. APIs (`api.*` hosts and `/api/` paths) are services, not pages, and are exempt.
  GitHub's robots.txt closes its Atom feeds and commit lists to bots, so the brain does not use
  them.
- **GitHub** history comes from treeless git mirrors in `var/git/` (commits and tags only, about 40
  MB for Bitcoin Core), updated with `git fetch`; files come from `raw.githubusercontent.com` at a
  commit; branch heads from `git ls-remote`. None of these spend the GitHub API quota, which is
  shared with the owner's other tools. The REST API is used only to read a cited PR, issue or
  commit, with a token only when `GITHUB_TOKEN` is set, and falls back to the public page.
- **The research role** reads through Claude Code's own WebFetch and WebSearch tools, not through
  this client, so those fetches carry Anthropic's fetcher identity and rules. Everything the role
  cites is fetched again by this client when it is checked.
- **Cursors.** Each adapter keeps a cursor (last id, last date or ETag) in `var/inbox/<id>.cursor`,
  so a missed hour catches up and nothing is read twice.
- **Untrusted.** Every fetched byte is data. Hidden text (zero-size, `display:none`, HTML comments,
  zero-width characters) is stripped before a model sees it, and the strip is logged. See
  SECURITY.md.
- **Pinned.** When a claim cites a git-hosted source, the brain resolves the branch to a commit at
  fetch time and cites the commit.
- **Archived (planned).** For non-git T2 and T3 locators, the publisher will ask the Wayback
  Machine to save the page when the claim first publishes, so a reader can still check it if the
  page moves. Not built yet; BACKLOG.md tracks it.

## Adding or demoting a source

Proposed by pull request with: what it covers that the registry lacks, its tier and why, its
license, a fetch method, and three example items. Demotion (for example a site found to plagiarize
or to fabricate) is a correction: the claims that rested on it are re-verified and any that lose
their only direct support are marked and queued.
