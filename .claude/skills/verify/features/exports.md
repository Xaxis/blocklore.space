# Core exports

Code imports the pure model (`@blocklore/core`), the filesystem loaders (`@blocklore/core/node`) and single modules (`@blocklore/core/<module>`).

<!-- covers: export:@blocklore/core, export:@blocklore/core/*, export:@blocklore/core/node -->

## Sub-features

- core: schema (zod), validate, gate, hash (claim hash, RFC 6962 Merkle), replay (claimAsOf, change events), secrets (detectSecrets), style, search, bundle (compile), commands (readerCommand, checkMeaning).
- node: loadStore, storeMoment, REPO_ROOT, KNOWLEDGE.

## How to reach it

- `import ... from "@blocklore/core"` in web and brain; `node core/cli.ts`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/*.test.ts).

Runtime:

```sh
node --input-type=module -e "import * as c from './core/src/index.ts'; import * as n from './core/src/node/index.ts'; console.log(Object.keys(c).length, typeof c.compile, typeof c.detectSecrets, typeof n.loadStore)"
node --input-type=module -e "import {detectSecrets} from './core/src/index.ts'; console.log(detectSecrets('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about').map(f=>f.kind))"
```

Proves it when: the first prints a count and `function function function`, the second reports a seed phrase finding.

## Gotchas

- No `Date.now()`, argument-less `new Date()` or randomness in `core/src` outside `core/src/node/` (CLAUDE.md).
- Node runs the `.ts` sources directly (strip-only): no TypeScript parameter properties or enums.
