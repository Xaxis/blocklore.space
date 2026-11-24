# Debates

A reader opens a map of a contested question: its positions side by side, each stance and argument with who holds it and when, and the claims of fact and definition the sides share, so they can see which disagreements evidence could settle and which are about values.

<!-- covers: page:/debates, page:/debates/[slug], api:GET /api/v1/debates, api:GET /api/v1/debates/[slug] -->

## Sub-features

- the rules (BACKLOG 24, CLAIMS.md "Debate maps"): `core/src/debateview.ts` `debateProblems(debate, claims, flags)` names each broken rule (`published`, `value node`, `empirical node`, `definitional node`, `position`, `edges`, `every side`, `own voice`, `contested`); `debateView` drops withdrawn nodes and their edges first, then returns a view or null with the problems. The bundle (`core/src/bundle.ts`) builds `bundle.debates` from the published claims and the published topics' flags; a map that breaks a rule is left out with a warning `debate <slug> is not shown: ...`, a node that names no claim or a slug used twice is an error, and `core/src/node/load.ts` refuses a file whose name is not its slug.
- the brain (`brain/src/debates.ts`): `brain check <run>` adds a `debate <name>` report per `debates/*.yaml` in the run folder to `checks.json` (published, pending and the run's own candidates count as there), so research repairs it with its claims. `brain publish` settles each offered map against the store after the commit: it writes `knowledge/debates/<slug>.yaml` when every rule holds and it differs from the published one; keeps it in `var/review/debates/<slug>.json` while gated nodes wait (run log `open`: "debate <slug> waits for N of its claims to pass the evaluator"); drops it with the rule names when it breaks a rule even counting pending claims, or when a node is an evaluator test claim. Every later commit to the store (publish, evaluator batch, owner approve, reject, revoke: `commitStore`) retries the waiting maps and says in its message which it publishes.
- `/debates`: the maps newest first, each with its question (linked), its positions and their claim counts, how many shared claims, its topics, and when it last changed (time and block); "How a map is made" links CLAIMS.md's section. With no map: "No debate map is published yet. ..." saying what a map needs to publish.
- `/debates/<slug>` (static, `dynamicParams = false`): crumbs to Debates, the question as the title, a lede saying Blocklore takes no side and the order is not a ranking, a "Contested question" chip, counts, topic links and the updated time and block. "Positions": a column per position (stacked on a phone), each claim a ClaimLine with its Stance or Argument chip that opens in place for its sources, "Held by" or "Argued by" its holders linked to where they said it, with the stated date from the cited source at that link, then "Supports", "Rebuts", "Supported by", "Rebutted by" as lists of numbered links to the other claims on the page. "What evidence or a shared definition could settle": "Evidence could settle" (facts, mechanisms, events, traces) and "A shared definition could settle" (definitions) on a tinted band. "How the claims bear on each other": every edge as "n supports m" with where each end sits.
- a topic a published map is filed under shows "Debate maps" in its rail with each question linked (the live page only, not the time machine).
- JSON: `GET /api/v1/debates` (static; each map in brief) and `GET /api/v1/debates/<slug>` (`{edition, debate}`, 404 `{"error"}` for an unknown slug), API.md "Debate maps"; the MCP tool `debates` (mcp.md); `/api/v1` and `/llms.txt` list them; the sitemap lists `/debates` and each map; the nav's Knowledge mode has a Debates tab; the scene shows the knowledge view.
- withdrawn (the owner's veto, `debate.withdraw`, `brain/src/revoke.ts` `withdrawDebateAt`; admin.md): the map file keeps every field and gains `withdrawn: {at, run, note}`; the bundle keeps it in `withdrawnDebates`, out of every list; `/debates/<slug>` stays (noindex) with a "Withdrawn" chip and a notice saying when, at which block, the owner's reason and the run, like a withdrawn claim's page; `GET /api/v1/debates` adds it under `withdrawn`, `GET /api/v1/debates/<slug>` answers 200 with `status: "withdrawn"` and `withdrawal`, the MCP tool `debates` answers it with "do not cite it as current"; the sitemap keeps the address. `brain check` reports a run's map at that slug with `debate: withdrawn` and the publisher drops it. The fixture holds one withdrawn map, `op-return-framing`, with its run log.

## How to reach it

- Nav Knowledge, tab "Debates"; a topic's rail "Debate maps"; `/debates/<slug>` directly; `GET /api/v1/debates`; the MCP tool `debates`.
- No map is published in the committed store yet (no published topic is contested), so the page is proven against a scratch copy of `knowledge/` with the fixture in `.claude/skills/verify/fixtures/debate/` laid over it: a contested fixture topic `data-carriers`, two fixture claims (an argument and a stance, attributed to "(test data)" holders at example.com, with evaluator review records) and the map `op-return-limit` over them and six real published `fees-and-mempool` claims. Never copy the fixture into the real `knowledge/`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/debateview.test.ts: each rule on its own, the view's sides, shared ground, holders' stated dates and edges, a withdrawn node dropping out, a side left empty hiding the map, and the bundle leaving out a map that breaks a rule; brain/test/debates.test.ts: `brain check` reports on a run's maps, publish writing a valid map that compiles, refusing one with a loaded word, holding one whose node waits and publishing it on the commit that publishes the node, dropping a waiting map whose node is gone, withdrawal keeping a map without the node or hiding it, and a test claim's map dropped).

Runtime, from the worktree root, on any free port (3742 here):

```sh
S=$(mktemp -d)/knowledge && cp -r knowledge "$S" && cp -r .claude/skills/verify/fixtures/debate/. "$S/"
BLOCKLORE_KNOWLEDGE=$S node core/cli.ts validate
(cd web && BLOCKLORE_KNOWLEDGE=$S ~/.claude/claude-core/bin/heavy pnpm build)
(cd web && pnpm exec next start --port 3742) &   # stop it when done
B=http://localhost:3742
curl -s $B/debates/op-return-limit | sed 's/<!-- -->//g' | grep -oE '<h1[^>]*>[^<]*|<h3 id="(side|ground)-[^"]*">[^<]*|(Argued|Held) by|stated [0-9]+ [A-Za-z]+ [0-9]+|How the claims bear'
curl -s $B/debates | grep -c 'href="/debates/op-return-limit"'
curl -s $B/topics/fees-and-mempool | grep -o 'Debate maps</h3>.\{0,200\}'
curl -s $B/api/v1/debates | python3 -I -c "import json,sys;d=json.load(sys.stdin)['debates'][0];print(d['slug'],[(p['label'],p['claims']) for p in d['positions']],d['empirical'],d['definitional'])"
curl -s $B/api/v1/debates/op-return-limit | python3 -I -c "import json,sys;d=json.load(sys.stdin)['debate'];print([[c['id'] for c in p['claims']] for p in d['positions']],len(d['shared']['empirical']),len(d['shared']['definitional']),len(d['edges']))"
curl -s -o /dev/null -w '%{http_code}\n' $B/api/v1/debates/no-such-map
curl -s $B/debates/op-return-framing | sed 's/<!-- -->//g' | grep -oE 'Withdrawn on [^<]*|no map publishes at this address again|href="/log/[^"]*"|noindex'
curl -s $B/debates | grep -c op-return-framing
curl -s $B/api/v1/debates | python3 -I -c "import json,sys;j=json.load(sys.stdin);print([d['slug'] for d in j['debates']],[(w['slug'],w['status']) for w in j['withdrawn']])"
curl -s $B/api/v1/debates/op-return-framing | python3 -I -c "import json,sys;d=json.load(sys.stdin)['debate'];print(d['status'],d['withdrawal']['run'])"
curl -s $B/sitemap.xml | grep -o '/debates[^<]*'
node .claude/skills/verify/mcpcheck.ts $B
~/.claude/claude-core/bin/heavy node tools/axe.ts $B /debates /debates/op-return-limit /debates/op-return-framing /topics/fees-and-mempool
~/.claude/claude-core/bin/heavy node tools/shots.ts OUT $B /debates /debates/op-return-limit
pnpm bundle   # put web/.generated back to the real store afterwards
```

Proves it when: validate reports `1 debates` (the withdrawn one is not counted) and 0 errors; the page prints the question as `<h1>`, `side-limit` "Keep a small default limit" and `side-relay` "Relay what miners will mine", two "Argued by" and one "Held by" with "stated 1 Jun 2025", "stated 2 Jul 2025" and "stated 6 Jun 2025", `ground-empirical` and `ground-definitional`, and "How the claims bear"; the index links the map once; the fees-and-mempool rail lists the question; the list prints `op-return-limit [('Keep a small default limit', 2), ('Relay what miners will mine', 1)] 3 2`; the map prints the two fixture ids then `fees-and-mempool.argument-relay-statement`, then `3 2 4`; the unknown slug is 404; the withdrawn map's page prints `Withdrawn on 23 Nov 2026, 23:40 UTC, at block 977,300.`, the closing sentence, `href="/log/2026-11-23-withdraw-map-op-return-framing"` and `noindex`, the index names it 0 times, the list prints `['op-return-limit'] [('op-return-framing', 'withdrawn')]` and its answer `withdrawn 2026-11-23-withdraw-map-op-return-framing`; the sitemap lists `/debates`, `/debates/op-return-limit` and `/debates/op-return-framing`; mcpcheck passes with `debates lists 1 maps` and `debates op-return-limit gives 2 positions, each with attributed claims`; axe reports `ok` for all 16 views. In the shots, the two positions sit side by side at desk width and one under the other on a phone, the shared band reads as one tinted block in both themes, and no card grid appears. Against the real store, `/debates` shows the empty state, `GET /api/v1/debates` answers `"debates": []` and mcpcheck prints `debates lists 0 maps`.

## Gotchas

- The scratch copy must be a folder named `knowledge`: the loader checks each file's place as `knowledge/claims/<topic>/<id>.yaml` from the folder's parent. `BLOCKLORE_KNOWLEDGE` is read by `core/cli.ts`, so `pnpm build` in web compiles the bundle from it; run `pnpm bundle` afterwards or the next dev server shows the fixture.
- A map's `contested` rule reads the published topics' flags, not `contested_terms`: a map filed only under `fees-and-mempool` is not shown until a topic it is filed under is contested. The fixture adds one.
- `/topics/data-carriers` in the fixture fails axe's heading-order: its only section is at researcher depth, which the depth dial hides on load, so the rail's h3 follows the h1. That is the fixture topic's shape, not the debate page; a real topic has shallower sections.
- Value nodes are always gated, so a real map nearly always waits in `var/review/debates/` first; never move one into `knowledge/` by hand.
