# Tools

Deploying and proving production, screenshots, the favicon and the no-dash style check.

<!-- covers: cli:deploy, cli:shots, cli:favicon, cli:style -->

## Sub-features

- deploy: sets the Vercel project `blocklore` (team xaxis-projects, root `web`, Node 24), adds blocklore.space and www (308), deploys the committed HEAD via `git archive`, then proves every production domain: build marker, security headers, share image, stylesheet, icons, manifest, robots, sitemap, Atom feed, every sitemap page 200, a 404, and the www redirect once DNS points at Vercel.
- shots: desktop and phone, light and dark screenshots of the running site.
- favicon: regenerates `web/app/favicon.ico` from `web/app/icon.svg`.
- style: fails on any em dash, en dash or horizontal bar in tracked or new files.

## How to reach it

- `tools/deploy.sh`, `tools/deploy.sh --check [SHA]`; `heavy node tools/shots.ts OUT PATH...`; `heavy node tools/favicon.ts`; `node tools/style.ts` (also in `pnpm lint`).

## How to check it

Static: `pnpm lint`.

Runtime:

```sh
tools/deploy.sh --check
node tools/style.ts; echo "exit $?"
~/.claude/claude-core/bin/heavy node tools/shots.ts "$SCRATCH" /
```

Proves it when: deploy --check ends "site ok: <HEAD sha> is live at https://blocklore-...vercel.app" (plus blocklore.space once DNS is set), style prints "style ok: N files, no dashes", shots writes 4 PNGs.

## Gotchas

- `deploy.sh` needs `VERCEL_TOKEN` in `.env`; it never prints it.
- Pushing does not deploy; run `tools/deploy.sh` after pushing.
- Until DNS for blocklore.space is set, the script prints the A and CNAME records it needs and proves the vercel.app domain.
