# Proposals

A reader tracks every consensus BIP by status, sees which Blocklore claims cite each, searches the whole BIP index, and opens a page per BIP with only what Blocklore's own record holds.

<!-- covers: page:/proposals, page:/bips, page:/proposals/[n], api:GET /bips/[n], api:GET /api/v1/bips/[n], cli:bipcheck -->

## Sub-features

- tracker: consensus BIPs from `knowledge/bips.json` in four groups (soft forks in progress, deployed soft forks, hard fork proposals, closed soft forks), each row's title linked to its page, with its status chip and the claims citing it (a disclosure listing them).
- index: all BIPs with a text filter (number, title, layer) and a status select; state in memory only; each title links to its page.
- a BIP's page, `/proposals/<n>` for every BIP in the index (static, `dynamicParams = false`), built by `core/src/bipview.ts` from the bundle: the entry (title, layer, type, status) as the index states it at its commit, with links to the index and the BIP's text at that commit; "Claims that cite it" grouped by primary topic (most claims first) then depth, each a ClaimLine, with contested claims, stances and arguments marked (a status chip, and a Stance or Argument chip naming who it is attributed to on hover); "In code": the code, commits and pull requests those claims cite as support, each with the claims citing it (no claim, no line); "In the index": the recorded changes to the entry with commit, time and block. A BIP nothing cites says "Blocklore has no claims citing this BIP yet." with a link to `/gaps#suggest-block`. No signaling part: the store records none.
- `/bips/<n>` answers 308 to `/proposals/<n>`; a number written any other way (`0341`, `abc`) is 404, so every BIP has one address.
- the same data as JSON at `GET /api/v1/bips/<n>` (API.md, "One BIP"; 404 with `{"error"}` for a number the index does not list) and from the MCP tool `get_bip` (a tool error for one it does not list). Reach counts it as `api:bip`.
- links in: `/proposals` and `/bips` rows, Pulse's and each digest's BIP index changes, every claim's BIP sources ("BIP n on Blocklore", in `Evidence`), and the sitemap (one URL per BIP).
- no owners: the index's owner column is never stored or shown; the page says the BIP's text names them.

## How to reach it

- Nav "Proposals"; "The proposal tracker" on Pulse; "The whole index" on the tracker; `/bips`; a row's title; a claim's BIP source; `/proposals/341` directly.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/bipview.test.ts: the view from a compiled store, grouping and reading order, marks, code only from citing claims, empty and unknown BIPs, and every BIP in the committed store; core/test/reach.test.ts: `api:bip`; brain/test/bips.test.ts).

Runtime, against a running site (any port; examples use 3721):

```sh
node .claude/skills/verify/bipcheck.ts http://localhost:3721            # BIPs 341 141 119 333 and 9999
node .claude/skills/verify/bipcheck.ts http://localhost:3721 54 342     # any others
curl -s localhost:3721/proposals | grep -oE '<h2[^>]*>(Soft forks in progress|Deployed soft forks|Hard fork proposals|Closed soft forks)</h2>'
curl -s localhost:3721/bips | grep -o '<tr>' | wc -l
python3 -I -c "import json;print(len(json.load(open('knowledge/bips.json'))['bips']))"
curl -s localhost:3721/bips | grep -c 'Poinsot'
~/.claude/claude-core/bin/heavy node .claude/skills/verify/bipfilter.ts
~/.claude/claude-core/bin/heavy node tools/shots.ts OUT http://localhost:3721 /proposals/341 /proposals/119
```

Proves it when: bipcheck prints `bipcheck: all checks passed`, having printed for each BIP the page's title and status beside the API's entry, its topics by depth, its code and its changes; for each: the page's title and status chip are the index's, its text is linked at the index's commit, the page and the API hold the same claims (every one citing the BIP's text), the same code (each line from such claims) and the same changes, the only parts are claims, code and history, and `get_bip` returns exactly the API's JSON; BIP 119 says "Blocklore has no claims citing this BIP yet." with the `/gaps` link; BIP 333 shows its `added` change; 9999 and `0341` are 404 and 9999 is a tool error; `/bips/341` is a 308 to `/proposals/341`; `/proposals`, `/bips` and a claim citing BIP 341 link `/proposals/341`; the sitemap lists one page per BIP. The group headings print once each; `/bips` has one row per BIP plus the header row; no owner name appears (the last count is 0). bipfilter.ts exits 0. In the shots, the claims read as the topic pages do (no cards), with the depth labels small and muted.

## Gotchas

- React separates text nodes with `<!-- -->` in server HTML, so grep for `3<!-- --> claim`, not `3 claims`. Headings also repeat in the RSC payload; match the `<h2 ...>` tags (Block gives each an id).
- Statuses are the index's own strings (BIP 3: Draft, Complete, Deployed, Closed, plus "BIP number allocated"); never relabel them.
- The page writes nothing about a BIP: its title, layer, type and status are the index's, every sentence under them a published claim. Implementations come only from claims citing both the BIP and the code (`supports` other than background); add a claim to add a line.
- `bipCitations` reads any source whose link points into bitcoin/bips (`bipOf`), whatever its kind, and leaves out superseded and withdrawn claims.
