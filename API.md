# The Blocklore API

Blocklore's claims are open to programs as well as people. Everything here is read-only, needs no
key, and allows any origin (CORS). The base is `https://blocklore.space/api/v1`.

Every answer carries an `edition`: the block height and time the store was compiled at, and the
build. Two answers with the same edition come from the same store. Each claim's `url` is the
address to cite.

No license has been chosen for the store yet. Quotes inside sources belong to their authors.

## Endpoints

| Path | What it returns |
| --- | --- |
| `GET /api/v1` | This list, the edition and the license note. |
| `GET /api/v1/claims` | Every published claim in brief: id, url, statement, kind, topics, depth, status, confidence, last verified, counts of sources and checks. |
| `GET /api/v1/claims/{id}` | One claim's whole record: sources with locators and quotes, checks, every revision with what it said before, and where it is shown. |
| `GET /api/v1/topics` | Every published topic: title, group, lede, claim count, how many claims wait for review. |
| `GET /api/v1/topics/{slug}` | One topic: its sections in order, each claim in brief, and the concept to code ladder of its sources. |
| `GET /api/v1/changes?since={height}&limit={n}` | Change events newest first. `since` keeps only events stamped after that block height; `limit` is 1 to 500, default 100. |
| `POST /api/v1/search` | Claims ranked by BM25 for a query. See below. |
| `GET /api/v1/bips` | The BIP index at a commit, each BIP's link at that commit, the claims citing it, and every change seen since the first reading. |
| `GET /exports/claims.jsonl` | Every published claim's whole record, one JSON object per line, in id order. |
| `GET /llms.txt` | A short index for language models (llmstxt.org). |
| `GET /llms-full.txt` | Every published claim as Markdown, topic by topic, with its sources and quotes. |

An unknown id or slug answers 404 with `{"error": "..."}`. Claims held for human review are not in
any answer until the owner approves them; topics report only how many wait.

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

## MCP

`https://blocklore.space/mcp` is a Model Context Protocol server, so an assistant can search and
cite the store as tools. It reads the same store as this API and names the same edition. It is
read-only and needs no key or account.

```sh
claude mcp add --transport http blocklore https://blocklore.space/mcp
```

Other hosts take the same URL as a remote (HTTP) MCP server.

| Tool | What it does |
| --- | --- |
| `search_claims` | `query` (up to 200 characters), `limit` 1 to 50: claims in brief, best first, as `POST /api/v1/search` ranks them. |
| `get_claim` | `id`: one claim's whole record, as `GET /api/v1/claims/{id}`. |
| `list_topics` | Every published topic, as `GET /api/v1/topics`. |
| `get_topic` | `slug`: one topic's sections and claims, as `GET /api/v1/topics/{slug}`. |
| `list_changes` | `since_height`, `limit` 1 to 500: change events newest first. |
| `get_bip` | `number`: one BIP from the index, the claims citing it, and its changes. |
| `list_bips` | `status`, `layer` (both optional): the BIP index, filtered. |

Every result carries `structuredContent` and the same JSON as text. A lookup that finds nothing,
or arguments that do not fit the schema, come back as a tool error the model can read. Every
string argument goes through the secret check above before any tool reads it.

The server speaks protocol revision 2026-07-28, in which each request carries its version and
capabilities in `_meta` and mirrors them in the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
headers. It also serves clients that open with `initialize` (2025-11-25, 2025-06-18, 2025-03-26),
without minting a session. Every answer is one JSON object; no stream is opened, and `GET`
answers 405.

## Examples

What changed since block 976,700:

```sh
curl -s 'https://blocklore.space/api/v1/changes?since=976700&limit=20'
```

One claim with its evidence:

```sh
curl -s https://blocklore.space/api/v1/claims/taproot.activation-height
```

Everything at once, for your own index:

```sh
curl -s https://blocklore.space/exports/claims.jsonl > blocklore-claims.jsonl
```

## Stability and use

Version 1 changes only by adding fields and endpoints. A field is never renamed or given a new
meaning inside v1. Answers are cached for up to five minutes and change when a new edition
deploys.

There is no rate limit today; please fetch the export rather than every claim one by one. A paid
tier for heavy automated use may come with Lightning payments (L402); reading as a person will
stay free.
