# About

A reader learns how Blocklore works, what it never does, how its bot behaves, and reads the rule documents as they were at this build.

<!-- covers: page:/about, page:/about/[doc] -->

## Sub-features

- about: claims-not-pages, the six-step pipeline, how to check, facts and values, never-dos, `#bot` (the User-Agent's info URL), links to every rule document.
- docs: `/about/editorial|claims|sources|security|architecture` render the root `.md` files with GFM; links between docs stay on the site, other relative links go to the repo on GitHub; raw HTML is skipped.

## How to reach it

- Nav "About"; footer "How Blocklore works", "Editorial rules", "Sources"; the home page's "How a sentence gets here"; the bot's User-Agent `+https://blocklore.space/about#bot`.

## How to check it

Static: `pnpm lint`.

Runtime:

```sh
curl -s localhost:3721/about | grep -oE 'id="bot"|BlockloreBot/0.1'
for d in editorial claims sources security architecture; do echo "$d $(curl -s -o /dev/null -w '%{http_code}' localhost:3721/about/$d)"; done
curl -s localhost:3721/about/editorial | grep -o 'href="/about/[a-z]*' | sort -u
```

Proves it when: the bot section exists, all five docs answer 200, and doc-to-doc links point at `/about/...` not GitHub.

## Gotchas

- Docs are read from `..` relative to `web/` at build; `outputFileTracingIncludes` in `web/next.config.ts` ships them. A new doc needs an entry in `web/lib/docs.ts`.
