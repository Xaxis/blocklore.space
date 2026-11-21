# Home (the Explore view)

The app opens on Explore: what Blocklore is, the store's numbers, every topic, the latest changes and where to go further, in the panel beside the 3D scene of the store.

<!-- covers: page:/ -->

## Sub-features

- intro: "The verifiable state of Bitcoin knowledge." and the facts row (claims, sources, machine checks, the share with a primary source, the block the newest snapshot is timestamped in) from `bundle.stats` and `bundle.snapshots`.
- topics: `TopicTable` (`web/components/TopicTable.tsx`): topics by group with claims, depth coverage and the last update, plus topics with only held claims. `/topics` redirects here (308, topics.md).
- latest: the 5 newest change events, and "Every change" to `/changes`.
- go further: links to `/connect` (bring your own model over MCP), `/gaps` (what it does not know, and where to suggest a question), `/about` and `/verify`.
- shell (`web/app/layout.tsx`): the bar with the six views (`ViewNav` in `web/components/SiteNav.tsx`, from `VIEWS` in `web/lib/nav.ts`; the current view has `aria-current="true"`), the view's tabs at the top of the panel when it has more than one page (`ViewTabs`, `aria-current="page"`), the panel (`web/components/Panel.tsx`) and the scene (`web/components/scene/`), which every public view shares.

## How to reach it

- `http://localhost:3721/`, Explore in the bar, or the wordmark in any view.

## How to check it

Static: `pnpm lint` (typecheck web).

Runtime:

```sh
curl -s localhost:3721/ | sed 's/<!-- -->//g' | grep -oE 'The verifiable state of Bitcoin knowledge\.|<strong>[0-9,]+</strong> claims|Halvings and the supply schedule|Latest changes|Connect your own model|aria-label="Views"|aria-current="page" href="/">Topics' | sort -u
node -e 'console.log(require("./web/.generated/bundle.json").stats.claims)'
```

Proves it when: all seven strings print, and the number before "claims" is the one the bundle prints (228 on 2026-11-21).

Browser: `~/.claude/claude-core/bin/heavy node tools/shots.ts "$SCRATCH" /` and look at the four PNGs: the bar shows the six views with Explore current, the panel shows the intro and the topic table, and nothing runs off the page at phone width.

## Gotchas

- Numbers come from the bundle at build time; after `brain publish`, run `pnpm bundle` before looking.
- The scene is drawn for pointers only and hidden from assistive technology, so curl and axe never see it; every fact it shows must also be in the panel.
