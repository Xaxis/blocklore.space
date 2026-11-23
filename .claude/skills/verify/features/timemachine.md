# Time machine

A reader, a program or an assistant sees a topic or a claim exactly as Blocklore stated it at a past block height or UTC date, with what has changed since.

<!-- covers: page:/topics/[slug]/at/[moment], page:/claims/[id]/at/[moment], page:/topics/at/[moment], api:GET /topics/[slug]/at, api:GET /claims/[id]/at, api:GET /topics/at, cli:timemachine -->

## Sub-features

- engine: `core/src/replay.ts`. `parseAsOf` reads a moment (digits for a height, `YYYY-MM-DD` for the end of a UTC day) and refuses anything past the bundle's `generated` stamp, never repeating text that was not a moment; `claimAsOf` and `claimAtRevision` undo later revisions; `topicAsOf` gives a topic's claims then (created later: absent; revised later: the revision in force; withdrawn before: absent; withdrawn after: as it was) and `since` (ids added, revised, withdrawn); `heightDay` names the day a block came from the store's own stamps. `core/src/bundle.ts`: `bundleClaimAsOf` (the hash then from `hashes`, one per revision, the weak-sources label, a recheck or withdrawal only once it happened, `last_verified` no later than the moment) and `writtenTopics` (topics as written, withdrawn claims and all).
- reads: `web/lib/asof.ts` (`readAsOf` runs `detectSecrets` first, then `parseAsOf` against the edition; `topicAt`, `claimAt`, `asOfTitle`), `web/lib/api.ts` (`claimAtJson`, `topicAtJson`).
- pages: `/topics/<slug>/at/<moment>` and `/claims/<id>/at/<moment>` render through the live pages' components (`web/components/TopicView.tsx`, `ClaimView.tsx`) with `AsOfNotice` ("As of block N, <day>" or "As of the end of <day> (UTC)", the counts since, "See it now"); claim links, related topics and crumbs stay at the same moment; a topic with nothing yet says so in an `.empty` box; a claim not yet published says "Not published yet". `/topics/at/<moment>` is every topic then (`TopicTable` with rows). Rendered on first request and kept until the next deploy (`dynamicParams`, `revalidate = false`); each sealed edition's height prerenders. All `noindex`. A bad slug, id or moment is a 404 that says what a moment is (`AsOfMissing`).
- controls: `AsOfForm` in the rail of every live and as-of topic and claim page and the as-of index ("As it stood", "Another moment"): with script it moves in the app; without, `GET <base>/at?moment=` redirects (303) to the page, after `momentText` drops spaces, commas and a leading "block". `/verify` links each edition's "Every topic as of block H".
- api: `GET /api/v1/claims/<id>?at=` and `/api/v1/topics/<slug>?at=` (the routes are now per request; plain answers `s-maxage=300`, as-of answers `s-maxage=86400`), 400 for a bad moment, 404 for a claim not yet published (with `first_seen`). Documented in API.md, "Time machine".
- mcp: `get_claim` and `get_topic` take `at` (string or number); a bad one is a tool error with the help text.

## How to reach it

- The "As it stood" form at the foot of the rail on `/topics/<slug>` and `/claims/<id>`; "Every topic as of block H" on each snapshot at `/verify`; `curl` with `?at=`; the MCP tools.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/replay.test.ts: parsing and refusals, the end of a day, a revised claim, a topic with a claim created later, revised later, withdrawn before and after, hashes per revision, `bundleClaimAsOf`, `heightDay`).

Runtime, against a server (a production build behaves as Vercel does; `next dev` works too):

```sh
heavy pnpm build && (cd web && npx next start --port 3724)    # in the background
node .claude/skills/verify/timemachine.ts http://localhost:3724
```

Proves it when: it prints `timemachine passed` after 44 `ok` lines (with 8 topics and 4 claims newer than snapshot 1; one line per topic and per newer claim): every topic is empty one block before the first claim with all its claims "added since"; every claim snapshot 1 sealed comes back at the snapshot's height with the hash it sealed, and claims published later are 404 there; the topics at that height show only sealed claims, each `url` at the same moment, `s-maxage=86400`; a date answers as of the end of that day; a height past the edition, a date after it, garbage, a date not on the calendar and an xprv are 400 on both routes, never echoed; the pages name the moment, show the right number of claims, say "published no claims on this topic yet" and "Not published yet", and the index links every topic at the moment; bad moments and slugs are 404 pages that say what a moment is; the three `?moment=` forms redirect 303; the live topic and claim pages carry the form; `/verify` links each edition's height; MCP `get_topic` and `get_claim` with `at` agree with the API and a bad `at` is a tool error. It also says whether a published claim has a revision yet; until one does, the core test is the only proof of a revision undone.

By eye: `heavy node tools/shots.ts OUT http://localhost:3724 /topics/halvings-and-supply/at/976771 /topics/halvings-and-supply/at/976752` (the notice under the header, the dial and claims; the empty box), and the rail's form on `/topics/halvings-and-supply` scrolled into view at desk and phone, light and dark. On a production server, a second request for an as-of page answers `x-nextjs-cache: HIT`.

## Gotchas

- Topics keep no history of their own: an as-of topic uses today's section titles and order, and only its claims go back in time. The scene beside the panel shows the store now.
- `/topics/at/...` is the as-of index, so no topic can have the slug `at`; the scene maps it to the Knowledge view (`viewFor`).
- `last_verified` at a moment before the newest recheck becomes the revision's own publication ("checked when this revision was published"): rechecks leave no history.
- The edition is the store's newest stamp (`bundle.generated`), not today's date; a moment past it is refused even if the chain has moved on.
