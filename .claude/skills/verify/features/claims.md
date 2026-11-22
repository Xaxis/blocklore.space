# Claims

A reader sees one claim with every source and quote, the command to repeat each check, its full revision history, its hash and where it is shown.

<!-- covers: page:/claims/[id] -->

## Sub-features

- evidence: sources with tier, kind, support, quote, locator and read date; checks with `checkMeaning` and `readerCommand`, each with a Copy button.
- history: one entry per revision, newest first, with `before` shown struck through.
- record: id, SHA-256 hash (canonical JSON without last_verified), first seen, last checked, snapshot, "How it was approved" in plain words (by the evaluator: its checks, the two models, the batch's run log; or by the owner, with the note), the YAML file on GitHub.
- withdrawn: a claim the owner withdrew keeps its page (`getWithdrawn`, also in `generateStaticParams`), titled "Withdrawn: ...", `noindex`, with a callout giving the date, block, the owner's reason and the run; the history shows a "Withdrawn" revision. `/api/v1/claims/<id>`, `get_claim` (with a `withdrawn` notice) and `/exports/claims.jsonl` return it with status withdrawn; topics, lists, search and stats leave it out.
- related: links to published related claims only (links to held claims light up once approved).

## How to reach it

- "Claim page, history and hash" inside an opened claim; the "Checked at block" margin link; a change log or run page entry; `/claims/<topic>.<slug>`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core hash and replay tests).

Runtime:

```sh
curl -s localhost:3721/claims/halvings-and-supply.first-halving | grep -oE 'bitcoin-cli getblockhash 210000|bitcoin-cli getblockstats 210000|Published</strong>|[0-9a-f]{64}' | sort -u
node --input-type=module -e "import {claimHash} from './core/src/index.ts'; import {loadStore} from './core/src/node/index.ts'; const c=loadStore().store.claims.find(c=>c.id==='halvings-and-supply.first-halving'); console.log(claimHash(c))"
```

Proves it when: the page shows the reader commands and "Published", and the 64-hex hash on the page equals the one `claimHash` prints from the store.

## Gotchas

- Ids contain a dot; that is fine in the route.
- A claim not on any topic says "Not shown on a topic page"; compile warns about it.
