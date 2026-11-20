# Pulse

A reader sees the chain now (from two explorers that must agree), how BIP statuses moved, what was published lately, and what the brain's feeds saw upstream.

<!-- covers: page:/pulse -->

## Sub-features

- chain: height (mempool.space and blockstream.info agree or are one block apart, else no height), tip time, subsidy computed from the height, next halving with a ten-minute-block estimate, difficulty period progress and mempool.space's estimate, fee rates (mempool.space's); each with its `bitcoin-cli` command.
- proposals: the newest 10 BIP index changes from `bundle.bips.changes`, or the baseline commit when none.
- published: the 6 newest change events.
- upstream: 30 newest wire items with tier and feed name, as text.
- refresh: the page is ISR with `revalidate = 60`; explorers are read on the server only, so the CSP stays `connect-src 'self'` plus Overlook.

## How to reach it

- Nav "Pulse"; the masthead block pill; `/pulse`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/chain.test.ts for subsidy and halving arithmetic).

Runtime:

```sh
curl -s localhost:3721/pulse | grep -oE 'Both explorers report block [0-9,]+|[0-9.]+ BTC|Block 1,050,000|[0-9.]+% done|[0-9]+ sat/vB|Watching the BIP index since commit' | sort -u
curl -s https://mempool.space/api/blocks/tip/height; echo; curl -s https://blockstream.info/api/blocks/tip/height; echo
curl -s localhost:3721/pulse | grep -c 'connect-src'; curl -sI localhost:3721/pulse | grep -i content-security-policy | grep -o "connect-src [^;]*"
```

Proves it when: the page names a height equal to (or one below) both explorers' answers, shows 3.125 BTC while the height is in 840,000 to 1,049,999, Block 1,050,000, a difficulty percentage and a fee rate; the CSP's connect-src has only 'self' and overlook.technology.

## Gotchas

- In dev every request re-renders; in production the page is at most a minute old. When an explorer is down the page says so instead of showing one explorer's height.
- The wire and BIP index come from the bundle: run `pnpm brain ingest` / `pnpm brain bips`, then `pnpm bundle`.
