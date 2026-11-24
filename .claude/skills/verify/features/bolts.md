# BOLTs

A reader opens the Lightning Network's specification as its own index lists it, sees which Blocklore claims cite each BOLT, and opens a page per BOLT with only what Blocklore's own record holds, including each change seen to the BOLT's text.

<!-- covers: page:/bolts, page:/bolts/[n], api:GET /api/v1/bolts, api:GET /api/v1/bolts/[n], cli:boltcheck -->

## Sub-features

- the index: `knowledge/bolts.json` (core's `BoltIndex`: `commit`, `read`, `bolts` of `{n, title, file, hash}`, `changes` of `added`, `removed`, `title` or `text`), written by the hourly `bolts` step and `pnpm brain bolts` (`brain/src/bolts.ts`, `parseBoltIndex`, `diffBolts`, `refreshBolts`) from BOLT #0 (`00-introduction.md`) at lightning/bolts' head: its heading is BOLT 0, each `N. [BOLT #N](NN-name.md): Title` line one BOLT (there is no BOLT 6), and `hash` is the SHA-256 of the file's text at the commit, so a text change is seen when the index line is not. Written only when the index or a text changed; the first reading is the baseline. A text change records the commit the old text was read at in `before`. Carried as `bundle.bolts`.
- citations: `bundle.boltCitations` maps each BOLT to the current claims citing its file (`boltOf` in `core/src/boltview.ts` reads `NN-name.md` from a lightning/bolts link; the README, extension drafts like `bolt-simple-taproot.md` and pull requests are no BOLT).
- `/bolts`: a table of every BOLT, its title linked to its page, the changes seen and the claims citing it, with the index's commit and when it was read.
- a BOLT's page, `/bolts/<n>` for every BOLT the index lists (static, `dynamicParams = false`), built by `core/src/boltview.ts` from the bundle: the title as BOLT #0 states it, links to the index and the text at the commit, the text's SHA-256; "Claims that cite it" and "In code" from `web/components/CitingClaims.tsx`, the same component and grouping (`citingGroups` in `core/src/bipview.ts`) a BIP's page uses; "In the specification": each recorded change, a text change linking GitHub's compare of the two commits. A BOLT nothing cites says "Blocklore has no claims citing this BOLT yet." with a link to `/gaps#suggest-block`.
- one address per BOLT: `/bolts/02`, `/bolts/6` and `/bolts/abc` are 404.
- the same data as JSON at `GET /api/v1/bolts` and `GET /api/v1/bolts/<n>` (API.md, "The Lightning specification"; 404 with `{"error"}` for a number the index does not list) and from the MCP tool `bolts` (no number: the index; a number: one BOLT; a tool error for one the index does not list).
- links in: the bar ("BOLTs" under Knowledge), every claim's BOLT sources ("BOLT n on Blocklore", in `Evidence`), the sitemap (one URL per BOLT).

## How to reach it

- Bar: Knowledge, "BOLTs"; `/bolts/2` directly; a claim's BOLT source, e.g. `/claims/lightning.bolts-specification`.
- `GET /api/v1/bolts`, `GET /api/v1/bolts/2`, the MCP tool `bolts`.
- The brain's side: `pnpm brain bolts --no-commit` (prints `bolts: unchanged at <sha>` when the head has not moved, else what it read).

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/boltview.test.ts: `boltOf` on BOLT files and nothing else, citations without superseded claims, the view's entry, text links and history oldest first, the same grouping as a BIP's view, an uncited BOLT and BOLT 6, and every BOLT in the committed store; brain/test/bolts.test.ts: the parser over real lines of BOLT #0, readings that throw, the four kinds of change, and the step: a baseline first reading, nothing read at the same head, nothing written when a new head changed nothing, one `text` change when a file changed).

Runtime, against a running site (any port; examples use 3721; it reads lightning/bolts from raw.githubusercontent.com, so it needs the network):

```sh
node .claude/skills/verify/boltcheck.ts http://localhost:3721
~/.claude/claude-core/bin/heavy node tools/axe.ts http://localhost:3721 /bolts /bolts/2 /bolts/8
~/.claude/claude-core/bin/heavy node tools/shots.ts OUT http://localhost:3721 /bolts /bolts/2
python3 -I -c "import json;d=json.load(open('knowledge/bolts.json'));print(d['commit'][:10],[b['n'] for b in d['bolts']],len(d['changes']))"
```

Proves it when boltcheck ends `boltcheck: all checks passed`, having checked for each BOLT: BOLT #0 at the pinned commit says its title in its own line, the SHA-256 of the text GitHub serves at that commit is the recorded hash, `/bolts` links its page, the page's title is the index's and links the text, the page, the answer and the index hold the same claims (each citing the BOLT's file and on the page), the same code and the same changes, the page's only parts are claims, code and history, and `bolts` with its number returns the answer's data; `bolts` with no number returns the API's index; `/bolts/6`, `/bolts/02` and `/bolts/abc` are 404, `/api/v1/bolts/6` is 404 with an error and `bolts 6` a tool error; the bar links `/bolts`, a claim citing a BOLT links its page, and the sitemap lists one page per BOLT. At lightning/bolts `191462825a` the index lists BOLTs 0 to 5 and 7 to 12. axe reports no violations. In the shots the BOLT page reads as a BIP's does.

## Gotchas

- `boltOf` reads only `NN-name.md` files: a claim citing `bolt-simple-taproot.md` or a pull request is not on any BOLT's page, by design (they are not BOLTs yet).
- `commit` stays at the first commit read with the current index and texts, so a head move that changes no BOLT (a README edit) writes nothing and the links stay at the older commit, whose texts are the same.
- The step fetches all thirteen files once per new head (cached a year by URL, which holds the commit), so an unchanged head costs one `git ls-remote`.
