# Proposals

A reader tracks every consensus BIP by status, sees which Blocklore claims cite each, and searches the whole BIP index.

<!-- covers: page:/proposals, page:/bips -->

## Sub-features

- tracker: consensus BIPs from `knowledge/bips.json` in four groups (soft forks in progress, deployed soft forks, hard fork proposals, closed soft forks), each row linked to the BIP file at the index commit, with its status chip and the claims citing it (a disclosure listing them).
- index: all BIPs with a text filter (number, title, layer) and a status select; state in memory only.
- no owners: the index's owner column is never stored or shown.

## How to reach it

- Nav "Proposals"; "The proposal tracker" on Pulse; "The whole index" on the tracker; `/bips`.

## How to check it

Static: `pnpm lint`; `pnpm test` (brain/test/bips.test.ts).

Runtime:

```sh
curl -s localhost:3721/proposals | grep -oE '<h2>(Soft forks in progress|Deployed soft forks|Hard fork proposals|Closed soft forks)</h2>'
curl -s localhost:3721/proposals | grep -oE '<summary>[0-9]+<!-- --> claim' | wc -l
curl -s localhost:3721/bips | grep -o '<tr>' | wc -l
python3 -I -c "import json;print(len(json.load(open('knowledge/bips.json'))['bips']))"
curl -s localhost:3721/bips | grep -c 'Poinsot'
~/.claude/claude-core/bin/heavy node .claude/skills/verify/bipfilter.ts
```

Proves it when: all four group headings print once each and the summary count is above 0 (8 at commit a7f91321f2 with 115 claims: BIPs 30, 34, 42, 54, 141, 143, 148, 341); `/bips` has one row per BIP plus the header row (222 for 221 BIPs); no owner name appears (the last count is 0). bipfilter.ts exits 0: "taproot" leaves only Taproot rows (8 at a7f91321f2) and Deployed leaves only Deployed chips (80).

## Gotchas

- React separates text nodes with `<!-- -->` in server HTML, so grep for `3<!-- --> claim`, not `3 claims`. Headings also repeat in the RSC payload; match the `<h2>` tags.

- Statuses are the index's own strings (BIP 3: Draft, Complete, Deployed, Closed, plus "BIP number allocated"); never relabel them.
