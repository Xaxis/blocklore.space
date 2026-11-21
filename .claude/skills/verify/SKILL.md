---
name: verify
description: Verify Blocklore (Next.js site in web/, the knowledge store in knowledge/, the brain CLI in brain/, core library and tools). Has the feature map of where every page, endpoint and command lives, how to launch and health-check the site, and a proven recipe for checking each feature. Use to prove a change in this repo works, to find where a feature lives, or to see what a change could break.
---

# Verify Blocklore

`FM=~/.claude/claude-core/bin/featuremap`

- **Where does a feature live?** Look it up in `features.json` (`id`, `entry`, `reach`,
  `tests`), then read `features/<area>.md` for its recipe.
- **What did my change touch?** `$FM affected` (add `--since <base>` on a branch).
  Every feature it lists is in scope.
- **Keeping it current:** when you add, rename, move or remove a feature, run
  `$FM generate --write`, update the matching `features/<area>.md`, and confirm
  `$FM check` exits 0. Commit this with the feature change. CLI commands, tools and static
  files are listed by hand in `featuremap.config.json`.

## Static checks

| Check | Command | Proves | Baseline |
|---|---|---|---|
| lint | `pnpm lint` | biome, typecheck of core, brain and web, the no-dash style check, and the store compiles with 0 errors | passes, 6s (store warnings about links to unpublished claims are expected) |
| test | `pnpm test` | node:test in core (hashing, Merkle, secrets, claims, gate) and brain (hidden text, quotes, injections, headers, revisions, topics) | passes, 24 tests, 4s |
| build | `~/.claude/claude-core/bin/heavy pnpm build` | bundle compiles and every page prerenders | passes, about 2 to 10 min depending on box load |
| typecheck:core | `cd core && pnpm typecheck` | core types | passes |
| typecheck:brain | `cd brain && pnpm typecheck` | brain types | passes |
| typecheck:web | `cd web && pnpm typecheck` | rebuilds the bundle, runs `next typegen`, then tsc | passes |

Known pre-existing failures: none.

## Launch

The site needs no secrets: it renders `web/.generated/bundle.json`, compiled from `knowledge/`.
Port 3721 is this project's. Run it as a background task (never with a trailing `&`; the guard
hook blocks that):

```sh
pnpm dev > var/dev.log 2>&1      # run_in_background; compiles the bundle, then next dev --port 3721
```

Ready when: `curl -sf http://localhost:3721/ >/dev/null` succeeds (about 10 to 40 s; the first
page compile is slow).
Needs: `pnpm install` done. After changing `knowledge/`, run `pnpm bundle` and reload; the dev
server picks up the new JSON.

The brain needs `.env` (`ANTHROPIC_API_KEY` for `research`); checks and ingest use public hosts
(mempool.space, blockstream.info, GitHub raw and Atom feeds) and no secret.

## Doctor

```sh
ss -ltnp 'sport = :3721' | grep -q next-server && \
curl -s http://localhost:3721/ | grep -o '<meta name="blocklore-build" content="[^"]*"' && \
node -e 'const b=require("./web/.generated/bundle.json");console.log("bundle:",b.stats.claims,"claims,",b.topics.length,"topics, block",b.generated.height)'
```

Proves it: a `next-server` process holds 3721, the page carries the build marker (`dev` locally, the short
SHA in production), and the bundle line matches `node core/cli.ts validate`'s claim count.

## Drive

- **Pages:** `curl -s localhost:3721<path>` and grep the rendered text the recipe names. For
  anything visual or interactive, `~/.claude/claude-core/bin/heavy node tools/shots.ts <outdir>
  <path>...` (desktop and phone, light and dark; append `!open` to open the first claim) and look
  at the PNGs. The depth dial has its own driver (`heavy node .claude/skills/verify/dial.ts`), and so do the BIP index filter (`bipfilter.ts`) and the bar's views at phone widths (`navfit.ts`; run it after any change to `VIEWS` in `web/lib/nav.ts` or the bar CSS). The 3D scene has `scenecheck.ts` (start, one canvas across navigation, hover and click, the admin hiding it, pausing off screen on a phone, the no-WebGL drawing). `/mcp` has `mcpcheck.ts` (no browser; the official MCP SDK client plus raw stateless requests).
- **Endpoints:** `curl -sI` for status and content type, then the body.
- **CLI:** the command, its stdout and exit code. Never drive `pnpm review approve|reject` (the
  owner's decision) or `research` without a reason (it spends API money, about 4 USD a topic).
- **Production:** `tools/deploy.sh --check` proves the live site serves HEAD.

## Evidence

- Record the command and its decisive output: status plus body, the rendered text, the
  exit code, or the file read back.
- Capture both the action and the resulting state; check side effects through a
  second, read-only view (`git show --stat`, `node core/cli.ts validate`).
- If a path is unreachable, name the missing precondition and prove the nearest
  real path. Never report it as verified.

## Cleanup

Stop the dev server task you started (TaskStop, or kill the PID holding 3721 only if this run
started it). Other sessions' servers run on this machine. Keep screenshots in the scratchpad.
