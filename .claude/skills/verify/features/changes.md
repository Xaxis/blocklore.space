# Changes

A reader follows every published, corrected or refined claim, newest first, in the page or as Atom.

<!-- covers: page:/changes, page:/changes/corrections, api:GET /changes.xml -->

## Sub-features

- log: every change event with time, block, the change, the statement, what it said before, the note, the run.
- corrections: only `corrected` events; an empty state says none yet.
- atom: up to 200 newest events as Atom entries, `application/atom+xml`.

## How to reach it

- Nav "Changes"; the masthead block pill; footer "Changes" and "Corrections"; `<link rel="alternate" type="application/atom+xml" href="/changes.xml">` in every page head.

## How to check it

Static: `pnpm lint`.

Runtime:

```sh
curl -s localhost:3721/changes | grep -o 'class="change created"' | wc -l
curl -s localhost:3721/changes/corrections | grep -o 'No corrections yet'
curl -sI localhost:3721/changes.xml | grep -i content-type
curl -s localhost:3721/changes.xml | grep -c '<entry>'
node -e 'console.log(require("./web/.generated/bundle.json").events.length)'
```

Proves it when: the created count (all events are creations until a revision lands) and the Atom entry count both equal the bundle's event count (up to 200), corrections shows its empty state while there are none, and the feed type is `application/atom+xml`.

## Gotchas

- `/changes.xml` is static (`force-static`); in dev it reflects the bundle at server start plus reloads.
