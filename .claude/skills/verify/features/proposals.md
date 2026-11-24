# Proposals

A reader tracks every consensus BIP by status, sees which Blocklore claims cite each, sees which version bits blocks set this difficulty period, searches the whole BIP index, and opens a page per BIP with only what Blocklore's own record holds.

<!-- covers: page:/proposals, page:/bips, page:/proposals/[n], api:GET /bips/[n], api:GET /api/v1/bips/[n], cli:bipcheck, api:GET /api/v1/signaling, cli:signalingcheck, cli:brain signaling -->

## Sub-features

- tracker: consensus BIPs from `knowledge/bips.json` in four groups (soft forks in progress, deployed soft forks, hard fork proposals, closed soft forks), each row's title linked to its page, with its status chip and the claims citing it (a disclosure listing them).
- index: all BIPs with a text filter (number, title, layer) and a status select; state in memory only; each title links to its page; an "In Bitcoin Core" column says "Since <version>" (linking the page's `#bitcoin-core`) or "Not listed". The tracker's tables have the same column.
- Bitcoin Core's list (BACKLOG 16, implementations): `knowledge/core-bips.json` (core's `CoreBips`: `commit`, `read`, `entries` of `{bips, text, since, prs, line}`, `changes` per BIP of `added`, `removed` or `text`), written by the hourly `core bips` step and `pnpm brain bips` (`brain/src/bips.ts`, `parseCoreBips`, `diffCoreBips`, `refreshCoreBips`) from `doc/bips.md` at bitcoin/bitcoin's head, only when an entry changed; carried as `bundle.coreBips`; `bipInCore` in `core/src/bipview.ts` gives a BIP's entry as `core` in its view and `bitcoin_core` in its API answer and `get_bip`. Core's words, quoted, never a claim.
- a BIP's page, `/proposals/<n>` for every BIP in the index (static, `dynamicParams = false`), built by `core/src/bipview.ts` from the bundle: the entry (title, layer, type, status) as the index states it at its commit, with links to the index and the BIP's text at that commit; "Claims that cite it" grouped by primary topic (most claims first) then depth, each a ClaimLine, with contested claims, stances and arguments marked (a status chip, and a Stance or Argument chip naming who it is attributed to on hover); "In Bitcoin Core" (`#bitcoin-core`, only for a BIP Core's `doc/bips.md` names): Core's words quoted, the other BIPs the same entry covers, its pull requests and a link to the entry's line at the commit it was read at; "In code": the code, commits and pull requests those claims cite as support, each with the claims citing it (no claim, no line); "In the index": the recorded changes to the entry with commit, time and block. A BIP nothing cites says "Blocklore has no claims citing this BIP yet." with a link to `/gaps#suggest-block`. BIP 9's and BIP 320's pages also show "Version bits this period" (below), before the claims; a BIP whose deployment Bitcoin Core's chainparams defines would show its bit's row there (none does at v32.1).
- version bits (BACKLOG 16): `knowledge/chain/signaling.json` (core's `Signaling`, counted by `core/src/signaling.ts`: the tip's period from its first block, `prefixed` with BIP 9's top bits 001, `bits` per bit 0 to 12, `general` for BIP 320's bits 13 to 28, `unprefixed`, and the last period's final tally), written by the hourly `watch` step (`brain/src/signaling.ts`, from the blocks `brain/src/security/watches.ts` follows, both explorers agreeing on every version) and carried by the bundle as `bundle.signaling`. `/proposals` shows it after "Soft forks in progress" (`web/components/VersionBits.tsx`): the heights, blocks so far of 2016, the block it is as of, a table with this period and the last (when followed) side by side: counted, with BIP 9's top bits 001, a row per deployment bit any block set (or "No block set a deployment bit"), BIP 320's bits marked not a signal, without the prefix; each count with its share of the blocks counted; then the rules with links to `/proposals/9`, `/proposals/320` and chainparams.cpp's lines at the pinned commit, and the JSON. Before any tally: "The brain has not counted a period's version bits yet." The same as JSON at `GET /api/v1/signaling` (API.md, "Version bits"; reach `api:signaling`), in each BIP answer's `signaling` field, from the MCP tool `signaling`, and printed by `pnpm brain signaling`, which reads both explorers and writes nothing.
- `/bips/<n>` answers 308 to `/proposals/<n>`; a number written any other way (`0341`, `abc`) is 404, so every BIP has one address.
- the same data as JSON at `GET /api/v1/bips/<n>` (API.md, "One BIP"; 404 with `{"error"}` for a number the index does not list) and from the MCP tool `get_bip` (a tool error for one it does not list). Reach counts it as `api:bip`.
- links in: `/proposals` and `/bips` rows, Pulse's and each digest's BIP index changes, every claim's BIP sources ("BIP n on Blocklore", in `Evidence`), and the sitemap (one URL per BIP).
- no owners: the index's owner column is never stored or shown; the page says the BIP's text names them.

## How to reach it

- Nav "Proposals"; "The proposal tracker" on Pulse; "The whole index" on the tracker; `/bips`; a row's title; a claim's BIP source; `/proposals/341` directly.
- Version bits: `/proposals#version-bits`, `/proposals/9`, `/proposals/320`, `GET /api/v1/signaling`, the MCP tool `signaling`, `pnpm brain signaling`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/bipview.test.ts: the view from a compiled store, grouping and reading order, marks, code only from citing claims, empty and unknown BIPs, and every BIP in the committed store; core/test/reach.test.ts: `api:bip`; brain/test/bips.test.ts, which also parses real lines of Core's `doc/bips.md` and diffs two readings; core/test/bipview.test.ts's Core tests: `bipInCore` and every BIP Core names in the committed store showing Core's words).

Runtime, against a running site (any port; examples use 3721):

```sh
node .claude/skills/verify/bipcheck.ts http://localhost:3721            # BIPs 341 141 119 333 and 9999
node .claude/skills/verify/bipcheck.ts http://localhost:3721 54 342     # any others
curl -s localhost:3721/proposals | grep -oE '<h2[^>]*>(Soft forks in progress|Deployed soft forks|Hard fork proposals|Closed soft forks)</h2>'
curl -s localhost:3721/bips | grep -o '<tr>' | wc -l
curl -s localhost:3721/bips | grep -o '#bitcoin-core">Since' | wc -l      # one per BIP Core lists that the index has
python3 -I -c "import json;d=json.load(open('knowledge/core-bips.json'));print(d['commit'][:10],len(d['entries']),len({n for e in d['entries'] for n in e['bips']}))"
python3 -I -c "import json;print(len(json.load(open('knowledge/bips.json'))['bips']))"
curl -s localhost:3721/bips | grep -c 'Poinsot'
~/.claude/claude-core/bin/heavy node .claude/skills/verify/bipfilter.ts
~/.claude/claude-core/bin/heavy node tools/shots.ts OUT http://localhost:3721 /proposals/341 /proposals/119
```

Proves it when: bipcheck prints `bipcheck: all checks passed` (it reads `doc/bips.md` from raw.githubusercontent.com at the pinned commit, so it needs the network), having printed for each BIP the page's title and status beside the API's entry, its topics by depth, its code and its changes; for each: the page's title and status chip are the index's, its text is linked at the index's commit, the page and the API hold the same claims (every one citing the BIP's text), the same code (each line from such claims) and the same changes, "In Bitcoin Core" shows exactly when the API's `bitcoin_core` is set (341 and 141 yes, 119 and 333 no), quoting the API's text, linking its pull requests and no others, and linking a line of `doc/bips.md` at the pinned commit that names one of the entry's BIPs; the only parts are claims, Bitcoin Core, code and history, and `get_bip` returns exactly the API's JSON; BIP 119 says "Blocklore has no claims citing this BIP yet." with the `/gaps` link; BIP 333 shows its `added` change; 9999 and `0341` are 404 and 9999 is a tool error; `/bips/341` is a 308 to `/proposals/341`; `/proposals`, `/bips` and a claim citing BIP 341 link `/proposals/341`; the sitemap lists one page per BIP. The group headings print once each; `/bips` has one row per BIP plus the header row; the `Since` count equals the number of BIPs in `core-bips.json` that the index lists (74 of 74 at `dbe9eacd17`); no owner name appears (the last count is 0). bipfilter.ts exits 0. In the shots, the claims read as the topic pages do (no cards), with the depth labels small and muted.

### Version bits

Static: `pnpm test` (core/test/signaling.test.ts: BIP 9's prefix, BIP 320's bits apart from the deployment bits, a version without the prefix, a partial period, a full period and the boundary, the file's own rules, rows and shares, the chainparams pin; brain/test/signaling.test.ts: both fake explorers must agree on each version and are read in pages aligned to their size, a first fill in chunks, a run that stops after its minute and writes nothing, the boundary tally, the gaps after a pause, a version the explorers disagree on leaving the file as it was, and `pnpm brain signaling` printing without writing).

Runtime, against a running site (`next start`, any port):

```sh
node .claude/skills/verify/signalingcheck.ts http://localhost:3721
node .claude/skills/verify/bipcheck.ts http://localhost:3721 9 320 341
~/.claude/claude-core/bin/heavy node tools/axe.ts http://localhost:3721 /proposals /proposals/9
~/.claude/claude-core/bin/heavy node tools/shots.ts OUT http://localhost:3721 /proposals#version-bits /proposals/9
```

Proves it when signalingcheck ends `signalingcheck: all checks passed`, having printed the period, its counts and the block's text: the API adds up (prefixed plus unprefixed is the blocks, a row per bit any block set, shares to one decimal, a deployment named only where chainparams defines one), allows any origin and caches `public, max-age=300`; `/proposals` shows the same heights, blocks so far, block, counts and shares, the rows or "No block set a deployment bit", the last period only when known, the links to BIP 9, BIP 320, chainparams.cpp at the pinned commit and the JSON, and no forecast words; BIP 9 and 320 show it and point to it from their answers, 341 and 119 do not; `/api/v1` and `/llms.txt` list it; the MCP tool returns the API's data byte for byte. bipcheck passes for 9 and 320 with the `version-bits` part. axe reports no violations. In the shots, the table keeps the two periods side by side on a phone (each count over its share), and reads in both themes.

The brain's side, read-only (about 2.5 minutes the first time, from a cold cache; seconds once the deep pages are cached):

```sh
BLOCKLORE_SECURITY_DIR=$SCRATCH/security pnpm brain signaling
```

Proves it when it prints the period, blocks so far of 2016, the block it is as of with its hash, the counts and shares, the chainparams line, and ends `Read N block versions in X s; wrote nothing.` On 2026-11-23 from a cold cache: period 975744 to 977759, 1507 of 2016 blocks as of block 977250, 1507 with the prefix, no deployment bit, 1439 (95.5%) setting BIP 320 bits, 0 without the prefix, read in 152.7 s.

The hourly step and its commit, in a scratch clone whose only remote is a local bare repository (never the devbox checkout): `git clone --bare . var/scratch/remote.git`, `git clone var/scratch/remote.git var/scratch/clone`, commit the code under test there, `pnpm install --prefer-offline`, then from the clone `env -i PATH="$PATH" HOME=<scratch home> BLOCKLORE_SECURITY_DIR=$PWD/var/security BLOCKLORE_CONTROL_DIR=$PWD/var/control node brain/cli.ts watch --force --commit --push` (the tick passes no `--force`; readings under an hour old are not due). Proves it when, from a cold cache, the step prints `signaling: read N block versions in about 60 s, M still to read on the next run` and its commit carries only `watches.json`; and a later run (or one after `pnpm brain signaling` warmed `var/cache`) prints `signaling: period from ...` and `git show --stat HEAD` lists `knowledge/chain/signaling.json` and `knowledge/security/watches.json` in one commit by `Xaxis <william.neeley@gmail.com>`. On 2026-11-23: the cold run read 606 versions in 60.1 s (the whole step 95 s), the warm one the other 741 in 0.5 s (7 s).

The chainparams pin (`CHAINPARAMS` in core/src/signaling.ts) against the newest release: `pnpm brain signaling` prints a line when Bitcoin Core's newest release is past the pin. Then read `src/kernel/chainparams.cpp` (`class CMainParams`, every `vDeployments[...]` line) and `src/consensus/params.h` (`enum DeploymentPos`) at the new tag's commit, and update the pin, its lines and its test in one commit.

## Gotchas

- React separates text nodes with `<!-- -->` in server HTML, so grep for `3<!-- --> claim`, not `3 claims`. Headings also repeat in the RSC payload; match the `<h2 ...>` tags (Block gives each an id).
- Core's list is its maintainers' statement of what Core implements, quoted, not a claim and not checked against the code. Its text has links, backticks and emphasis taken out and any dash character replaced (the style rule), so it is Core's words, not byte for byte Core's line; the line link shows the original. An entry naming several BIPs (Taproot's 340, 341, 342) shows on each, with the others under "The same entry covers". `commit` stays at the first commit read with the current words, so the line link holds while the file only moves. A reading that finds no entry, or one that names no BIP, throws and writes nothing.
- Statuses are the index's own strings (BIP 3: Draft, Complete, Deployed, Closed, plus "BIP number allocated"); never relabel them.
- The page writes nothing about a BIP: its title, layer, type and status are the index's, every sentence under them a published claim. Implementations come only from claims citing both the BIP and the code (`supports` other than background); add a claim to add a line.
- `bipCitations` reads any source whose link points into bitcoin/bips (`bipOf`), whatever its kind, and leaves out superseded and withdrawn claims.
- Version bits: counts and shares only, never a threshold, date or forecast as Blocklore's own (core/src/evaluate.ts; EDITORIAL.md, "No predicted outcomes"). BIP 320's bits 13 to 28 are never a row. The file is written only once every block from the period's first to the tip is read, so a first fill leaves the page as it was for a few hours. It reaches the site with the next deploy (at most 6 hours after the step). It is outside the sealed snapshots, whose root covers claims only.
