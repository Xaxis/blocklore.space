# Changes

A reader follows every published, corrected or refined claim, newest first, in the page, as Atom or RSS, or a UTC day at a time in the digest.

<!-- covers: page:/changes, page:/changes/corrections, api:GET /changes.xml, api:GET /rss.xml, page:/digest, page:/digest/[date] -->

## Sub-features

- log: every change event with time, block, the change, the statement, what it said before, the note, the run.
- corrections: only `corrected` events; an empty state says none yet. Below them a "Reader reports" block (`#reports`, `ReportLog`) lists every reader report with its outcome, fetched in the browser ([problems](problems.md)).
- atom: up to 200 newest events as Atom entries, `application/atom+xml`.
- rss: the newest 100 events as RSS 2.0, `application/rss+xml`, for readers without Atom.
- digest: `/digest` lists each UTC day with events or BIP index changes (block range, counts, topics); `/digest/<date>` shows corrections first (with the old wording struck), new claims grouped by topic, other revisions, BIP index moves and the runs that finished, with links to the day before and after. Compiled by `digestDays` in `core/src/digest.ts`; no stored prose. Unknown days are 404 (`dynamicParams = false`).

## How to reach it

- Nav "Changes"; footer "Changes" and "Corrections"; "Every change" and "Daily digest" on Pulse; "daily digest" in the Changes lede; `<link rel="alternate">` for `/changes.xml` (Atom) and `/rss.xml` (RSS) in every page head.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/digest.test.ts).

Runtime:

```sh
curl -s localhost:3721/changes | grep -o 'class="change created"' | wc -l
curl -s localhost:3721/changes/corrections | grep -o 'No corrections yet'
curl -sI localhost:3721/changes.xml | grep -i content-type
curl -s localhost:3721/changes.xml | grep -c '<entry>'
curl -sI localhost:3721/rss.xml | grep -i content-type; curl -s localhost:3721/rss.xml | grep -c '<item>'
node -e 'console.log(require("./web/.generated/bundle.json").events.length)'
D=$(node -e 'const e=require("./web/.generated/bundle.json").events;console.log(e.map(x=>x.at.time).sort().at(-1).slice(0,10))')
curl -s -o /dev/null -w '%{http_code}\n' localhost:3721/digest/$D; curl -s -o /dev/null -w '%{http_code}\n' localhost:3721/digest/2000-01-01
curl -s localhost:3721/digest/$D | grep -o 'class="digest-lines"' | wc -l
node -e 'const e=require("./web/.generated/bundle.json").events;const d=process.argv[1];console.log(e.filter(x=>x.at.time.startsWith(d)).length)' $D
curl -s localhost:3721/digest/$D | grep -oE '<li><a href="/claims/' | wc -l
```

Proves it when: the created count (all events are creations until a revision lands) and the Atom entry count both equal the bundle's event count (up to 200), corrections shows its empty state while there are none, the feed type is `application/atom+xml`, and RSS answers `application/rss+xml` with min(events, 100) items. The digest for the newest day answers 200 and 2000-01-01 answers 404; its claim lines (`<li><a href="/claims/`) equal that day's event count from the bundle.

## Gotchas

- The digest groups by UTC date of the event stamp, not the reader's local day.

- `/changes.xml` is static (`force-static`); in dev it reflects the bundle at server start plus reloads.
