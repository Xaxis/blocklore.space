# Home

A reader sees what Blocklore is, the store's numbers, how a sentence gets published, the topics and the latest changes.

<!-- covers: page:/ -->

## Sub-features

- ledger: the edition's numbers (claims, topics, sources, machine checks, primary share, re-checked in 7 days, awaiting review, corrections) from `bundle.stats`.
- pipeline: the six steps, colored by actor (model, code, person).
- topics: one card per published topic, plus dashed "Under review" cards for topics with only held claims.
- latest: the 8 newest change events.
- masthead: the edition's block height pill; nav with `aria-current`.

## How to reach it

- `http://localhost:3721/`, or the wordmark on any page.

## How to check it

Static: `pnpm lint` (typecheck web).

Runtime:

```sh
curl -s localhost:3721/ | grep -oE 'Claims published</dt><dd>[0-9,]+|Halvings and the supply schedule|How a sentence gets here' | sort -u
node -e 'console.log(require("./web/.generated/bundle.json").stats.claims)'
```

Proves it when: the page shows "Claims published" with the same number the bundle prints, the topic title, and the pipeline heading.

## Gotchas

- Numbers come from the bundle at build time; after `brain publish`, run `pnpm bundle` before looking.
- With an empty store the topics block shows a "being researched" callout instead of cards.
