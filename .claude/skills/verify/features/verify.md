# Verify the store

A reader proves what Blocklore said and when: snapshots of every claim's hash under one Merkle root, timestamped on Bitcoin with OpenTimestamps, checked by a script in the repo or by `ots verify`.

<!-- covers: page:/verify, page:/verify/evaluator, api:GET /snapshots/[file], api:GET /api/v1/snapshots, cli:verify:snapshot -->

## Sub-features

- model: `core/src/snapshot.ts` (entries in id order, root, chain to the previous root, `snapshotIssues`, `summarizeProof`), `core/src/ots.ts` (the .ots format: parse, write, merge, walk to Bitcoin attestations), `core/src/hash.ts` (canonical hash, RFC 6962 tree, RFC 9162 inclusion check). Snapshots are made by `pnpm brain snapshot` ([brain](brain.md)).
- store: `core/src/node/load.ts` reads `knowledge/snapshots/<n>.json` with its exact text and `<n>.json.ots`; `pnpm bundle`/`validate` report a broken chain, a wrong root or a proof for other bytes as errors. The bundle keeps snapshot summaries (newest first) and the newest snapshot's claim list.
- page: `/verify` lists each snapshot (block, root, previous, commit link, timestamp status: "Waiting for a block" with the calendars, or "In block H" with the merkle root), links both files with the file's SHA-256, and gives the two commands; the about page and the footer ("Verify the store") link it; it is in the sitemap and llms.txt.
- files: `/snapshots/<n>.json` and `/snapshots/<n>.json.ots` read from `knowledge/snapshots` at build and served byte for byte (static, unknown files 404).
- api: `GET /api/v1/snapshots` with absolute file urls; `GET /api/v1` lists it.
- claim pages: "Snapshot N, block H, claim i of C" with an "Audit path to the root" disclosure; a claim changed since the newest snapshot says so.
- cli: `pnpm verify:snapshot [n] [--explorers]` (`tools/verify-snapshot.ts`) rehashes every claim file at the snapshot's commit (`git show`), checks the root and the chain, the proof's digest, and each block's merkle root from `bitcoin-cli` or two explorers that must agree (header hash checked). Exit 1 on any failure.
- deploy: `tools/deploy.sh` checks the newest snapshot and its proof come back byte for byte.
- evaluator scorecard: `/verify/evaluator` reads `bundle.evaluator` (`knowledge/evaluator.json`, written by `applyBatch`) and the withdrawn claims: publishing or paused and why, test claims caught lately against the threshold, decisions by day, catch rate by kind, what stopped claims, every withdrawal with its reason, and how a claim is decided. Before the first batch it says so; only counts and published claims appear.

## How to reach it

- http://localhost:3721/verify, `/snapshots/1.json`, `/snapshots/1.json.ots`, `/api/v1/snapshots`; any claim page's record; `pnpm verify:snapshot`.

## How to check it

Static: `pnpm lint` (validate reports snapshot errors); `pnpm test` (core/test/ots.test.ts on the reference client's 2015 proof for block 358391, core/test/snapshot.test.ts, brain/test/snapshot.test.ts).

Runtime:

```sh
set -o pipefail
pnpm -s verify:snapshot; echo "exit $?"
B=http://localhost:3721
for p in /verify /snapshots/1.json /snapshots/1.json.ots /api/v1/snapshots /snapshots/9.json; do echo "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' $B$p) $p"; done
curl -s $B/snapshots/1.json | sha256sum; sha256sum knowledge/snapshots/1.json
curl -s $B/snapshots/1.json.ots | cmp - knowledge/snapshots/1.json.ots && echo "proof identical"
curl -s $B/verify | grep -o 'Snapshot <!-- -->1<!-- -->: <!-- -->228 claims\|Waiting for a block\|In block [0-9,]*'
```

Proves it when: the verifier prints three `ok` lines (claim files hash to the listed hashes, the root, the proof's digest) and either an `ok` for the block or a `wait` naming the calendars, then "Snapshot 1 checks out." and exit 0; the routes are 200 with `text/html`, `application/json`, `application/vnd.opentimestamps.v1`, `application/json`, and 404 for a snapshot that does not exist; both sums match and the proof is identical; the page names the snapshot and its timestamp state.

Tamper test (restore after): change one character of a hash in `knowledge/snapshots/1.json`, run the verifier: three `FAIL` lines (the claim's hash, the root, "the proof is for different bytes") and exit 1. Then `git checkout knowledge/snapshots/1.json`.

Audit path: on `/claims/taproot.activation-height`, the `<li>` hashes of `.audit-path` with the index from "claim i of C" pass `verifyMerkleProof(hash, i - 1, C, path, root)` from core, and fail with any other index.

## Gotchas

- The bundle is compiled from `knowledge/`; after `brain snapshot` run `pnpm bundle` (or restart `pnpm dev`) before the page shows the new snapshot.
- If pages reload in a loop under `next dev` (hundreds of requests a second, `networkidle` never reached), a `pnpm install` moved Next's folder and Turbopack's dev cache is stale: stop the server, `rm -rf web/.next/dev`, start it again. Playwright `networkidle` and screenshots time out, and `Compiled` lines pile up in var/dev.log.
- A proof stays "Waiting for a block" for an hour or two after a stamp; `pnpm brain snapshot --upgrade` completes it.
