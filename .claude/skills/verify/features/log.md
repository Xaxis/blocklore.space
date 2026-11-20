# Research log

A reader sees every research run: what it read, published, revised, rejected, held for review, could not settle, and any injection attempts.

<!-- covers: page:/log, page:/log/[run] -->

## Sub-features

- index: runs newest first with summary and counts (published, revised, rejected, held, read, injections).
- run: published claims linked; held-for-owner counts per topic with reasons (text stays private); rejected statements with reasons (gated subjects withheld); open questions; injections; sources read.

## How to reach it

- Nav "Research log"; a run link on any change entry or claim history; `/log/<run id>`.

## How to check it

Static: `pnpm lint`.

Runtime:

```sh
curl -s localhost:3721/log | grep -o 'href="/log/[0-9a-z-]*"' | sort -u
curl -s localhost:3721/log/2026-11-20-seed-halvings-and-supply | grep -oE 'Held for the owner|[0-9]+ claims</span>|No text in any source'
```

Proves it when: every run in `knowledge/runs/` is linked, and the run page shows the held section and the injection line that match `knowledge/runs/2026/2026-11-20-seed-halvings-and-supply.yaml`.

## Gotchas

- Held claims' statements must never appear on the run page: `curl -s localhost:3721/log/2026-11-20-seed-halvings-and-supply | grep -c 'called adding tail emission'` must print 0 (a held claim's words, from `pnpm review list`).
