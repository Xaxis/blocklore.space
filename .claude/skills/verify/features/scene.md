# The 3D scene of the store

One persistent three.js scene behind every public view: the chain as a row of blocks ending in the tip, which is the edition's block (labelled "Edition" with its height, as the header's block is: the block the store was compiled at, not the chain's tip, which runs up to the next deploy ahead), topics as cages of claim points on an arc above it, threads from claims to the blocks they were last checked at, snapshot rings around the chain, and below the ground the strata of the security watch with a node per threat. The brain's live feed plays over it. It flies to each view as the path changes and never remounts.

<!-- covers: scene:store scene -->

## Sub-features

- shell: `web/components/scene/Scene.tsx` sits in the root layout (`web/app/layout.tsx`) beside the dock. Props: `data: SceneData`; the live feed comes from `useBrainFeed()` (`web/components/brain/feed.tsx`, the `BrainFeedProvider` around the scene and the panel in the layout, polling `/api/v1/brain` every 12 s). `data-mode` is `loading`, `ready` or `fallback`, and the box is `aria-hidden="true"`: every fact it shows is also in the panel. `viewFor(path)` picks the view; `/admin` hides it.
- engine: `web/components/scene/engine.ts`, dynamically imported after the first public view mounts (three is not in first load). One renderer, instanced meshes, DPR capped at 1.75, paused off screen through an IntersectionObserver. No allocation in the frame loop (scratch vectors, colors and label slots; plain loops). `controls.ts` (drag, wheel, pinch, tap) and `sparks.ts` (a fixed pool of travelling lights) are its parts.
- data: `sceneData()` in `web/lib/graph.ts`: tip, topics, claims (depth, status, kind, a label cut to 96 characters, the heights seen and checked, `links` to related claims as indices), snapshots (`anchor`: the block the OpenTimestamps proof sits in; `signed` once OrangeCheck signatures land), `security` layers with threats and their live status (`securityScene()` in `web/lib/security.ts`, from `bundle.security`).
- views (`viewFor`, following the modes in `web/lib/nav.ts`): brain (`/`, `/gaps`, `/connect`, `/about/api`: the whole store from the front right with the tip near and the top strata faint, a slow orbit, driven by the feed), knowledge (`/topics`, `/proposals`, `/bips`, `/bolts`, `/debates`: topic labels, a small turn per page), topic (`/topics/[slug]`), claim (`/claims/[id]`: orange node, ping, its thread in orange, synapses to its related claims), timeline (`/changes`, `/digest`, `/log`, `/pulse`: down the chain with event heights), security (`/security`: the strata named, threats green, amber or red by status, open ones with a halo; `/security/[id]` flies to that threat and pings it), proof (`/verify`, `/verify/keys`, `/verify/evaluator`, `/about`, a small turn per page: snapshot rings orange and locked to their proof's block, dashed while pending, a hexagonal seal on signed ones, their blocks outlined).
- feed: `engine.signal(event)` plays one `FeedEvent`, queued 0.45 s apart: research and verify scan the topic's cage with a ring; recheck pulses the named claims, sparks run down their threads and the threads move to the tip; publish grows the named claims (new ids grow in as new points in the topic's cluster); snapshot closes a ring on the tip and locks it; evaluate sweeps a hairline across the arc and lights the decided claims; watch sends a wave down the strata; lab fires replayed attacks at a threat, which answers in its outcome's color; ingest brings sparks in from outside; idle breathes. `engine.setAmbient(now)` keeps the current activity going quietly (the researched topic's label shows with an orange dot). Scene.tsx plays only events new since the last copy (keyed on at, kind and text), the newest one on the first copy if it is under two minutes old, and rests the scene (`paused`) when the provider says the brain is not `online`. The corner caption names the activity in the brain view with the panel's words (`ACTIVITY_WORD`).
- interaction: drag turns the camera (damped, with a coast), and 1.6 s after the pointer leaves (7 s if it rests on the scene) it eases back to the view's framing. The wheel zooms within 0.35x to 2x where the scene is the stage (a desk); in the phone band only a pinch (or ctrl plus wheel) zooms, so the page still scrolls. Hover lights a claim, its thread and its related claims (synapses), a topic and its threads, a block and the claims last checked there, a threat with its layer and status, a stratum, a snapshot ring. Click opens a claim, topic, threat (`/security/<id>`) or snapshot (`/verify#snapshot-N`) with `router.push`. Views fly on an arc in 0.95 to 1.8 s by distance and can be interrupted.
- corner: the activity caption (brain view), a key where a mark is not obvious (claims and threads; threat statuses; snapshot, pending, signed), and a "drag to turn" hint that fades after the first drag or zoom. Phones show only the caption.
- motion: first load assembles over 1.4 s. With `prefers-reduced-motion` it draws one still frame per change: signals only apply what stays true (threads at the tip, new points, the sealed ring), the researched topic's cage is tinted, drags still turn without coasting or returning. Without WebGL2 it shows a quiet SVG row of blocks (`Still`) and logs nothing.
- development: `?scene=fixture` (only when `NODE_ENV` is not production; `web/components/scene/fixture.ts`) signs the newest snapshot, adds a pending one, and replays a script of every event kind over the real store every 3.5 s; `?scene=fixture-data` does the same without the script. In development `window.__scene` is the engine (`probe()`, `signal()`), which `scenecheck.ts` uses.
- the dock's content enters with each view (`.dock-body` keyed by path, `dock-in` in `web/app/globals.css`, off under reduced motion).

