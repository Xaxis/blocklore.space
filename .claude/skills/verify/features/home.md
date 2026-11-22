# Home (the Brain view)

The app opens on the Brain: what Blocklore is in one plain sentence, then its research brain at work this minute (live from `/api/v1/brain`), how it works in four steps, what it did lately, what it knows, what it learns next, the latest changes and the way to connect your own AI, in the panel beside the 3D scene.

<!-- covers: page:/ -->

## Sub-features

- hero (`web/app/page.tsx`): the live status chip (`BrainStatus`: Connecting, Live, or Offline with when it was last heard), "A library of Bitcoin facts that checks itself." and one paragraph in plain words.
- live panel (`web/components/brain/Live.tsx`): `BrainNow` (what it does now, for how long, its topic when published, the next scheduled step, and a "Research" line whenever new research does not run on its own: paused, only when the owner starts it, or waiting for the plan's limit; from the feed's `research` field, `researchState` in `brain/src/feed.ts`; `curl -s https://blocklore.space/api/v1/brain` shows `feed.research`) and `BrainDay` (the last 24 hours: new items read, facts checked again, drafted, published, rejected, research sessions). Before the first answer the panel says "Connecting to the brain"; with no feed it says the brain is not reporting yet; when the copy is over 5 minutes old it says Offline.
- feed context (`web/components/brain/feed.tsx`): `BrainFeedProvider` in the root layout polls `GET /api/v1/brain` every 12 s while the tab is visible and the path is not under `/admin`; the scene and the Brain view read the same copy (`useBrainFeed`). `useNow` keeps relative times current; times render only after mount, so server and client HTML match.
- steps, two by two: It reads (sources cited), It checks (machine checks), It seals (the block the newest edition is timestamped in, linking `/verify`), It guards (threats and layers linking `/security`, and the newest lab run's passed tests), from `bundle.stats`, `bundle.snapshots` and `bundle.security`.
- what it did lately: `BrainEvents` (the 10 newest feed events, with their topic or single fact linked) and `BrainNext` (up to 4 scheduled steps); "Research log" links `/log`.
- what it knows: facts, topics and the share with a primary source, and the 8 largest topics as links; "All topics" links `/topics`.
- learning next: the 3 topics with the most open gaps (`bundle.gaps`), linking `/gaps`.
- latest changes: the 4 newest change events, and "Every change" to `/changes`.
- connect: "Bring your own AI", linking `/connect`.
- shell (`web/app/layout.tsx`): the bar with the modes (`ViewNav` in `web/components/SiteNav.tsx`, from `VIEWS` in `web/lib/nav.ts`: Brain, Knowledge, Proof (Sealed editions, Signatures, How it works); the current mode has `aria-current="true"`), the Connect button (`ConnectButton`, the view with `cta: true`; "Connect" at phone width), the mode's pages as tabs at the top of the panel (`ViewTabs`, `aria-current="page"`), the panel (`web/components/Panel.tsx`) and the scene (`web/components/scene/`), which every public view shares.

## How to reach it

- `http://localhost:3721/`, Brain in the bar, or the wordmark in any view.

## How to check it

Static: `pnpm lint` (typecheck web).

Runtime:

```sh
curl -s localhost:3721/ | sed 's/<!-- -->//g' | grep -oE 'A library of Bitcoin facts that checks itself\.|Connecting to the brain|It reads|It checks|It seals|It guards|What it knows|Latest changes|Bring your own AI|aria-label="Modes"|class="connect"|aria-current="page" href="/">Now' | sort -u
curl -s https://blocklore.space/api/v1/brain | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d['online'],d['feed'] and d['feed']['now']['text'])"
```

Proves it when: all eleven strings print (the server renders the live panel in its connecting state), and production prints `True` and what the brain does now. Locally the feed is `{"online":false,"feed":null}` (no Redis in `.env`), so the panel shows "Not reporting yet" after load.

Browser: `~/.claude/claude-core/bin/heavy node tools/shots.ts "$SCRATCH" https://blocklore.space /` (or the local base) and look at the PNGs: the bar shows the modes with Brain current and the Connect button, the panel shows the sentence, the live panel with a status and six numbers, and nothing runs off the page at phone width. Run `navfit.ts` after any change to `VIEWS` or the bar CSS.

## Gotchas

- Store numbers come from the bundle at build time; after `brain publish`, run `pnpm bundle` before looking.
- The live parts render on the client only. curl sees the connecting state, never the feed; check the feed with the API line above.
- The feed is empty of events until the brain runs a step on the new code (an hourly tick); "Nothing reported in the last day yet" is then correct, not a bug.
- The scene is drawn for pointers only and hidden from assistive technology, so curl and axe never see it; every fact it shows must also be in the panel.
