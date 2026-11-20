# Store

The knowledge store validates and compiles into the bundle the site renders.

<!-- covers: cli:core validate, cli:core bundle -->

## Sub-features

- validate: every claim against the schema and CLAIMS.md rules, cross references, the gate's review requirement; errors fail, warnings print.
- bundle: compiles `knowledge/` to `web/.generated/bundle.json` (claims with hashes, topics with ladders, events, stats).

## How to reach it

- `node core/cli.ts validate` (also the last step of `pnpm lint`); `pnpm bundle`; `web`'s dev, build and typecheck scripts run the bundle first.

## How to check it

Static: `pnpm test` (core claims and hash tests).

Runtime:

```sh
node core/cli.ts validate; echo "exit $?"
pnpm bundle && node -e 'const b=require("./web/.generated/bundle.json");console.log(Object.keys(b.claims).length,b.generated.height)'
```

Proves it when: validate ends with "0 errors" and exit 0; bundle prints "bundle: N claims" and the JSON has the same N and the newest stamp's height.

## Gotchas

- The bundle's moment is the newest stamp in the store, not the wall clock, so builds are reproducible.
