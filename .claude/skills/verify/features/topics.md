# Topics

A reader picks a topic from the Explore view, sets how deep to read, and opens any sentence to see its evidence.

<!-- covers: page:/topics, page:/topics/[slug] -->

## Sub-features

- index: the topic table on `/` (home.md); `/topics` is a permanent redirect (308) there, kept so old links work.
- lede: the topic's lede claim opens the page, linked to its claim page; the body does not repeat it.
- dial: five stops; starts at Holder; the stop is kept in `?depth=`; nothing is stored in the browser; without script every claim shows.
- claim lines: each sentence is a `<details>`; opening it shows sources, quotes, checks with reader commands.
- margin: status (when not established), confidence bars, kind, depth, "Checked at block N".
- rail: contested and safety notices from the policy flags, the source ladder (spec, code, review, coverage, media), related topics.

## How to reach it

- A row of the topic table on `/` to `/topics/<slug>`; the scene; a claim page's crumb back to `/topics/<slug>#<claim id>`; `/topics` lands on `/`.
- `/topics/<slug>?depth=curious|user|holder|builder|researcher`.

## How to check it

Static: `pnpm lint`.

Runtime:

```sh
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:3721/topics
curl -s localhost:3721/ | grep -o 'href="/topics/[a-z-]*"' | sort -u
curl -s localhost:3721/topics/halvings-and-supply | grep -o 'class="claim-line"' | wc -l
curl -s localhost:3721/topics/halvings-and-supply | grep -o 'data-dial="2"'
~/.claude/claude-core/bin/heavy node .claude/skills/verify/dial.ts
~/.claude/claude-core/bin/heavy node tools/shots.ts "$SCRATCH" '/topics/halvings-and-supply!open'
```

Proves it when: `/topics` answers `308 http://localhost:3721/`; every published topic is linked from `/`; the claim-line count is the topic's claims minus the lede (22 for halvings); the body starts at `data-dial="2"` (Holder); `dial.ts` prints `ok` for all five stops; the `-open-` screenshots show the first claim expanded with quotes and a dark command box.

## Gotchas

- Unknown slugs 404 (`dynamicParams = false`); a new topic needs `pnpm bundle` and a dev reload.
- The dial counts include the lede, so visible lines are one fewer than the dial's number.