## How to reach it

- Any public view at `http://localhost:3721/`; on desk to the right of the panel, below 900px as a band under the bar. Add `?scene=fixture` in `pnpm dev` to see every feed animation without the daemon.

## How to check it

Static: `pnpm lint` (biome, typecheck web).

Runtime (`next dev`; the feed checks need the fixture and `window.__scene`):

```sh
heavy node .claude/skills/verify/scenecheck.ts /tmp/scenecheck http://localhost:3721
```

Proves it when every line prints `ok` and it exits 0: start and aria-hidden; brain view on `/`; one canvas across a client navigation; topic view; a hover over something that links shows a tooltip and the click opens it; knowledge view on `/topics`; a drag turns the camera by more than 0.5 rad without navigating, and it returns to under 0.03 rad once the pointer is on the panel; the wheel zooms to the limits (-1.05 and 0.7, log of the distance) with the page unscrolled, and over the panel scrolls the panel instead; the fixture's feed sets the ambient state and plays; on `?scene=fixture-data` exactly eleven hand-sent events of every kind play with no page error (it prints the frame interval); `/security` draws at least as many threats as the page links, a threat hovers with its status and a click opens its real `/security/<id>` page; `/verify` (the real store) is the proof view and a ring hovers as a snapshot; `/verify/keys` and `/verify/evaluator` are the proof view; reduced motion settles events in a few frames; the admin hides the scene; no page errors; the phone's frames drop to 0 or near when scrolled away and come back; without WebGL the still drawing. Then look at the PNGs: `view-<view>-<desk|phone>-<light|dark>.png` for brain, knowledge, proposals, topic, claim, timeline, security, threat and proof, plus `scene-signals.png`, `scene-proof.png` and `scene-nowebgl.png`.

## Gotchas

- In `next dev`, React's double effect runs the start twice; a generation counter drops the stale import, so there is one engine. Two canvases mean that guard broke.
- Playwright going straight from one route to one the dev server has not compiled can fail with "navigation interrupted"; go through `about:blank`.
- Frame times under SwiftShader on a loaded box are a worst case, not a GPU number. The frame step is capped at 0.1 s, so on a slow box animations (and the return home) run slower in wall time.
- Threat ids in `SceneData.security` are the slugs of `/security/<id>`; a threat click goes there.
- Never put a fact only in the scene: the panel must say everything the scene shows, including the activity in the corner caption.
- The fixture must never ship: check a production build's chunks for `fixture-` and `scene=fixture` (none).
