# CLAUDE.md: Blocklore

blocklore.space: the current, cited, verifiable state of Bitcoin knowledge. The store is
`knowledge/` (YAML claims in git), the brain is `brain/` (deterministic machinery plus Claude Code
roles on the devbox), the site is `web/` (Next.js on Vercel). Read ARCHITECTURE.md first, then
CLAIMS.md, EDITORIAL.md and SECURITY.md before touching their areas. BACKLOG.md says what is next.

## Rules that shape every change

- **Claims, not pages.** Every sentence a reader sees on a topic, proposal, debate, digest or
  answer is a claim with sources. Topics hold titles and claim ids, never prose.
- **A quote that is not found does not publish.** Every non-chain source carries an exact quote of
  at most 50 words that `brain check` finds at the URL. Git sources are cited at a 40-hex commit.
- **Nothing is edited silently.** A change to a published claim appends a revision with `before`;
  the publisher refuses rewritten history. Corrections are their own revisions.
- **The gate is code.** `core/src/gate.ts` decides what waits for the owner (contested, safety,
  stances, arguments, named people). Gated claims live in `var/review/`, never in the public repo,
  until the owner approves them with `pnpm review`. Never approve on the owner's behalf.
- **Models never publish.** The research and verifier roles write only under `var/staging/` with
  no secrets in their environment. Only deterministic code writes `knowledge/`.
- **No em dashes** (nor en dashes nor the horizontal bar), anywhere: docs, UI, code, commits,
  generated text. `node tools/style.ts` checks. Write ranges as "2 to 4". In code, build dash
  characters with `String.fromCharCode`, never as literals or `\u` escapes in strings the style
  check reads.
- **Evenhanded.** Facts and values are separate. Contested positions are attributed, dated and in
  their proponents' words. The brain's voice never declares a winner on a value question.
- **No hidden inputs in core.** No `Date.now()`, `new Date()` without an argument or randomness in
  `core/src` outside `core/src/node/`. Time and heights come in as arguments.
- **Readers' secrets are refused.** Anything that accepts reader text runs `detectSecrets` first.

## Commands

```sh
pnpm install
pnpm lint                     # biome, typecheck, style, knowledge validation
pnpm test                     # node:test in core and brain
pnpm bundle                   # compile knowledge/ to web/.generated/bundle.json
pnpm brain check <dir|id>     # schema, style, locators, quotes, code and chain checks
pnpm brain ingest             # poll the T1 and T2 feeds into var/inbox
pnpm brain chain              # tip, retarget window, signaling
pnpm brain publish <run>      # merge verified candidates, gate, revisions, commit
pnpm review                   # the owner's queue: list, show, approve, reject
pnpm dev                      # the site on http://localhost:3721
tools/deploy.sh               # production deploy of HEAD, then prove it live
```

Heavy work (builds, browser runs) goes through `~/.claude/claude-core/bin/heavy`. This project's
port is 3721.

## Layout

`knowledge/` the store, `core/` pure model (`core/src/node/` reads files), `brain/` devbox
processes and role prompts (`brain/prompts/`, changed only by owner-reviewed PRs), `web/` the
site, API and MCP, `tools/` deploy, env, style and screenshots, `var/` devbox state (gitignored).

## Commits and shipping

Every commit is the owner's, nothing else:

```sh
git -c user.name=Xaxis -c user.email=william.neeley@gmail.com commit -F msgfile -- <paths>
```

Messages lead with why, in short sentences. Stage explicit paths, never `git add -A`. Push to
`main` after each verified unit. Deploy with `tools/deploy.sh` (Vercel project `blocklore`, team
`xaxis-projects`); pushing does not deploy. Secrets live in `.env` (`.env.example` lists them);
never print one or put one on a command line.

`.claude/skills/verify/` says how to launch, drive and prove each feature; update it in the same
commit as a feature change.
