# The Blocklore API

Blocklore's claims are open to programs as well as people. Everything here is read-only except
suggestions and reports, needs no key, and allows any origin (CORS). The base is
`https://blocklore.space/api/v1`.

Blocklore runs no model for readers. To have an assistant answer from the claims, connect it to
the [MCP server](#mcp); [/connect](https://blocklore.space/connect) shows the setup for each client.

Every answer carries an `edition`: the block height and time the store was compiled at, and the
build. Two answers with the same edition come from the same store. Each claim's `url` is the
address to cite.

The store is licensed CC BY 4.0 (knowledge/LICENSE): credit Blocklore and link each claim you use, for
example "Blocklore, https://blocklore.space/claims/<id>, CC BY 4.0". The short quotes inside sources
belong to their authors and are included as citations. The code is MIT.

## Endpoints

| Path | What it returns |
| --- | --- |
| `GET /api/v1` | This list, the edition and the license note. |
| `GET /api/v1/openapi.json` | The endpoints as OpenAPI 3.1: paths, parameters, bodies and status codes, for code generators and AI tool frameworks. This page stays the full text of what each answer holds. |
| `GET /api/v1/claims` | Every published claim in brief: id, url, statement, kind, topics, depth, status, confidence, last verified, counts of sources and checks. |
| `GET /api/v1/claims/{id}` | One claim's whole record: sources with locators and quotes, checks, every revision with what it said before, and where it is shown. `at_head` says, for each source pinned at a GitHub commit, whether the quoted passage is still in the file at the repository's head (`current`, `changed` or `gone`, the head commit read, since when): a passage that moved on means the claim holds as of the commit it cites. A claim the owner withdrew comes back with status `withdrawn` and its `withdrawal` (when, why, the run); do not cite it as current. Add `?at={moment}` for the claim as it stood then ([Time machine](#time-machine)). |
| `GET /api/v1/topics` | Every published topic: title, group, lede, claim count, how many claims wait for closer checks. |
| `GET /api/v1/topics/{slug}` | One topic: its sections in order, each claim in brief, and the concept to code ladder of its sources. Add `?at={moment}` for the topic as it stood then ([Time machine](#time-machine)). |
| `GET /api/v1/changes?since={height}&topic={slug}&limit={n}` | Change events newest first. `since` keeps only events stamped after that block height; `topic` only those filed under that topic (404 for a slug that is not one); `limit` is 1 to 500, default 100. |
| `POST /api/v1/search` | Claims ranked by BM25 for a query. See below. |
| `GET /api/v1/queue`, `POST /api/v1/queue` | Reader suggestions: the questions the brain or the owner has triaged and how many wait; suggest a question for research. See below. |
| `GET /api/v1/claims/{id}/reports`, `POST /api/v1/claims/{id}/reports` | Reader reports on one claim: each report's kind, dates, count and what the brain found; report a problem with the claim. See below. |
| `GET /api/v1/reports` | Every reader report and its outcome, newest first, with the claim's statement and counts by outcome. Never a reader's note. |
| `GET /api/v1/bips` | The BIP index at a commit, each BIP's link at that commit, the claims citing it, and every change seen since the first reading. |
| `GET /api/v1/bips/{n}` | One BIP as its page (`/proposals/{n}`) shows it. See [One BIP](#one-bip). |
| `GET /api/v1/bolts` | The Lightning specification's index (BOLT #0) at a commit, each BOLT's link and the SHA-256 of its text there, the claims citing it, and every change seen since the first reading. |
| `GET /api/v1/bolts/{n}` | One BOLT as its page (`/bolts/{n}`) shows it. See [The Lightning specification](#the-lightning-specification). |
| `GET /api/v1/signaling` | The version bits blocks set this difficulty period and the last, counted from both explorers. See [Version bits](#version-bits). |
| `GET /api/v1/debates` | Every published debate map in brief: question, topics, positions with their claim counts, how many shared claims, when it last changed. See [Debate maps](#debate-maps). |
| `GET /api/v1/debates/{slug}` | One debate map as its page (`/debates/{slug}`) shows it. See [Debate maps](#debate-maps). |
| `GET /api/v1/snapshots` | Every snapshot, newest first: block, commit, root, previous root, count, what its OpenTimestamps proof says (the blocks it reaches or the calendars still holding it), and its OrangeCheck `signature` (signer, time, whether the owner stood behind the key), with links to the files. |
| `GET /snapshots/{n}.json`, `GET /snapshots/{n}.json.ots`, `GET /snapshots/{n}.json.stamp` | A snapshot file, its proof and its signature, byte for byte as committed. See [/verify](https://blocklore.space/verify). |
| `GET /orangecheck/{attestations,delegations,revocations}/{id}.json`, `GET /orangecheck/revocations.json`, `GET /.well-known/orangecheck.txt` | The owner's signed records as committed, every revocation in one array, and the domain proof. See [/verify/keys](https://blocklore.space/verify/keys). |
| `GET /api/v1/gaps` | The gap map: per topic, the questions from Blocklore's test set of 200 with known answers that the published claims cover only in part or not at all (placed on the nearest topic by search), depths with fewer than 3 claims, failed rechecks, passages its claims quote that are no longer at their repository's head (`moved`), and claims waiting for closer checks, most open gaps first; plus questions near no topic, search misses, and `advisories`: security advisories no rule files under a threat yet, for the owner to map. See [/gaps](https://blocklore.space/gaps). |
| `GET /exports/claims.jsonl` | Every published claim's whole record, one JSON object per line, in id order; withdrawn claims too, with status `withdrawn`, so a mirror can drop them. |
| `GET /llms.txt` | A short index for language models (llmstxt.org). |
| `GET /llms-full.txt` | Every published claim as Markdown, topic by topic, with its sources and quotes. |
| `GET /.well-known/nostr.json` | NIP-05: `_` and `blocklore` name the key of Blocklore's Nostr channel, `records` the key that carries its OrangeCheck records, each with its relays. Empty `names` until the owner first turns the channel on. See Nostr below. |

An unknown id or slug answers 404 with `{"error": "..."}`. Claims held for closer checks are not in
any answer until they pass; topics report only how many wait.

## One BIP

`GET /api/v1/bips/{n}` answers with what Blocklore's own record holds about BIP `n`, the same data
as its page at `/proposals/{n}` and the MCP tool `get_bip`. Nothing in it is written about the BIP:
each field is the BIP index's or a published claim's.

```sh
curl -s https://blocklore.space/api/v1/bips/341
```

| Field | What it holds |
| --- | --- |
| `url` | The BIP's page on Blocklore. |
| `commit`, `read`, `index` | The bitcoin/bips commit the index was read at, when (time and block height), and the index file at that commit. |
| `bip` | The entry as the index states it at `commit`: `n`, `title`, `layer` (absent when the index gives none), `type`, `status`, `file`, and `url`, the BIP's text at that commit (null while only the number is allocated). Owners are left out: the BIP's text names them. |
| `bip.cited_by` | Every published claim citing the BIP's text, in brief (as `GET /api/v1/claims`), in the order of `topics`. Each carries `marks`: `contested`, `stance` or `argument` when it reports a position, which is attributed to the people in its `attributed_to` and is never Blocklore's own view. |
| `changes` | Every change Blocklore has seen to the entry, oldest first: `field` (`added`, `removed`, `status`, `title`, `type`, `layer`), `before`, `after`, the `commit` that made it and when it was seen (`at`, time and height). |
| `topics` | The citing claims grouped by their primary topic (most claims first), each with its `title` and `url`, then by depth, shallow to deep: `{slug, title, url, depths: [{depth, claims: [id]}]}`. |
| `implementations` | Code, commits and pull requests that the citing claims cite as support (not as background): `{title, url, kind, repo, claims}`, one per file or page, with the ids of the claims that cite it. Empty when no claim cites code. |
| `bitcoin_core` | What Bitcoin Core's own list of the BIPs it implements (`doc/bips.md` in bitcoin/bitcoin) says of the BIP, or null when the list does not name it: `text` (Core's words, links and emphasis taken out), `also_covers` (other BIPs the same entry names, as Taproot's names 340, 341 and 342), `since` (the first version the entry names, as Core writes it), `pull_requests` (`{n, url}`), `source` (the entry's line at `commit`), `commit` and `read` (the first bitcoin/bitcoin commit read with these words, and when), and `changes` (every change seen to Core's words for this BIP: `added`, `removed` or `text`, with `before`, `after`, `commit` and `at`). Core's words, quoted; not a claim and not Blocklore's. |
| `signaling` | Null for most BIPs. For BIP 9 and BIP 320, which define the version bits, `{url, scheme: true, tip, deployments: []}`, where `url` is `GET /api/v1/signaling`; for a BIP whose deployment Bitcoin Core's mainnet chainparams defines (none at v32.1), `deployments` holds its bit's row as `rows` in [Version bits](#version-bits). |

A number the index at `commit` does not list, or one written any other way (a leading zero, a
sign), answers 404 with `{"error"}`.

## The Lightning specification

`GET /api/v1/bolts` answers with BOLT #0, the specification's own index in lightning/bolts, as the
brain last read it at the repository's head: `commit`, `read` (time and height), `bolts` (each
`{n, title, file, hash, url, page, cited_by}`, where `hash` is the SHA-256 of the BOLT's text at
`commit`, `url` that text, `page` its page on Blocklore and `cited_by` the ids of the claims citing
it) and `changes` (each `{n, field, before, after, commit, at}`: `added`, `removed`, `title`, or
`text` when the text's hash changed, with `before` the commit the old text was read at). The first
reading is the baseline. `commit` stays at the first commit read with the current index and texts.

`GET /api/v1/bolts/{n}` answers with one BOLT as its page shows it, the same as the MCP tool
`bolts` with `number`:

```sh
curl -s https://blocklore.space/api/v1/bolts/2
```

| Field | What it holds |
| --- | --- |
| `url` | The BOLT's page on Blocklore. |
| `commit`, `read`, `index` | The lightning/bolts commit BOLT #0 was read at, when, and BOLT #0 at that commit. |
| `bolt` | The entry as BOLT #0 states it at `commit`: `n`, `title`, `file`, `hash`, `url` (its text at that commit) and `cited_by`, every published claim citing the BOLT's file, in brief, with `marks` as in [One BIP](#one-bip). A claim citing the README, an extension draft or a pull request cites no BOLT. |
| `changes` | Every change Blocklore has seen to this BOLT, oldest first. |
| `topics`, `implementations` | As in [One BIP](#one-bip): the citing claims by topic and depth, and the code they cite. |

A number BOLT #0 does not list (there is no BOLT 6), or one written any other way (`02`), answers
404 with `{"error"}`.

## Version bits

`GET /api/v1/signaling` answers with the version bits the blocks of the current difficulty period
have set so far, and the last period's final tally, as `/proposals` shows them (and BIP 9's and BIP
320's pages, and the MCP tool `signaling`). The brain counts them hourly from each block's version,
which mempool.space and blockstream.info must agree on, and the site shows them from its next
deploy. Counts and shares only: Blocklore never says whether a proposal will activate.

```sh
curl -s https://blocklore.space/api/v1/signaling
```

| Field | What it holds |
| --- | --- |
| `signaling` | Null until the brain has counted a period to its tip; otherwise the fields below. |
| `url`, `source`, `period` | The block on `/proposals`, where the versions come from, and the period's length (2016). |
| `updated`, `tip` | When the brain last read the blocks, and the newest block counted: `height`, `hash`, `time` (the block's own timestamp). |
| `current`, `previous` | A period's tally: `start` and `end` heights, `through` (the newest block counted), `blocks` (counted so far), `prefixed` (versions with BIP 9's top bits 001), `bits` (13 counts, bits 0 to 12, of prefixed blocks that set each), `general` (prefixed blocks setting any of BIP 320's bits 13 to 28, which are no signal) and `unprefixed` (versions without the prefix, which BIP 9 reads as all bits 0). `previous` is the period before, complete, or null until the brain has followed one to its end. |
| `rows` | One per bit 0 to 12 any block set in either period: `{bit, current: {blocks, share}, previous: {blocks, share} or null, deployment}`. A share is the percentage of that period's blocks counted, to one decimal. `deployment` is `{name, url, start}` only when chainparams (below) defines one on that bit. |
| `rules` | `bip9`: its page, `prefix_mask` `0xe0000000`, `prefix` `0x20000000` and the `deployment_bits` 0 to 12 left to deployments; `bip320`: its page and its `mask`, `0x1fffe000`. |
| `chainparams` | The deployments Bitcoin Core's mainnet parameters (`CMainParams` in `file`, `src/kernel/chainparams.cpp` since v28) define at its newest `release`, read at the `commit` the release's tag points to, and when (`read`, time and height): `{name, bit, bips, start, url}`, each quoted from the file and linked to its lines; `bips` are those the comment above a deployment names. The brain reads them again within the hour of a new release. At v32.1 the only one is `DEPLOYMENT_TESTDUMMY` on bit 28, start `NEVER_ACTIVE`. Null until the brain has read them. |

It changes when a new edition deploys, like every other answer.

## Debate maps

A debate map lays out one contested question: its positions side by side, the stances and
arguments under each with who holds them, and the claims of fact and definition the sides share
(CLAIMS.md, Debate maps, has the rules a map keeps). `GET /api/v1/debates` lists every published
map in brief; `GET /api/v1/debates/{slug}` answers with one, the same data as its page at
`/debates/{slug}` and the MCP tool `debates`. The question and the position labels are the map's
only words of its own: every other sentence is a published claim. Blocklore takes no side on a
question of values, and the order of the positions is not a ranking.

```sh
curl -s https://blocklore.space/api/v1/debates
```

| Field | What it holds |
| --- | --- |
| `slug`, `url`, `question` | The map's slug, its page and the question it maps. |
| `topics` | The published topics it is filed under: `{slug, title, url}`. |
| `claims` | How many claims are on the map. |
| `updated` | When the map's newest claim last changed: `{time, height}`. |
| `positions` | In brief, `{id, label, claims}` with a count. In one map, `claims` is the position's stances and arguments in brief (as `GET /api/v1/claims`), each with `nature` (`value`), `position`, `holders` (`{name, url, stated}`: who holds it, where, and the date of the cited source at that link when the claim cites one, else null), `supports`, `rebuts`, `supported_by` and `rebutted_by` (claim ids on the map). |
| `empirical`, `definitional` | In brief only: how many shared claims evidence could settle, and how many are about what a word means. |
| `shared` | In one map only: `{empirical, definitional}`, the shared claims in brief with the same fields as a position's (`nature` `empirical` or `definitional`, no `position`). |
| `edges` | In one map only: `{from, to, rel}` with `rel` `supports` or `rebuts`, as the map states them. |

The list is empty until a map has published. A map publishes only once every claim on it has
passed the evaluator. When the owner withdraws a claim, it leaves every map it was on with its
edges; a map that then breaks a rule (a position left with no stance or argument, say) leaves the
list and its slug answers 404 with `{"error"}`.

The owner can also withdraw a whole map. Its claims stay published; the map leaves `debates`, and
the list's `withdrawn` names it with `{slug, url, question, status: "withdrawn", withdrawal}`, where
`withdrawal` is `{at, run, note}`: when, the run that logged it, and the owner's reason. Its slug
answers 200 with the same in `debate`, so links keep working; do not cite it as current.

## Time machine

Every claim keeps its revisions, so Blocklore can show any topic or claim exactly as it stated it
at a past moment. A moment is a block height in digits (`976771`) or a UTC date written
`YYYY-MM-DD` (`2026-11-21`), which means the end of that day. It cannot be later than the store's
edition: a height above `edition.generated.height`, or a date after the day of
`edition.generated.time`, is refused with 400, and so is anything that is not a moment. The error
says what a valid one looks like and never repeats text that was neither a height nor a date.

```sh
curl -s 'https://blocklore.space/api/v1/topics/taproot?at=976771'
curl -s 'https://blocklore.space/api/v1/claims/taproot.activation-height?at=2026-11-21'
```

Both answers carry the `edition` and `as_of`: the moment (`height`, or `date` with `time`, the last
millisecond of that day), `at` as written in a URL, and `url`, the page that shows it
(`/topics/{slug}/at/{moment}`, `/claims/{id}/at/{moment}`; every topic at once is
`/topics/at/{moment}`).

- A topic at a moment has the shape of `GET /api/v1/topics/{slug}`: claims published after the
  moment are absent, each claim is the revision in force then, a claim withdrawn before it is
  absent and one withdrawn after it is shown as it was. The ladder is built from those claims.
  `since` holds the ids of the claims `added`, `revised` and `withdrawn` after the moment, and
  `current`, the topic now. Topics hold no prose and keep no history of their own, so the section
  titles and order are today's; only the claims go back in time. A topic with no claims yet at
  that moment answers with empty `sections` and `claims: 0`.
- A claim at a moment is its whole record as it stood: the statement, status, sources and checks
  then, its revisions up to the moment, its `hash` then (the one a snapshot taken then lists), and
  `last_verified` no later than the moment. `since.revisions` lists the revisions after it (`rev`,
  `change`, `at`, `note`) and `since.current` is the claim now. A claim not published yet at that
  moment is 404 with its `first_seen`; one the owner had withdrawn by then comes back with status
  `withdrawn`.
- Claims in brief carry the `url` of their own page at the same moment, which is the address to
  cite for what Blocklore said then.

A past moment never changes, so these answers are cached until the next edition deploys.

## Search

Search takes its text in a POST body, so the text never lands in a URL that servers and proxies
write to their logs.

```sh
curl -s https://blocklore.space/api/v1/search \
  -H 'Content-Type: application/json' \
  --data '{"q": "taproot key path", "limit": 5}'
```

The body is `{"q": text, "limit": 1 to 50}`, at most 2000 characters. `GET` answers 405 with this
explanation. Results are current claims in brief (superseded ones are left out), each with a
`score`. Ranking is BM25 with prefix matching and light fuzzy matching for longer words; opcodes
such as `OP_RETURN` are one term. The same query on the same edition returns the same list.

A query that looks like a seed phrase, a private or extended key, a descriptor with keys, an address,
a 64-character hex string (a key or a transaction id), a Lightning invoice, a Nostr secret, an email
address or a phone number is refused with 400, and it is neither echoed nor kept. Blocklore never
needs your keys; if you pasted real ones, treat them as exposed.

## Suggestions

Anyone can suggest a question for Blocklore to research, here or in the box on
[/gaps](https://blocklore.space/gaps):

```sh
curl -s https://blocklore.space/api/v1/queue \
  -H 'Content-Type: application/json' \
  --data '{"q": "How do statechains move bitcoin between owners?"}'
```

The body is `{"q": text of at most 300 characters}`, at most 2000 characters in all; any other
field is refused with 400. No model reads it on the site. A question that looks like it holds a
seed, key or address is refused with 400, like search. Links, bare domains, email addresses, Nostr
keys and handles are removed, and what is left must be at least 8 characters. Suggesting a
question again counts rather than adds. Each visitor can suggest 5 a day and the whole site takes
200 a day; past either, the answer is 429 until 00:00 UTC. The result is
`{"queued": true | false, "item"}`: `queued` is false when the question was already there and
now counts once more.

`GET /api/v1/queue` lists the questions the brain or the owner has triaged (`researching` or
`answered`, with the claims that answer it, and a note) and `waiting`, how many are not triaged
yet. Untriaged and declined suggestions are never shown. An item's `missing` field is null for
suggestions; it held Ask's note on questions queued before Ask was removed.

## Reports

Anyone can report a problem with a published claim, here or with "Report a problem" on the
claim's page:

```sh
curl -s https://blocklore.space/api/v1/claims/taproot.activation-height/reports \
  -H 'Content-Type: application/json' \
  --data '{"kind": "outdated", "note": "Bitcoin Core 31.0 changed this."}'
```

The body is `{"kind", "note"}` and at most 2000 characters. `kind` is one of `wrong`,
`outdated`, `unsupported` (the source does not say this), `broken-link` and `unclear`; `note` is
optional, at most 500 characters, and any other field is refused with 400. Every string in the
body goes through the secret check first: one that looks like it holds a seed, key, address,
email address or phone number is refused with 400 and is neither echoed nor kept. Links, bare
domains, Nostr keys and handles are removed from the note. Reporting the same kind on the same
version of a claim again counts rather than adds; once the claim changes, a report opens a new
record. Each visitor can report 5 a day and the whole site takes 200 a day; past either, the
answer is 429 until 00:00 UTC. An unknown or withdrawn claim answers 404. The result is
`{"added": true | false, "report"}`.

The note is for Blocklore's brain and its owner only. No answer from this API, the site or the
feeds ever contains it.

`GET /api/v1/claims/{id}/reports` and `GET /api/v1/reports` return reports as
`{id, claim, kind, hash, at, last, count, status, outcome, updated}`: `hash` is the claim's hash
when it was reported, `at` and `last` the first and latest time readers filed it, and `status`
what became of it:

| `status` | Meaning |
| --- | --- |
| `received` | Waiting for the brain's next recheck, which runs every hour. |
| `holds` | Rechecked: every quote was found at its source and every code and chain check passed. `outcome.checked` says what was checked. |
| `failed` | Rechecked, and something did not hold: `outcome.problems` lists what. The claim is marked on its page and in `GET /api/v1/claims/{id}` (`recheck`) until a correction lands or a later recheck passes. |
| `researching` | A `wrong` or `outdated` report on a claim that still holds: a research session looks for newer or contrary evidence before anything else. |
| `researched` | That session ran; `outcome.changed` says whether it revised the claim (its history then shows what it said before). |
| `dismissed` | The owner dismissed it as abuse. |

`outcome` is null while a report waits; otherwise `{at, run, checked, problems, changed}`, where
`at` is the time and block height of the decision and `run` the run in the research log
(`/log/{run}`) that made it, or null.

## MCP

`https://blocklore.space/mcp` is a Model Context Protocol server, so an assistant can search and
cite the store as tools. It reads the same store as this API and names the same edition. It is
read-only and needs no key or account.

```sh
claude mcp add --transport http blocklore https://blocklore.space/mcp
```

Claude (desktop and web) takes the same URL as a custom connector, Cursor and VS Code take it in
their `mcp.json`, and any other client takes it as a remote (HTTP) MCP server.
[/connect](https://blocklore.space/connect) shows each setup.

| Tool | What it does |
| --- | --- |
| `search_claims` | `query` (up to 200 characters), `limit` 1 to 50: claims in brief, best first, as `POST /api/v1/search` ranks them. |
| `get_claim` | `id`, `at` (optional, a block height or a UTC date): one claim's whole record, as `GET /api/v1/claims/{id}`, or as it stood at that moment, as `?at=`; a withdrawn claim carries a `withdrawn` notice. |
| `list_topics` | Every published topic, as `GET /api/v1/topics`. |
| `get_topic` | `slug`, `at` (optional, a block height or a UTC date): one topic's sections and claims, as `GET /api/v1/topics/{slug}`, or as it stood at that moment, as `?at=`. |
| `list_changes` | `since_height`, `topic`, `limit` 1 to 500: change events newest first, after that block and on that topic when given. |
| `get_bip` | `number`: one BIP as `GET /api/v1/bips/{n}` gives it: the index entry at its commit, the claims citing it with their marks, grouped by topic and depth, the code they cite, and its changes. A number the index does not list is a tool error. |
| `list_bips` | `status`, `layer` (both optional): the BIP index, filtered. |
| `bolts` | `number` (optional): without it, the Lightning specification's index as `GET /api/v1/bolts` gives it; with it, one BOLT as `GET /api/v1/bolts/{n}` gives it. A number BOLT #0 does not list is a tool error. |
| `signaling` | No arguments: the version bits blocks set this difficulty period and the last, as `GET /api/v1/signaling` gives them; a tool error before the brain has counted a period. |
| `get_signatures` | `snapshot` (optional): who signed each edition with OrangeCheck, whether the owner's key stood behind the signing key then, the records and the commands that check them offline. |
| `threats` | `id`, `layer`, `status` (all optional): the threat map, with each threat's advisory count and NVD findings and the advisories still to map; with `id`, one threat with its published claims and mitigations, history, the projects' advisories filed under it (each with the rule that filed it and what matched, `by_words` when words did), its CVE ids checked against NVD (exists, affected products, published, any finding), watches, and its lab tests each with its `project` (`bitcoin-core` or `lnd`) and its result on every release of that project the lab tests (`ok` null where that release's run did not have the test). |
| `watches` | `id` (optional): each security watch's status, value, thresholds, source and recent readings; and `lab`, the lab's run on the newest release of each maintained Bitcoin Core major, newest first, then on LND's newest release and LDK's, each with its `project` (`bitcoin-core`, `lnd` or `ldk`; when, verified, passed of run, each test; libsecp256k1's own test programs are named `secp256k1/tests`, `secp256k1/noverify_tests` and `secp256k1/exhaustive_tests`, LND's unit test packages `lnd/contractcourt` and so on, LDK's test modules `ldk/ln/monitor_tests` and so on, an LND run's `verified` counts its maintainers' signatures over the release's signed manifest, and an LDK run's says whether the source is the commit its release tag names (`sha256`) and whether the tag's one signature was good (`signatures` 0 or 1) by one of the `signers` keys its SECURITY.md lists). |
| `debates` | `slug` (optional): every published debate map in brief, as `GET /api/v1/debates`; with `slug`, one map as `GET /api/v1/debates/{slug}`, each position's stances and arguments with their holders and dates, the shared claims of fact and definition, and the edges. A map the owner withdrew answers with `status` `withdrawn` and its `withdrawal`; an unknown slug is a tool error. |
| `safety_desk` | `model` (optional): the Safety Desk as [/safety](https://blocklore.space/safety) shows it: the threats to a person who holds bitcoin by threat model, and the common scam patterns, each threat with the published claims that explain it and what defends against it (urls to cite) and `being_researched` for the parts no claim covers yet; with `model`, one threat model. |
| `gaps` | `topic` (optional): what Blocklore does not cover yet, as `GET /api/v1/gaps`: per topic, questions its claims answer only in part or not at all, thin depths, failed rechecks, sources moved on at head that research has not taken up yet, threats no claim explains and claims waiting for closer checks; without `topic`, also questions near no topic and advisories not yet filed under a threat. |

Every result carries `structuredContent` and the same JSON as text. A lookup that finds nothing,
arguments that do not fit the schema, or an `at` that is not a moment the store can show come back
as a tool error the model can read; for `at`, it says what a valid moment looks like. Every
string argument goes through the secret check above before any tool reads it.

The server speaks protocol revision 2026-07-28, in which each request carries its version and
capabilities in `_meta` and mirrors them in the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
headers. It also serves clients that open with `initialize` (2025-11-25, 2025-06-18, 2025-03-26),
without minting a session. Every answer is one JSON object; no stream is opened, and `GET`
answers 405.

## Nostr

Blocklore also posts to Nostr, so what it learns reaches people without the site. Follow
`_@blocklore.space` (shown as `blocklore.space`) in any Nostr client; `/connect#nostr` has the npub
and the relays while posting is on.

| Kind | What it carries |
| --- | --- |
| 30023 | The day's digest (NIP-23), `d` = the date: the same changes as `/digest/{date}`, corrections first, then new claims by topic, then other revisions. Each claim is a line with its statement, its link (`/claims/{id}`) and its sources' links. Tags: `title`, `summary`, `published_at`, `t` = `bitcoin`, `r` = the digest's URL. |
| 1 | An edition sealed in a Bitcoin block (its count, Merkle root and block, with `/snapshots/{n}.json`); a security watch's change of state; a lab run that passed. Each links to its page. |
| 0, 10002 | The profile (`bot: true`) and the relay list. |

Code builds every note from published claims; no model writes one, and nothing the disclosure gate
or the embargo holds is posted. A note is the site's own words about its claims: cite the claim it
links to, not the note. Every note is signed by the key `/.well-known/nostr.json` names, and each
claim it links to carries its hash under a snapshot's Merkle root (/verify).

## Examples

What changed since block 976,700:

```sh
curl -s 'https://blocklore.space/api/v1/changes?since=976700&limit=20'
```

One claim with its evidence:

```sh
curl -s https://blocklore.space/api/v1/claims/taproot.activation-height
```

The same claim as it stood when snapshot 1 was taken, at block 976,771:

```sh
curl -s 'https://blocklore.space/api/v1/claims/taproot.activation-height?at=976771'
```

Everything at once, for your own index:

```sh
curl -s https://blocklore.space/exports/claims.jsonl > blocklore-claims.jsonl
```

## Stability and use

Version 1 changes only by adding fields and endpoints. A field is never renamed or given a new
meaning inside v1. One exception, by the owner's decision on 2026-11-21: Blocklore stopped running
a model for readers, so `POST /api/v1/ask` and `GET /api/v1/scorecard` are gone (404), and
`POST /api/v1/queue` takes `{"q"}` alone (the Ask ticket it used to require is refused with 400).

Answers are cached for up to five minutes and change when a new edition deploys.

Reading has no rate limit today; please fetch the export rather than every claim one by one. Reading
stays free for everyone, people and programs alike: Blocklore does not charge for the API, the
export, MCP or the feeds, and asks for no account or key.
