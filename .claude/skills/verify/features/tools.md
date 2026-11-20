# Tools

Deploying and proving production, screenshots, the favicon and the no-dash style check.

<!-- covers: cli:deploy, cli:env, cli:shots, cli:a11y, cli:favicon, cli:style -->

## Sub-features

- deploy: sets the Vercel project `blocklore` (team xaxis-projects, root `web`, Node 24), adds blocklore.space and www (308), deploys the committed HEAD via `git archive`, then proves every production domain: build marker, security headers, share image, stylesheet, icons, manifest, robots, sitemap, Atom feed, every sitemap page 200, a 404, and the www redirect once DNS points at Vercel.
- env: provisions what the site needs beyond code: the `blocklore-kv` Upstash Redis store (pay as you go, iad1) connected to the project for production, and `ANTHROPIC_API_KEY`, `ASK_SALT` and `QUEUE_PULL_TOKEN` (sensitive, from `.env`; the last two made once if missing) and `ASK_DAILY_BUDGET_USD` (plain). Idempotent; `--check` only reads. Values pass through mode-600 files, never a command line.
- shots: desktop and phone, light and dark screenshots of the running site.
- favicon: regenerates `web/app/favicon.ico` from `web/app/icon.svg`.
- style: fails on any em dash, en dash or horizontal bar in tracked or new files.

## How to reach it

- `tools/deploy.sh`, `tools/deploy.sh --check [SHA]`; `tools/env.sh [--check]`; `heavy node tools/shots.ts OUT PATH...`; `heavy pnpm a11y [BASE_URL] [PATH...]` (axe-core, WCAG 2.x A and AA plus best practices, and a reflow check that fails a page wider than the viewport; every topic, one page of every other kind and every doc in the sitemap, at desk and phone, light and dark; exits 1 on any violation); `heavy node tools/favicon.ts`; `node tools/style.ts` (also in `pnpm lint`).

## How to check it

Static: `pnpm lint`.

Runtime:

```sh
tools/deploy.sh --check
tools/env.sh --check
node tools/style.ts; echo "exit $?"
~/.claude/claude-core/bin/heavy node tools/shots.ts "$SCRATCH" /
```

Proves it when: env --check ends "env ok: blocklore-kv connected; KV_REST_API_URL, ... on production"; deploy --check ends "site ok: <HEAD sha> is live at https://blocklore-...vercel.app" (plus blocklore.space once DNS is set), style prints "style ok: N files, no dashes", shots writes 4 PNGs, a11y ends "axe ok: 31 pages, 4 views each, no violations" (local or https://blocklore.vercel.app).

## Gotchas

- `deploy.sh` needs `VERCEL_TOKEN` in `.env`; it never prints it.
- Pushing does not deploy; run `tools/deploy.sh` after pushing.
- Until DNS for blocklore.space is set, the script prints the A and CNAME records it needs and proves the vercel.app domain.
- A long unbreakable word (an address, a hash) in a `1fr` grid column widens the page on a phone: `1fr` cannot shrink below its content. One-column grids use `minmax(0, 1fr)` and body text has `overflow-wrap: break-word`; `page-overflow` in a11y catches a regression.
- Scrolling regions fail axe unless a keyboard can reach them. Commands and doc code wrap instead of scrolling; a wide doc table sits in a named, focusable region (`.table-scroll` in `web/app/about/[doc]/page.tsx`). Biome's `noNoninteractiveTabindex` is ignored there on purpose, with the reason inline.
