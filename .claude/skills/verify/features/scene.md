# The 3D scene of the store

One persistent three.js scene behind every public view: the chain as a row of blocks ending in the tip, topics as cages of claim points on an arc behind it, and threads from claims to the blocks they were checked at. It eases to each view as the path changes and never remounts.

<!-- covers: scene:store scene -->

## Sub-features

- shell: `web/components/scene/Scene.tsx` sits in the root layout (`web/app/layout.tsx`) beside the dock. `data-mode` is `loading`, `ready` or `fallback`, and the box is `aria-hidden="true"`: every fact it shows is also in the dock. `viewFor(path)` picks the state; `/admin` hides it.
- engine: `web/components/scene/engine.ts`, dynamically imported after the first public view mounts (three is not in first load). One renderer, instanced meshes, DPR capped at 1.75, paused off screen through an IntersectionObserver.
- data: `sceneData()` in `web/lib/graph.ts` (tip, topics with group and count, claims with depth, status, kind, a label cut to 96 characters, the heights they were seen and checked at, snapshots) in the layout's RSC payload, about 12 KB gzip.
- states: overview (`/`, `/gaps`, `/proposals`, `/bips`, `/about`, `/connect`: a slow orbit with a small turn per view), topic (`/topics/[slug]`: flies to the cage, dims the rest, one label), claim (`/claims/[id]`: an orange node with a ping ring and its thread to the chain), timeline (`/changes`, `/digest`, `/log`, `/pulse`: down the chain with event heights, snapshots and the tip labelled), verify (`/verify`: the snapshot rings in orange).
- labels: nearest first, hidden when they would collide with one already shown, held during flights; hovering a cage or a claim shows a tooltip, and clicking opens that topic or claim with `router.push`.
- motion: first load assembles over 1.4 s, flights take 1.2 s and can be interrupted. With `prefers-reduced-motion` it draws one still frame per view change. Without WebGL2 it shows a quiet SVG row of blocks (`Still`) and logs nothing.
- the dock's content enters with each view (`.dock-body` keyed by path, `dock-in` in `web/app/globals.css`, off under reduced motion).

## How to reach it

- Any public view at `http://localhost:3721/`; on desk to the right of the panel, below 900px as a band under the bar.

## How to check it

Static: `pnpm lint` (biome, typecheck web).

Runtime (the dev server on 3721):

```sh
heavy node .claude/skills/verify/scenecheck.ts /tmp/scenecheck
```

Proves it when: all eight lines print `ok` and it exits 0: the scene starts and is aria-hidden; one canvas, the same one, after a client navigation; hovering shows a tooltip; clicking opens a topic; the admin hides it; no page errors; on a phone the frames per second drop to 0 or near it when scrolled away and come back; without WebGL the still drawing shows with no canvas and no page errors. Then look at `scene-home.png`, `scene-topic.png` and `scene-nowebgl.png` in the folder.

For the states, `heavy node tools/shots.ts /tmp/shots / /topics/segwit /claims/lightning.anchor-outputs /changes /verify` and look at the desk and phone PNGs: topic labels never overlap, the claim node is orange with its thread, the timeline shows the snapshot ring and the tip.

## Gotchas

- In `next dev`, React's double effect runs the start twice; a generation counter drops the stale import, so there is one engine. Two canvases mean that guard broke.
- Playwright going straight from one route to one the dev server has not compiled can fail with "navigation interrupted"; go through `about:blank`.
- Frame times under SwiftShader on a loaded box (median about 33 ms) are a worst case, not a GPU number.
- Never put a fact only in the scene: the dock must say everything the scene shows.
