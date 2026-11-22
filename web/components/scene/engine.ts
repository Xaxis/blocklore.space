import type { Activity, FeedEvent } from "@blocklore/core/feed";
import * as THREE from "three";
import type { SceneData } from "@/lib/graph";
import { type Controls, createControls } from "./controls";
import { createSparks } from "./sparks";

// The ledger: Blocklore's store drawn as a model anchored to the chain. A long axis of blocks, one
// cluster per topic on an arc above it, a node per claim and a thread from each claim to the
// block it was last checked at. Snapshots are rings around the axis. Below the ground lie the
// strata of the security watch, one per layer of Bitcoin, with a node per threat. The brain's
// live feed plays over all of it. One renderer for the app's lifetime; views ease into each other.

export type View =
  | { kind: "brain"; variant: number }
  | { kind: "knowledge"; variant: number }
  | { kind: "topic"; slug: string }
  | { kind: "claim"; id: string }
  | { kind: "timeline" }
  | { kind: "security"; threat?: string }
  | { kind: "proof"; variant: number };

export type Tone = "defended" | "watching" | "open" | "accent";

export interface Hover {
  label: string;
  meta: string;
  tone?: Tone;
  x: number;
  y: number;
}

/** What the brain is doing right now (the feed's `now`), or null when no feed has come. */
export interface Ambient {
  kind: Activity;
  topic?: string;
}

/** The engine's state for checks: camera, offsets, what plays. */
export interface Probe {
  view: View["kind"];
  theta: number;
  phi: number;
  distance: number;
  zoom: number;
  offset: { theta: number; phi: number; zoom: number };
  playing: number;
  frames: number;
  signals: number;
  ambient: Activity | null;
  threats: number;
}

export interface EngineOptions {
  reduced: boolean;
  dark: boolean;
  classes: {
    label: string;
    topic: string;
    block: string;
    tip: string;
    on: string;
    stratum: string;
    active: string;
    threat: string;
  };
  onHover: (h: Hover | null) => void;
  onPick: (href: string) => void;
  /** The reader turned or zoomed the scene (the hint can go). */
  onUse?: () => void;
}

export interface Engine {
  setView(v: View): void;
  setReduced(r: boolean): void;
  setTheme(dark: boolean): void;
  setActive(on: boolean): void;
  resize(width: number, height: number, panel: number): void;
  /** Plays one event from the brain's feed. */
  signal(e: FeedEvent): void;
  /** The continuous state from the feed's `now`. */
  setAmbient(a: Ambient | null): void;
  probe(): Probe;
  dispose(): void;
}

const DEPTHS = ["curious", "user", "holder", "builder", "researcher"];
const GROUPS = ["foundations", "mining", "protocol", "layers", "custody", "governance", "history"];
const ORANGE = new THREE.Color("#f7931a");
const LAYER = [0.42, 0.72, 1.02, 1.32, 1.62];
const CAGE = 1.9;
const AXIS = 24;
/** The clusters stand on an arc behind the chain, like seats in an amphitheater. */
const ARC = { radius: 11, spread: 1.16, z: 3.5 };
const ASSEMBLE = 1.4;
/** The strata: the first just under the ground, then one per layer, each this far below. */
const STRATA = { top: -1.15, gap: 1.6, depth: 2.3 };
const SPARKS = 128;
const GHOSTS = 40;
const SYNAPSES = 48;
const FX = 16;
const FX_LIST = 40;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (t: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, t));
/** A bump: 0 at the ends of [0, 1], 1 in the middle. */
const bump = (t: number) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A stable number in [0, 1) from a string, so a layout never changes between visits. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function dirty(geo: THREE.BufferGeometry, name: string) {
  const a = geo.getAttribute(name);
  if (a) a.needsUpdate = true;
}

interface Palette {
  bg: THREE.Color;
  ink: THREE.Color;
  face: THREE.Color;
  faceDim: THREE.Color;
  status: Record<"defended" | "watching" | "open", THREE.Color>;
}

function palette(dark: boolean): Palette {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = css.getPropertyValue(name).trim();
    return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback);
  };
  return {
    bg: read("--bg-subtle", dark ? "#111419" : "#f7f8fa"),
    ink: read("--ink", dark ? "#e8ebf0" : "#0f1217"),
    face: dark ? new THREE.Color("#1a1e26") : new THREE.Color("#ffffff"),
    faceDim: dark ? new THREE.Color("#14171d") : new THREE.Color("#fbfbfc"),
    status: {
      defended: read("--ok", dark ? "#4cc370" : "#17803d"),
      watching: read("--warn", dark ? "#e5a440" : "#9a5b00"),
      open: read("--bad", dark ? "#ff6b70" : "#c4262e"),
    },
  };
}

/** A unit circle as a line loop's points, in the plane the two axes name. */
function circle(seg: number, plane: "xz" | "yz"): THREE.BufferGeometry {
  const pts = new Float32Array(seg * 3);
  for (let i = 0; i < seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    if (plane === "xz") pts.set([Math.cos(th), 0, Math.sin(th)], i * 3);
    else pts.set([0, Math.sin(th), Math.cos(th)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  return g;
}

type FxKind = "scan" | "pulse" | "grow" | "ring" | "sweep" | "strata" | "lab" | "ingest" | "breath";

interface Fx {
  on: boolean;
  kind: FxKind;
  t0: number;
  dur: number;
  /** A topic, threat or claim index, or -1. */
  a: number;
  tone: number;
  list: Int32Array;
  n: number;
  fired: number;
  seed: number;
  /** Rechecks move threads to the tip; ambient pulses only light them. */
  move: boolean;
}

export function createEngine(
  container: HTMLElement,
  overlay: HTMLElement,
  data: SceneData,
  opts: EngineOptions,
): Engine | null {
  // Ask quietly first: three logs an error when it cannot get a context, and the still drawing
  // is the expected path, not a failure.
  const probeGl = document.createElement("canvas").getContext("webgl2");
  if (!probeGl) return null;
  probeGl.getExtension("WEBGL_lose_context")?.loseContext();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.style.display = "block";
  container.prepend(renderer.domElement);

  let reduced = opts.reduced;
  let dark = opts.dark;
  let pal = palette(dark);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(pal.bg, 20, 70);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9099, 2.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-6, 14, 9);
  scene.add(hemi, sun);

  // --- the axis --------------------------------------------------------------------------------

  const heights = [
    ...data.claims.flatMap((c) => [c.seen, c.checked]),
    ...data.snapshots.flatMap((s) => (s.anchor ? [s.height, s.anchor] : [s.height])),
    ...(data.tip ? [data.tip] : []),
  ];
  const minH = heights.length ? Math.min(...heights) : 0;
  const tip = data.tip ?? (heights.length ? Math.max(...heights) : 0);
  const range = Math.max(1, tip - minH);
  const events = new Set(heights);
  const every = range <= 600 ? 1 : Math.ceil(range / 300);
  const blockHeights: number[] = [];
  for (let h = minH; h <= tip; h++)
    if (events.has(h) || (h - minH) % every === 0) blockHeights.push(h);
  const step = AXIS / Math.max(range, 1);
  const xOf = (h: number) => (h - minH) * step - AXIS / 2;
  const blockW = Math.min(step * 0.74, 0.62);

  interface Block {
    h: number;
    event: boolean;
    size: THREE.Vector3;
    pos: THREE.Vector3;
  }
  const blocks: Block[] = blockHeights.map((h) => {
    const event = events.has(h);
    const size = new THREE.Vector3(blockW, event ? 0.95 : 0.34, event ? 1.7 : 1.05);
    return { h, event, size, pos: new THREE.Vector3(xOf(h), size.y / 2, 0) };
  });
  const blockIdx = new Map(blocks.map((b, i) => [b.h, i]));
  const tipIdx = blockIdx.get(tip) ?? blocks.length - 1;
  const tipTop = new THREE.Vector3(xOf(tip), blocks[tipIdx]?.size.y ?? 0.95, 0);

  const blockMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    Math.max(blocks.length, 1),
  );
  blockMesh.count = blocks.length;
  scene.add(blockMesh);

  const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)).attributes.position
    ?.array as Float32Array;
  const edgeGeo = new THREE.BufferGeometry();
  const edgePos = new Float32Array(blocks.length * unitEdges.length);
  const edgeCol = new Float32Array(blocks.length * unitEdges.length);
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute("color", new THREE.BufferAttribute(edgeCol, 3));
  const edges = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  scene.add(edges);

  // --- clusters and claims ---------------------------------------------------------------------

  const topics = [...data.topics].sort(
    (a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.title.localeCompare(b.title),
  );
  const topicIdx = new Map(topics.map((t, i) => [t.slug, i]));
  const nT = Math.max(topics.length, 1);
  interface Cluster {
    center: THREE.Vector3;
    angle: number;
  }
  const clusters: Cluster[] = topics.map((_, i) => {
    const u = nT === 1 ? 0.5 : i / (nT - 1);
    const angle = (u - 0.5) * 2 * ARC.spread;
    return {
      angle,
      center: new THREE.Vector3(
        Math.sin(angle) * ARC.radius,
        4.4 + Math.cos(angle) * 1.8 + (i % 2) * 1.5,
        ARC.z - Math.cos(angle) * ARC.radius,
      ),
    };
  });

  const claims = data.claims.filter((c) => topicIdx.has(c.topic));
  const claimIdx = new Map(claims.map((c, i) => [c.id, i]));
  const claimTopic = Int16Array.from(claims, (c) => topicIdx.get(c.topic) ?? 0);
  const byTopic: number[][] = topics.map(() => []);
  claims.forEach((_, i) => {
    byTopic[claimTopic[i] ?? 0]?.push(i);
  });
  // Related claims, as engine indices, for the synapses on hover.
  const dataToEngine = data.claims.map((c) => claimIdx.get(c.id) ?? -1);
  const links: number[][] = claims.map((c) =>
    (c.links ?? []).map((k) => dataToEngine[k] ?? -1).filter((k) => k >= 0),
  );

  const nodePos: THREE.Vector3[] = new Array(claims.length);
  {
    const layers = new Map<string, number[]>();
    claims.forEach((c, i) => {
      const k = `${c.topic}|${Math.max(0, DEPTHS.indexOf(c.depth))}`;
      layers.set(k, [...(layers.get(k) ?? []), i]);
    });
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (const [k, list] of layers) {
      const [slug, d] = k.split("|");
      const center = clusters[topicIdx.get(slug ?? "") ?? -1]?.center ?? new THREE.Vector3();
      const r = LAYER[Number(d)] ?? 1;
      const spin = hash01(k) * Math.PI * 2;
      list.forEach((ci, j) => {
        const n = list.length;
        const y = n === 1 ? 0.3 : 1 - (2 * (j + 0.5)) / n;
        const rad = Math.sqrt(1 - y * y);
        const th = golden * j + spin;
        nodePos[ci] = new THREE.Vector3(
          center.x + Math.cos(th) * rad * r,
          center.y + y * r * 0.82,
          center.z + Math.sin(th) * rad * r,
        );
      });
    }
  }

  const nodeMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.06, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    Math.max(claims.length, 1),
  );
  nodeMesh.count = claims.length;
  scene.add(nodeMesh);

  // Contested claims carry a hollow ring, turned to the camera.
  const contested = claims.map((c, i) => (c.status === "contested" ? i : -1)).filter((i) => i >= 0);
  const ringMesh = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.15, 0.18, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    Math.max(contested.length, 1),
  );
  ringMesh.count = contested.length;
  scene.add(ringMesh);

  // Threads: each claim down to the block it was last checked at. A recheck moves the low end to
  // the tip, so the anchors are live.
  const threadGeo = new THREE.BufferGeometry();
  const threadPos = new Float32Array(claims.length * 6);
  const threadCol = new Float32Array(claims.length * 8);
  threadGeo.setAttribute("position", new THREE.BufferAttribute(threadPos, 3));
  threadGeo.setAttribute("color", new THREE.BufferAttribute(threadCol, 4));
  const threads = new THREE.LineSegments(
    threadGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  scene.add(threads);
  const anchorBlock = Int32Array.from(claims, (c) => blockIdx.get(c.checked) ?? tipIdx);
  const topOf = (bi: number, out: THREE.Vector3) => {
    const b = blocks[bi];
    return b ? out.set(b.pos.x, b.size.y, 0) : out.set(0, 0, 0);
  };
  const anchors = claims.map((_, i) => topOf(anchorBlock[i] ?? tipIdx, new THREE.Vector3()));
  const reFrom = claims.map(() => new THREE.Vector3());
  const reT0 = new Float32Array(claims.length).fill(-1);
  const perBlock = new Int32Array(blocks.length);
  for (const b of anchorBlock) perBlock[b] = (perBlock[b] ?? 0) + 1;

  // Cages: three great circles per cluster, a stem to the ground and a foot.
  const SEG = 72;
  const cageVerts = (SEG * 3 + 3) * 2;
  const cageGeo = new THREE.BufferGeometry();
  const cagePos = new Float32Array(topics.length * cageVerts * 3);
  const cageCol = new Float32Array(topics.length * cageVerts * 3);
  topics.forEach((_, ti) => {
    const c = clusters[ti]?.center ?? new THREE.Vector3();
    let o = ti * cageVerts * 3;
    const put = (x: number, y: number, z: number) => {
      cagePos[o++] = x;
      cagePos[o++] = y;
      cagePos[o++] = z;
    };
    for (const axis of [0, 1, 2])
      for (let s = 0; s < SEG; s++)
        for (const a of [s, s + 1]) {
          const th = (a / SEG) * Math.PI * 2;
          const p = Math.cos(th) * CAGE;
          const q = Math.sin(th) * CAGE;
          if (axis === 0) put(c.x + p, c.y, c.z + q);
          else if (axis === 1) put(c.x + p, c.y + q * 0.82, c.z);
          else put(c.x, c.y + q * 0.82, c.z + p);
        }
    put(c.x, c.y - CAGE * 0.82, c.z);
    put(c.x, 0, c.z);
    put(c.x - 0.35, 0, c.z);
    put(c.x + 0.35, 0, c.z);
    put(c.x, 0, c.z - 0.35);
    put(c.x, 0, c.z + 0.35);
  });
  cageGeo.setAttribute("position", new THREE.BufferAttribute(cagePos, 3));
  cageGeo.setAttribute("color", new THREE.BufferAttribute(cageCol, 3));
  const cages = new THREE.LineSegments(
    cageGeo,
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  scene.add(cages);

  // The ground: an engineering grid, major lines every five units.
  const gridGeo = new THREE.BufferGeometry();
  const gridLines: number[] = [];
  const gridMajor: boolean[] = [];
  for (let x = -30; x <= 30; x++) {
    gridLines.push(x, 0, -14, x, 0, 14);
    gridMajor.push(x % 5 === 0);
  }
  for (let z = -14; z <= 14; z++) {
    gridLines.push(-30, 0, z, 30, 0, z);
    gridMajor.push(z % 5 === 0);
  }
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridLines, 3));
  const gridCol = new Float32Array(gridLines.length);
  gridGeo.setAttribute("color", new THREE.BufferAttribute(gridCol, 3));
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  grid.position.y = -0.002;
  scene.add(grid);

  // Snapshots: two thin rings around the axis, locked to the block their proof sits in, or dashed
  // at the height they were taken while the proof is pending. A signed snapshot carries a seal.
  const RING = 64;
  const snapX = data.snapshots.map((s) => xOf(s.anchor ?? s.height));
  const snapGeo = new THREE.BufferGeometry();
  const snapPos = new Float32Array(data.snapshots.length * RING * 2 * 2 * 3);
  const snapCol = new Float32Array(snapPos.length);
  data.snapshots.forEach((s, si) => {
    const x = snapX[si] ?? 0;
    let o = si * RING * 4 * 3;
    for (const r of [1.45, 1.58])
      for (let k = 0; k < RING; k++)
        for (const a of [k, k + 1]) {
          // a pending proof draws every other segment
          const gap = !s.anchor && k % 2 === 1;
          const th = ((gap ? k : a) / RING) * Math.PI * 2;
          snapPos[o++] = x;
          snapPos[o++] = 0.5 + Math.sin(th) * r;
          snapPos[o++] = Math.cos(th) * r;
        }
  });
  snapGeo.setAttribute("position", new THREE.BufferAttribute(snapPos, 3));
  snapGeo.setAttribute("color", new THREE.BufferAttribute(snapCol, 3));
  const snaps = new THREE.LineSegments(
    snapGeo,
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  scene.add(snaps);
  const anchorBlocks = new Set(
    data.snapshots.flatMap((s) => (s.anchor ? [blockIdx.get(s.anchor) ?? -1] : [])),
  );

  const signed = data.snapshots.map((s, i) => (s.signed ? i : -1)).filter((i) => i >= 0);
  const sealMat = new THREE.MeshBasicMaterial({
    color: ORANGE,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const seal = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.17, 6),
    sealMat,
    Math.max(signed.length, 1),
  );
  seal.count = signed.length;
  const sealRim = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.23, 0.26, 6),
    sealMat,
    Math.max(signed.length, 1),
  );
  sealRim.count = signed.length;
  scene.add(seal, sealRim);
  const sealAt = signed.map((si) => new THREE.Vector3(snapX[si] ?? 0, 0.5 + 1.58 + 0.34, 0));

  // --- the strata: the security watch, one layer of Bitcoin each, threats on them ----------------

  const layers = data.security ?? [];
  const nL = layers.length;
  const SX0 = xOf(minH) + AXIS * 0.08;
  const SX1 = xOf(tip) + 0.5;
  const layerY = (k: number) => STRATA.top - k * STRATA.gap;
  interface Threat {
    id: string;
    label: string;
    status: "defended" | "watching" | "open";
    layer: number;
    pos: THREE.Vector3;
  }
  const threats: Threat[] = layers.flatMap((l, k) =>
    l.threats.map((t, j) => {
      const n = l.threats.length;
      const span = (SX1 - SX0) / Math.max(n, 1);
      return {
        id: t.id,
        label: t.label,
        status: t.status,
        layer: k,
        pos: new THREE.Vector3(
          SX0 + (j + 0.5) * span + (hash01(t.id) - 0.5) * span * 0.5,
          layerY(k) + 0.13,
          (hash01(`${t.id}|z`) - 0.5) * STRATA.depth * 1.4,
        ),
      };
    }),
  );
  const threatIdx = new Map(threats.map((t, i) => [t.id, i]));
  const STRATUM_SEGS = 4 + 2 + Math.floor((SX1 - SX0) / 2) + 1;
  const strataGeo = new THREE.BufferGeometry();
  const strataPos = new Float32Array(nL * STRATUM_SEGS * 6);
  const strataCol = new Float32Array(strataPos.length);
  for (let k = 0; k < nL; k++) {
    let o = k * STRATUM_SEGS * 6;
    const y = layerY(k);
    const D = STRATA.depth;
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      strataPos.set([x1, y, z1, x2, y, z2], o);
      o += 6;
    };
    seg(SX0, -D, SX1, -D);
    seg(SX1, -D, SX1, D);
    seg(SX1, D, SX0, D);
    seg(SX0, D, SX0, -D);
    seg(SX0, -D / 3, SX1, -D / 3);
    seg(SX0, D / 3, SX1, D / 3);
    // ticks along the front edge, like a ruler
    for (let x = SX0 + 2, i = 0; i < STRATUM_SEGS - 6; x += 2, i++) seg(x, D, x, D - 0.28);
  }
  strataGeo.setAttribute("position", new THREE.BufferAttribute(strataPos, 3));
  strataGeo.setAttribute("color", new THREE.BufferAttribute(strataCol, 3));
  const strata = new THREE.LineSegments(
    strataGeo,
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  scene.add(strata);

  const threatMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.17, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    Math.max(threats.length, 1),
  );
  threatMesh.count = threats.length;
  scene.add(threatMesh);
  // An open threat wears a halo that breathes.
  const open = threats.map((t, i) => (t.status === "open" ? i : -1)).filter((i) => i >= 0);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const halo = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.2, 0.225, 32),
    haloMat,
    Math.max(open.length, 1),
  );
  halo.count = open.length;
  scene.add(halo);

  // --- the live layer: what the brain does, drawn as it happens ---------------------------------

  const sparks = createSparks(SPARKS);
  scene.add(sparks.group);

  // A scan: a ring that hugs a cage as it rises and falls through it. Two: the brain's current
  // session and one for an event.
  const scanGeo = circle(72, "xz");
  const scanners = [0, 1].map(() => {
    const m = new THREE.LineLoop(
      scanGeo,
      new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, depthWrite: false }),
    );
    m.visible = false;
    scene.add(m);
    return m;
  });
  const scanY = new Float32Array(2).fill(Number.NaN);
  const scanTopic = new Int16Array(2).fill(-1);

  // The evaluator's sweep: a vertical hairline that walks the arc.
  const sweepGeo = new THREE.BufferGeometry();
  const sweepPos = new Float32Array(6);
  sweepGeo.setAttribute("position", new THREE.BufferAttribute(sweepPos, 3));
  const sweepLine = new THREE.LineSegments(
    sweepGeo,
    new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, depthWrite: false }),
  );
  sweepLine.visible = false;
  scene.add(sweepLine);

  // A snapshot being sealed: a ring that closes on the tip and locks. The last one sealed stays.
  const ringGeo = circle(96, "yz");
  const forming = new THREE.LineLoop(
    ringGeo,
    new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, depthWrite: false }),
  );
  forming.visible = false;
  forming.position.set(tipTop.x, 0.5, 0);
  const sealed = new THREE.LineLoop(
    ringGeo,
    new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, depthWrite: false }),
  );
  sealed.visible = false;
  sealed.position.copy(forming.position);
  sealed.scale.setScalar(1.52);
  scene.add(forming, sealed);
  let sealedAt = -1;

  // The tip's halo, when something arrives at it.
  const tipRing = new THREE.LineLoop(
    ringGeo,
    new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, depthWrite: false }),
  );
  tipRing.visible = false;
  tipRing.position.set(tipTop.x, tipTop.y * 0.5, 0);
  scene.add(tipRing);

  // Claims that publish while the page is open: they grow into their cluster.
  const ghostMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.06, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    GHOSTS,
  );
  ghostMesh.count = 0;
  scene.add(ghostMesh);
  const ghostPos = Array.from({ length: GHOSTS }, () => new THREE.Vector3());
  const ghostT0 = new Float32Array(GHOSTS);
  const ghostIds = new Set<string>();

  // Synapses: from the claim in focus to the claims it names as related.
  const synGeo = new THREE.BufferGeometry();
  const synPos = new Float32Array(SYNAPSES * 6);
  const synCol = new Float32Array(SYNAPSES * 8);
  synGeo.setAttribute("position", new THREE.BufferAttribute(synPos, 3));
  synGeo.setAttribute("color", new THREE.BufferAttribute(synCol, 4));
  synGeo.setDrawRange(0, 0);
  const synapses = new THREE.LineSegments(
    synGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  scene.add(synapses);

  // The selected claim's ping and the focused threat's: rings that grow and fade.
  const pingMat = () =>
    new THREE.MeshBasicMaterial({
      color: ORANGE,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  const ping = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.162, 48), pingMat());
  ping.visible = false;
  const threatPing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.215, 48), pingMat());
  threatPing.visible = false;
  scene.add(ping, threatPing);

  // --- labels (DOM, so they use the site's type) -------------------------------------------------

  interface Label {
    el: HTMLElement;
    at: THREE.Vector3;
    show: (v: View) => boolean;
    topic: number;
    w: number;
    h: number;
    x: number;
    y: number;
    z: number;
    rank: number;
    on: boolean;
    px: number;
    py: number;
  }
  const labels: Label[] = [];
  const addLabel = (
    text: string,
    cls: string,
    at: THREE.Vector3,
    show: Label["show"],
    topic = -1,
  ): Label => {
    const el = document.createElement("span");
    el.className = `${opts.classes.label} ${cls}`;
    el.textContent = text;
    overlay.append(el);
    const l: Label = {
      el,
      at,
      show,
      topic,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      z: 0,
      rank: 0,
      on: false,
      px: Number.NaN,
      py: Number.NaN,
    };
    labels.push(l);
    return l;
  };
  // A topic's label shows in the knowledge views; in the brain view only while the brain works on
  // that topic.
  const topicLive = new Float32Array(topics.length);
  const topicLabels = topics.map((t, ti) =>
    addLabel(
      t.title,
      opts.classes.topic,
      (clusters[ti]?.center ?? new THREE.Vector3())
        .clone()
        .add(new THREE.Vector3(0, CAGE * 0.82 + 0.55, 0)),
      (v) =>
        v.kind === "knowledge" ||
        (v.kind === "brain" && (topicLive[ti] ?? 0) > 0) ||
        (v.kind === "topic" && v.slug === t.slug) ||
        (v.kind === "claim" && claims[claimIdx.get(v.id) ?? -1]?.topic === t.slug),
      ti,
    ),
  );
  if (blocks[tipIdx])
    addLabel(
      `Tip ${fmt(tip)}`,
      opts.classes.tip,
      new THREE.Vector3(tipTop.x, tipTop.y + 0.5, 0),
      (v) => v.kind !== "claim" && v.kind !== "topic",
    );
  for (const b of blocks)
    if (b.event && b.h !== tip)
      addLabel(
        fmt(b.h),
        opts.classes.block,
        new THREE.Vector3(b.pos.x, b.size.y + 0.45, 0),
        (v) => v.kind === "timeline",
      );
  data.snapshots.forEach((s, si) => {
    addLabel(
      `Snapshot ${s.n}${s.signed ? ", signed" : ""}${s.anchor ? "" : ", proof pending"}`,
      opts.classes.block,
      new THREE.Vector3(snapX[si] ?? 0, s.signed ? 2.9 : 2.35, 0),
      (v) => v.kind === "proof" || v.kind === "timeline",
    );
  });
  layers.forEach((l, k) => {
    addLabel(
      l.label,
      opts.classes.stratum,
      new THREE.Vector3(SX0 + 1.4, layerY(k), STRATA.depth),
      (v) => v.kind === "security",
    );
  });
  threats.forEach((t) => {
    addLabel(
      t.label,
      opts.classes.threat,
      t.pos.clone().add(new THREE.Vector3(0, 0.32, 0)),
      (v) => v.kind === "security" && v.threat === t.id,
    );
  });

  // --- state ------------------------------------------------------------------------------------

  const latest = claims.reduce((m, c) => Math.max(m, c.seen, c.checked), 0);
  const recent = claims.map((c) => c.seen === latest || c.checked === latest);

  let view: View = { kind: "brain", variant: 0 };
  const nodeDim = new Float32Array(claims.length);
  const nodeDimTo = new Float32Array(claims.length);
  const topicDim = new Float32Array(topics.length);
  const topicDimTo = new Float32Array(topics.length);
  const threadA = new Float32Array(claims.length).fill(0.05);
  const threadATo = new Float32Array(claims.length).fill(0.05);
  // The view's blend for whole layers: strata, threats, grid, snapshot rings.
  const mix4 = new Float32Array(4);
  const mix4To = new Float32Array(4);
  const STRATA_A = 0;
  const THREAT_A = 1;
  const GRID_A = 2;
  const SNAP_A = 3;
  // The live layer's per-element light, decaying each frame.
  const glow = new Float32Array(claims.length);
  const flash = new Float32Array(claims.length);
  const topicFlash = new Float32Array(topics.length);
  const strataFlash = new Float32Array(nL);
  const threatFlash = new Float32Array(threats.length);
  let tipFlash = 0;
  let breath = 0;
  const related = new Uint8Array(claims.length);

  let hovered = -1;
  let hoveredTopic = -1;
  let hoveredThreat = -1;
  let hoveredBlock = -1;
  let hoveredLayer = -1;
  let hoveredSnap = -1;
  let selected = -1;
  let focusThreat = -1;

  let ambient: Ambient | null = null;
  let ambientTopic = -1;
  let ambientNext = 0;
  let ambientStep = 0;
  let paused = false;

  const fx: Fx[] = Array.from({ length: FX }, () => ({
    on: false,
    kind: "breath" as FxKind,
    t0: 0,
    dur: 1,
    a: -1,
    tone: 0,
    list: new Int32Array(FX_LIST),
    n: 0,
    fired: 0,
    seed: 0,
    move: false,
  }));
  const queue: FeedEvent[] = [];
  let queueNext = 0;
  let signals = 0;
  let frames = 0;

  const camPos = new THREE.Vector3(0, 9, 34);
  const camTarget = new THREE.Vector3(0, 3.5, 0);
  const fromTarget = new THREE.Vector3();
  const from = { phi: 1, theta: 0, d: 30 };
  let flightT0 = -1;
  let flightDur = 1.2;
  let flightHop = 0;

  let width = 1;
  let height = 1;
  let panel = 0;
  let active = true;
  let raf = 0;
  let lastFrame = performance.now();
  const t0 = reduced ? -ASSEMBLE : 0;
  let now = 0;
  let paintAll = true;

  // --- framing: each view names a target, a direction and the points that must stay in view;
  // the distance is fitted to the free area (right of the dock), so nothing hides under it.

  interface Shot {
    target: THREE.Vector3;
    phi: number;
    theta: number;
    sway: number;
    keep: THREE.Vector3[];
    min: number;
    phiMin: number;
    phiMax: number;
  }

  const shell = (c: THREE.Vector3, r: number, label = 0.75) => [
    c.clone().add(new THREE.Vector3(r, 0, 0)),
    c.clone().add(new THREE.Vector3(-r, 0, 0)),
    c.clone().add(new THREE.Vector3(0, 0, r)),
    c.clone().add(new THREE.Vector3(0, 0, -r)),
    c.clone().add(new THREE.Vector3(0, -r * 0.82, 0)),
    c.clone().add(new THREE.Vector3(0, r * 0.82 + label, 0)),
  ];
  const axisEnds = () => {
    const a = xOf(minH);
    const b = xOf(tip);
    return [
      new THREE.Vector3(a, 0, 0.9),
      new THREE.Vector3(a, 0, -0.9),
      new THREE.Vector3(b, 1.5, 0.9),
      new THREE.Vector3(b, 1.5, -0.9),
      ...data.snapshots.map((_, i) => new THREE.Vector3(snapX[i] ?? 0, 2.6, 0)),
    ];
  };
  const stratumCorners = (k: number) => {
    const y = layerY(k);
    const D = STRATA.depth;
    return [
      new THREE.Vector3(SX0, y, D),
      new THREE.Vector3(SX1, y, D),
      new THREE.Vector3(SX0, y, -D),
      new THREE.Vector3(SX1, y, -D),
    ];
  };
  const everything = [...clusters.flatMap((c) => shell(c.center, CAGE)), ...axisEnds()];
  const middle = new THREE.Box3().setFromPoints(everything).getCenter(new THREE.Vector3());

  function shot(v: View): Shot {
    const base = { phiMin: 0.32, phiMax: 1.5 };
    if (v.kind === "topic") {
      const k = clusters[topicIdx.get(v.slug) ?? -1];
      if (k)
        return {
          ...base,
          target: k.center.clone(),
          phi: 1.12,
          // from the arc's middle, toward the cluster, a little from the left
          theta: -k.angle * 0.85 - 0.2,
          sway: 0.05,
          keep: shell(k.center, CAGE * 1.35),
          min: 6,
        };
    }
    if (v.kind === "claim") {
      const i = claimIdx.get(v.id);
      const p = i === undefined ? undefined : nodePos[i];
      const a = i === undefined ? undefined : anchors[i];
      const k = i === undefined ? undefined : clusters[claimTopic[i] ?? -1];
      if (p && a && k) {
        // From above the front of its cluster, so its thread drops toward the chain below.
        const t = a.clone().sub(p).normalize();
        return {
          ...base,
          target: p.clone().lerp(k.center, 0.3),
          phi: 0.98,
          theta: -k.angle * 0.85 - 0.24,
          sway: 0.03,
          keep: [...shell(k.center, CAGE * 1.1, 0), p.clone().addScaledVector(t, 4)],
          min: 5,
        };
      }
    }
    if (v.kind === "timeline")
      return {
        ...base,
        target: new THREE.Vector3((xOf(minH) + xOf(tip)) / 2 + AXIS * 0.08, 0.7, 0),
        phi: 1.26,
        theta: -1.02,
        sway: 0.08,
        keep: axisEnds(),
        min: 10,
      };
    if (v.kind === "proof") {
      const xs = snapX.length ? snapX : [xOf(tip)];
      // every ring whole, with room above for its seal and label, and the tip
      const rings = xs.flatMap((x) => [
        new THREE.Vector3(x, 0.5 - 1.7, 0),
        new THREE.Vector3(x, 3.4, 0),
        new THREE.Vector3(x, 0.5, 1.7),
        new THREE.Vector3(x, 0.5, -1.7),
      ]);
      return {
        ...base,
        target: new THREE.Vector3((Math.min(...xs) + Math.max(...xs, tipTop.x)) / 2, 0.6, 0),
        phi: 1.2,
        theta: -0.7 + v.variant * 0.06,
        sway: 0.05,
        keep: [...rings, tipTop.clone(), new THREE.Vector3(tipTop.x, tipTop.y + 0.8, 0)],
        min: 5,
      };
    }
    if (v.kind === "security") {
      const t = threats[threatIdx.get(v.threat ?? "") ?? -1];
      if (t) {
        const D = STRATA.depth;
        const y = layerY(t.layer);
        return {
          target: t.pos.clone(),
          phi: 1.16,
          theta: -0.5,
          sway: 0.04,
          keep: [
            new THREE.Vector3(t.pos.x - 5, y, D),
            new THREE.Vector3(t.pos.x + 5, y, D),
            new THREE.Vector3(t.pos.x - 5, y, -D),
            new THREE.Vector3(t.pos.x + 5, y, -D),
            t.pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
          ],
          min: 9,
          phiMin: 0.4,
          phiMax: 1.75,
        };
      }
      const deep = nL ? layerY(nL - 1) : -1;
      return {
        target: new THREE.Vector3((SX0 + SX1) / 2, (deep + 1) / 2, 0),
        phi: nL ? 1.27 : 1.2,
        theta: -0.72,
        sway: 0.06,
        keep: [
          ...Array.from({ length: Math.max(nL, 1) }, (_, k) => stratumCorners(k)).flat(),
          new THREE.Vector3(SX0, 1, 0),
          tipTop.clone().add(new THREE.Vector3(0, 0.8, 0)),
        ],
        min: 8,
        phiMin: 0.4,
        phiMax: 1.75,
      };
    }
    const variant = v.kind === "brain" || v.kind === "knowledge" ? v.variant : 0;
    if (v.kind === "brain")
      return {
        ...base,
        target: middle.clone(),
        phi: 1.0,
        theta: 0.58 + variant * 0.06,
        sway: 0.16,
        keep: nL ? [...everything, ...stratumCorners(0).slice(0, 2)] : everything,
        min: 14,
      };
    return {
      ...base,
      target: middle.clone(),
      phi: 1.08,
      theta: -0.34 + variant * 0.05,
      sway: 0.1,
      keep: everything,
      min: 14,
    };
  }

  const probeCam = new THREE.PerspectiveCamera();
  const pv = new THREE.Vector3();
  const dirOf = (phi: number, theta: number, out: THREE.Vector3) =>
    out.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));

  // The free area in the canvas's device coordinates: right of the dock, inside small margins.
  const FREE = { right: 0.93, bottom: -0.88, top: 0.84, pad: 0.08 };
  const freeLeft = () => (panel > 0 ? (panel / width) * 2 - 1 : -1) + FREE.pad;

  function aim(s: Shot, d: number) {
    probeCam.copy(camera);
    probeCam.position.copy(s.target).addScaledVector(dirOf(s.phi, s.theta, pv), d);
    probeCam.lookAt(s.target);
    probeCam.updateMatrixWorld();
    probeCam.updateProjectionMatrix();
  }

  function fits(s: Shot, d: number): boolean {
    aim(s, d);
    const left = freeLeft();
    for (const p of s.keep) {
      pv.copy(p).project(probeCam);
      if (pv.z > 1 || pv.x < left || pv.x > FREE.right || pv.y < FREE.bottom || pv.y > FREE.top)
        return false;
    }
    return true;
  }

  function fit(s: Shot): number {
    let lo = s.min;
    let hi = 260;
    if (fits(s, lo)) return lo;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fits(s, mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  const rightV = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const fitted = new Map<string, { s: Shot; d: number }>();
  function framing(v: View) {
    const key = JSON.stringify(v);
    const hit = fitted.get(key);
    if (hit) return hit;
    const s = shot(v);
    let d = fit(s);
    // Centre what must be seen in the free area: pan the target by the offset of the kept
    // points' box from the area's middle, then fit the distance again.
    for (let it = 0; it < 3; it++) {
      aim(s, d);
      let x0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const p of s.keep) {
        pv.copy(p).project(probeCam);
        x0 = Math.min(x0, pv.x);
        x1 = Math.max(x1, pv.x);
        y0 = Math.min(y0, pv.y);
        y1 = Math.max(y1, pv.y);
      }
      const dx = (x0 + x1) / 2 - (freeLeft() + FREE.right) / 2;
      const dy = (y0 + y1) / 2 - (FREE.bottom + FREE.top) / 2;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) break;
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * d;
      rightV.setFromMatrixColumn(probeCam.matrixWorld, 0);
      upV.setFromMatrixColumn(probeCam.matrixWorld, 1);
      s.target.addScaledVector(rightV, dx * halfH * (width / height));
      s.target.addScaledVector(upV, dy * halfH);
      d = fit(s);
    }
    const out = { s, d };
    fitted.set(key, out);
    return out;
  }
  let shotNow = framing(view);

  // --- targets: what each view and each hover lights or dims, eased in the frame ----------------

  function setTargets() {
    const k = view.kind;
    selected = k === "claim" ? (claimIdx.get(view.id) ?? -1) : -1;
    focusThreat = k === "security" ? (threatIdx.get(view.threat ?? "") ?? -1) : -1;
    const focusTopic =
      k === "topic"
        ? (topicIdx.get(view.slug) ?? -1)
        : selected >= 0
          ? (claimTopic[selected] ?? -1)
          : -1;
    const focus = hovered >= 0 ? hovered : selected;
    related.fill(0);
    for (const r of links[focus] ?? []) related[r] = 1;

    topics.forEach((_, ti) => {
      let d = 0;
      if (k === "security") d = 0.88;
      else if (k === "proof") d = 0.6;
      else if (k === "timeline") d = 0.55;
      else if (focusTopic >= 0 && ti !== focusTopic) d = 0.8;
      if (hoveredTopic >= 0 && ti !== hoveredTopic) d = Math.max(d, 0.35);
      topicDimTo[ti] = d;
    });
    claims.forEach((_, i) => {
      const ti = claimTopic[i] ?? -1;
      let d = 0;
      if (k === "timeline") d = recent[i] ? 0 : 0.72;
      else if (k === "proof") d = 0.75;
      else if (k === "security") d = 0.9;
      else if (focusTopic >= 0 && ti !== focusTopic) d = 0.86;
      else if (selected >= 0 && i !== selected) d = related[i] ? 0.12 : 0.45;
      if (hovered >= 0 && i !== hovered && !related[i])
        d = Math.max(d, ti === claimTopic[hovered] ? 0.3 : 0.6);
      if (hoveredTopic >= 0 && ti !== hoveredTopic) d = Math.max(d, 0.55);
      if (hoveredBlock >= 0)
        d = anchorBlock[i] === hoveredBlock ? Math.min(d, 0.05) : Math.max(d, 0.6);
      nodeDimTo[i] = d;

      // Threads: a whisper in the overviews, the focus's own in a topic or claim, the recent ones
      // on the timeline, and whatever the pointer rests on.
      let a = k === "brain" ? 0.036 : 0.028;
      if (k === "timeline") a = recent[i] ? 0.34 : 0.025;
      else if (k === "proof" || k === "security") a = 0.02;
      else if (selected >= 0)
        a = i === selected ? 0.95 : related[i] ? 0.3 : ti === focusTopic ? 0.1 : 0.012;
      else if (focusTopic >= 0) a = ti === focusTopic ? 0.3 : 0.012;
      if (i === hovered) a = 0.9;
      else if (hoveredTopic >= 0 && ti === hoveredTopic) a = Math.max(a, 0.34);
      else if (hoveredBlock >= 0 && anchorBlock[i] === hoveredBlock) a = 0.85;
      threadATo[i] = a;
    });
    mix4To[STRATA_A] = k === "security" ? 1 : k === "brain" ? 0.22 : 0;
    mix4To[THREAT_A] = k === "security" ? 1 : k === "brain" ? 0.4 : 0;
    mix4To[GRID_A] = k === "security" ? 0.5 : 1;
    mix4To[SNAP_A] = k === "proof" ? 1 : 0;
    paintAll = true;
    if (reduced) snapAll();
  }

  function snapAll() {
    nodeDim.set(nodeDimTo);
    topicDim.set(topicDimTo);
    threadA.set(threadATo);
    mix4.set(mix4To);
  }

  // --- the live layer ---------------------------------------------------------------------------

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const tone = [ORANGE, new THREE.Color(), new THREE.Color(), new THREE.Color()];
  const toneOf = (o: FeedEvent["outcome"]) =>
    o === "failed" ? 3 : o === "changed" ? 2 : o === "ok" ? 1 : 0;

  function startFx(kind: FxKind, dur: number, a = -1, list?: readonly number[], seed = 0): Fx {
    let f = fx.find((x) => !x.on);
    if (!f) {
      f = fx.reduce((m, x) => (x.t0 < m.t0 ? x : m));
    }
    f.on = true;
    f.kind = kind;
    f.t0 = now;
    f.dur = dur;
    f.a = a;
    f.tone = 0;
    f.n = 0;
    f.fired = 0;
    f.seed = seed;
    f.move = false;
    if (list) for (const i of list) if (f.n < FX_LIST && i >= 0) f.list[f.n++] = i;
    return f;
  }

  /** A far point on a dome around the scene, stable for a seed. */
  function outside(seed: number, out: THREE.Vector3) {
    const th = seed * Math.PI * 2;
    const el = 0.25 + ((seed * 7.31) % 1) * 0.6;
    return out.set(
      Math.cos(th) * 26 * Math.cos(el),
      4 + Math.sin(el) * 16,
      Math.sin(th) * 26 * Math.cos(el) - 6,
    );
  }

  function liveTopic(ti: number, secs: number) {
    if (ti >= 0) topicLive[ti] = Math.max(topicLive[ti] ?? 0, secs);
  }

  function claimsFrom(e: FeedEvent): number[] {
    return (e.claims ?? []).map((id) => claimIdx.get(id) ?? -1).filter((i) => i >= 0);
  }

  /** Some claims of a topic (or of all), picked by a seed, for events that name none. */
  function sample(ti: number, n: number, seed: number): number[] {
    const pool = ti >= 0 ? (byTopic[ti] ?? []) : claims.map((_, i) => i);
    if (!pool.length) return [];
    const out: number[] = [];
    const stride = Math.max(1, Math.floor(pool.length / n));
    const off = Math.floor(seed * pool.length);
    for (let j = 0; j < n && j < pool.length; j++)
      out.push(pool[(off + j * stride) % pool.length] ?? 0);
    return out;
  }

  /** A rechecked claim was verified again at the tip: its thread moves there, after `delay`. */
  function reanchor(i: number, delay: number) {
    const b = anchorBlock[i] ?? tipIdx;
    if (b === tipIdx) return;
    perBlock[b] = Math.max(0, (perBlock[b] ?? 0) - 1);
    perBlock[tipIdx] = (perBlock[tipIdx] ?? 0) + 1;
    anchorBlock[i] = tipIdx;
    reFrom[i]?.copy(anchors[i] ?? tipTop);
    reT0[i] = reduced ? now - 10 : now + delay;
  }

  function addGhost(id: string, ti: number) {
    if (ghostIds.has(id) || ti < 0) return;
    const c = clusters[ti]?.center;
    if (!c || ghostMesh.count >= GHOSTS) return;
    ghostIds.add(id);
    const g = ghostMesh.count++;
    const th = hash01(id) * Math.PI * 2;
    const y = hash01(`${id}|y`) * 1.6 - 0.8;
    const r = LAYER[4] ?? 1.6;
    const rad = Math.sqrt(1 - Math.min(0.9, y * y));
    ghostPos[g]?.set(
      c.x + Math.cos(th) * rad * r,
      c.y + y * r * 0.82,
      c.z + Math.sin(th) * rad * r,
    );
    ghostT0[g] = reduced ? now - 10 : now;
  }

  /** The lasting part of an event: what stays true after its animation ends. */
  function settle(e: FeedEvent) {
    const ti = topicIdx.get(e.topic ?? "") ?? -1;
    if (e.kind === "recheck")
      claimsFrom(e).forEach((i, j) => {
        reanchor(i, j * 0.12 + 0.45);
      });
    if (e.kind === "publish")
      for (const id of e.claims ?? []) if (!claimIdx.has(id)) addGhost(id, ti);
    if (e.kind === "snapshot") sealedAt = reduced ? now - 10 : now + 2.4;
  }

  function start(e: FeedEvent) {
    signals++;
    const ti = topicIdx.get(e.topic ?? "") ?? -1;
    const th = threatIdx.get(e.threat ?? "") ?? -1;
    const seed = hash01(`${e.at}|${e.kind}|${e.text}`);
    const named = claimsFrom(e);
    const t = toneOf(e.outcome);
    switch (e.kind) {
      case "research":
      case "verify": {
        if (ti >= 0) {
          startFx("scan", e.kind === "verify" ? 2.4 : 3.6, ti, undefined, seed);
          liveTopic(ti, 5);
        }
        if (named.length) startFx("pulse", 1 + named.length * 0.12, -1, named, seed);
        break;
      }
      case "recheck": {
        const list = named.length ? named : sample(ti, 6, seed);
        const f = startFx("pulse", 1.2 + list.length * 0.12, -1, list, seed);
        f.move = named.length > 0;
        f.tone = t;
        liveTopic(ti, 4);
        break;
      }
      case "publish": {
        const f = startFx("grow", 3.2, ti, named, seed);
        f.tone = t;
        liveTopic(ti, 5);
        break;
      }
      case "snapshot":
        startFx("ring", 2.6, -1, undefined, seed);
        break;
      case "evaluate": {
        const f = startFx("sweep", 2.8, -1, named, seed);
        f.tone = t;
        break;
      }
      case "watch": {
        const f = startFx("strata", 2.4, th, undefined, seed);
        f.tone = t;
        break;
      }
      case "lab": {
        const target = th >= 0 ? th : threats.length ? Math.floor(seed * threats.length) : -1;
        const f = startFx("lab", 2.6, target, undefined, seed);
        f.tone = t;
        break;
      }
      case "ingest":
        startFx("ingest", 2.2, ti, undefined, seed);
        liveTopic(ti, 3);
        break;
      case "idle":
        startFx("breath", 5, -1, undefined, seed);
        break;
      default:
        break;
    }
    settle(e);
  }

  const spark = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    lift: number,
    delay: number,
    dur: number,
    c: THREE.Color,
  ) => sparks.emit(a, b, lift, now + delay, dur, c);

  function decay(arr: Float32Array, f: number) {
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] ?? 0) * f;
  }

  /** One frame of every running effect; true while any runs. */
  function stepFx(dt: number): boolean {
    decay(glow, Math.exp(-dt * 2.4));
    decay(flash, Math.exp(-dt * 1.8));
    decay(topicFlash, Math.exp(-dt * 2.2));
    decay(strataFlash, Math.exp(-dt * 2.4));
    decay(threatFlash, Math.exp(-dt * 2));
    for (let i = 0; i < topicLive.length; i++) topicLive[i] = Math.max(0, (topicLive[i] ?? 0) - dt);
    tipFlash *= Math.exp(-dt * 2.4);
    // the last snapshot sealed while the page was open stays, locked to the tip
    if (sealedAt >= 0 && now >= sealedAt) {
      sealed.visible = true;
      (sealed.material as THREE.LineBasicMaterial).opacity = 0.9;
    }
    if (reduced) {
      // still frames: no sparks, scans or sweeps; the topic the brain works on stays named
      for (const m of scanners) m.visible = false;
      sweepLine.visible = false;
      forming.visible = false;
      breath = 0;
      if (ambientTopic >= 0 && (ambient?.kind === "research" || ambient?.kind === "verify"))
        topicLive[ambientTopic] = 1;
      return false;
    }
    let busy = false;
    scanY[1] = Number.NaN;
    sweepLine.visible = false;
    forming.visible = false;
    breath = 0;

    for (const f of fx) {
      if (!f.on) continue;
      const p = (now - f.t0) / f.dur;
      if (p >= 1) {
        f.on = false;
        continue;
      }
      busy = true;
      switch (f.kind) {
        case "scan": {
          const c = clusters[f.a];
          if (!c) break;
          // up and back down once, easing at the ends
          scanY[1] = c.center.y + Math.cos(ease(p) * Math.PI * 2) * CAGE * 0.8;
          scanTopic[1] = f.a;
          topicFlash[f.a] = Math.max(topicFlash[f.a] ?? 0, 0.55 * bump(p));
          break;
        }
        case "pulse": {
          // each claim in turn: a light on the node, then a spark down its thread to the tip
          for (let j = 0; j < f.n; j++) {
            const i = f.list[j] ?? 0;
            const u = (now - f.t0 - j * 0.12) / 0.9;
            if (u < 0) continue;
            if (j >= f.fired) {
              f.fired = j + 1;
              const at = nodePos[i];
              if (at) spark(at, tipTop, 0.6, 0, 0.9, tone[f.tone] ?? ORANGE);
            }
            if (u < 1) {
              glow[i] = Math.max(glow[i] ?? 0, bump(Math.min(1, u * 1.6)));
              flash[i] = Math.max(flash[i] ?? 0, bump(u));
            }
          }
          if (p > 0.6) tipFlash = Math.max(tipFlash, 0.6);
          break;
        }
        case "grow": {
          for (let j = 0; j < f.n; j++) {
            const i = f.list[j] ?? 0;
            const u = (now - f.t0 - j * 0.1) / 1.4;
            if (u > 0 && u < 1) glow[i] = Math.max(glow[i] ?? 0, 1 - u * 0.6);
            if (u > 0.3 && j >= f.fired) {
              f.fired = j + 1;
              const at = nodePos[i];
              if (at) spark(at, tipTop, 1.2, 0, 1.1, ORANGE);
            }
          }
          if (f.a >= 0) {
            topicFlash[f.a] = Math.max(topicFlash[f.a] ?? 0, 0.6 * bump(p));
            if (!f.n && f.fired < 3 && p > f.fired * 0.15) {
              const c = clusters[f.a]?.center;
              if (c) spark(c, tipTop, 1.4, 0, 1.2, ORANGE);
              f.fired++;
            }
          }
          if (p > 0.45) tipFlash = Math.max(tipFlash, bump((p - 0.45) / 0.55));
          break;
        }
        case "ring": {
          forming.visible = true;
          const e = ease(Math.min(1, p / 0.8));
          forming.scale.setScalar(4.2 - (4.2 - 1.52) * e);
          forming.rotation.x = (1 - e) * 2.4;
          forming.rotation.y = (1 - e) * 0.9;
          (forming.material as THREE.LineBasicMaterial).opacity =
            Math.min(1, p * 4) * (p > 0.8 ? 1 - (p - 0.8) * 2 : 1);
          if (p > 0.78) tipFlash = Math.max(tipFlash, 1);
          break;
        }
        case "sweep": {
          const a = -ARC.spread - 0.25 + (ARC.spread * 2 + 0.5) * ease(p);
          sweepLine.visible = true;
          const x = Math.sin(a) * ARC.radius;
          const z = ARC.z - Math.cos(a) * ARC.radius;
          sweepPos[0] = x;
          sweepPos[1] = 0;
          sweepPos[2] = z;
          sweepPos[3] = x;
          sweepPos[4] = 9.5;
          sweepPos[5] = z;
          dirty(sweepGeo, "position");
          (sweepLine.material as THREE.LineBasicMaterial).opacity = 0.7 * bump(p);
          for (let ti = 0; ti < clusters.length; ti++) {
            const c = clusters[ti];
            if (!c) continue;
            const near = 1 - Math.min(1, Math.abs(c.angle - a) / 0.12);
            if (near > 0) topicFlash[ti] = Math.max(topicFlash[ti] ?? 0, 0.5 * near);
          }
          for (let j = 0; j < f.n; j++) {
            const i = f.list[j] ?? 0;
            const near =
              1 - Math.min(1, Math.abs((clusters[claimTopic[i] ?? 0]?.angle ?? 0) - a) / 0.1);
            if (near > 0) glow[i] = Math.max(glow[i] ?? 0, near);
          }
          break;
        }
        case "strata": {
          for (let k = 0; k < nL; k++)
            strataFlash[k] = Math.max(strataFlash[k] ?? 0, 0.8 * bump((p - k * 0.07) / 0.5));
          if (f.a >= 0) threatFlash[f.a] = Math.max(threatFlash[f.a] ?? 0, bump(p));
          break;
        }
        case "lab": {
          const t = threats[f.a];
          if (!t) {
            for (let k = 0; k < nL; k++)
              strataFlash[k] = Math.max(strataFlash[k] ?? 0, 0.5 * bump(p));
            break;
          }
          // replayed attacks converge on the threat, then it answers in its outcome's color
          if (f.fired < 8 && p > f.fired * 0.04) {
            const s = (f.seed + f.fired * 0.137) % 1;
            va.set(
              t.pos.x + Math.cos(s * 6.28) * 3.2,
              t.pos.y + 1.2 + s * 1.5,
              t.pos.z + Math.sin(s * 6.28) * 3.2,
            );
            spark(va, t.pos, 0.3, 0, 0.8, f.tone ? (tone[f.tone] ?? ORANGE) : ORANGE);
            f.fired++;
          }
          strataFlash[t.layer] = Math.max(strataFlash[t.layer] ?? 0, 0.6 * bump(p));
          if (p > 0.45) threatFlash[f.a] = Math.max(threatFlash[f.a] ?? 0, bump((p - 0.45) / 0.55));
          break;
        }
        case "ingest": {
          const c = clusters[f.a]?.center;
          const goal = c ?? tipTop;
          while (f.fired < 10 && p > f.fired * 0.035) {
            outside((f.seed + f.fired * 0.0913) % 1, va);
            spark(va, goal, 2 + ((f.seed * 13 + f.fired) % 3), 0, 1.2, ORANGE);
            f.fired++;
          }
          if (p > 0.5) {
            if (c) topicFlash[f.a] = Math.max(topicFlash[f.a] ?? 0, 0.5 * bump((p - 0.5) / 0.5));
            else tipFlash = Math.max(tipFlash, 0.8 * bump((p - 0.5) / 0.5));
          }
          break;
        }
        case "breath":
          breath = Math.max(breath, bump(p));
          break;
      }
    }

    // The continuous state: what the brain is doing now, kept quiet.
    scanY[0] = Number.NaN;
    if (ambient && !paused) {
      const k = ambient.kind;
      if ((k === "research" || k === "verify") && ambientTopic >= 0) {
        const c = clusters[ambientTopic];
        if (c) {
          const period = k === "verify" ? 2.2 : 4.2;
          scanY[0] = c.center.y + Math.cos((now / period) * Math.PI * 2) * CAGE * 0.78;
          scanTopic[0] = ambientTopic;
          topicLive[ambientTopic] = Math.max(topicLive[ambientTopic] ?? 0, 1);
        }
      } else if (k === "idle")
        breath = Math.max(breath, 0.5 + 0.5 * Math.sin((now / 6.5) * Math.PI * 2));
      if (now >= ambientNext) {
        const s = hash01(`${ambientStep++}|${k}`);
        let gap = 1.2;
        if (k === "ingest") {
          spark(outside(s, va), tipTop, 2.4, 0, 1.4, ORANGE);
          gap = 0.7;
        } else if (k === "recheck" && claims.length) {
          const i = Math.floor(s * claims.length);
          startFx("pulse", 1.2, -1, [i], s);
          gap = 1.1;
        } else if (k === "evaluate") {
          startFx("sweep", 3.4, -1, undefined, s);
          gap = 6.5;
        } else if (k === "watch" || (k === "lab" && !threats.length)) {
          startFx("strata", 2.6, -1, undefined, s);
          gap = 5;
        } else if (k === "lab") {
          startFx("lab", 2.6, Math.floor(s * threats.length), undefined, s);
          gap = 4;
        } else if (k === "publish") {
          const c = clusters[Math.floor(s * clusters.length)]?.center;
          if (c) spark(c, tipTop, 1.4, 0, 1.3, ORANGE);
          tipFlash = Math.max(tipFlash, 0.4);
          gap = 2.4;
        } else if (k === "verify" && ambientTopic >= 0) {
          const list = sample(ambientTopic, 1, s);
          if (list.length) startFx("pulse", 1, -1, list, s);
          gap = 1.6;
        } else gap = 2;
        ambientNext = now + gap;
      }
      if (k === "snapshot") {
        forming.visible = true;
        forming.scale.setScalar(2.3 + Math.sin(now * 0.8) * 0.12);
        forming.rotation.x = now * 0.6;
        forming.rotation.y = 0.5;
        (forming.material as THREE.LineBasicMaterial).opacity = 0.55;
      }
      busy = true;
    }

    // scanners: the ring hugs the cage at its height; the nodes it passes light up
    for (let s = 0; s < 2; s++) {
      const m = scanners[s];
      const y = scanY[s] ?? Number.NaN;
      const ti = scanTopic[s] ?? -1;
      const c = clusters[ti]?.center;
      if (!m) continue;
      if (Number.isNaN(y) || !c) {
        m.visible = false;
        continue;
      }
      const h = (y - c.y) / (CAGE * 0.82);
      m.visible = true;
      m.position.set(c.x, y, c.z);
      m.scale.setScalar(CAGE * Math.sqrt(Math.max(0.02, 1 - h * h)) * 1.02);
      (m.material as THREE.LineBasicMaterial).opacity =
        (s === 0 ? 0.55 : 0.85) * (1 - (topicDim[ti] ?? 0) * 0.85);
      for (const i of byTopic[ti] ?? []) {
        const d = Math.abs((nodePos[i]?.y ?? 0) - y);
        if (d < 0.16) glow[i] = Math.max(glow[i] ?? 0, 1 - d / 0.16);
      }
    }

    const live = sparks.update(now);
    if (live) busy = true;
    if (ghostMesh.count) busy = busy || now - (ghostT0[ghostMesh.count - 1] ?? 0) < 4;
    if (tipFlash > 0.01) busy = true;
    return busy;
  }

  // --- colors -----------------------------------------------------------------------------------

  const tmp = new THREE.Color();
  const out = new THREE.Color();
  const cb = new THREE.Color();
  const mix = (t: number, o = tmp) => o.lerpColors(pal.ink, pal.bg, clamp(t));

  function paintStatic(fade: number) {
    // blocks: the tip is orange; a hovered block and the blocks a proof sits in are outlined
    const proof = mix4[SNAP_A] ?? 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) continue;
      const isTip = i === tipIdx;
      const face = isTip
        ? out.copy(ORANGE).lerp(pal.bg, tipFlash * 0.45)
        : b.event
          ? pal.face
          : pal.faceDim;
      blockMesh.setColorAt(i, face);
      let ec: THREE.Color;
      if (isTip) ec = cb.copy(ORANGE);
      else if (i === hoveredBlock) ec = cb.copy(ORANGE);
      else if (anchorBlocks.has(i) && proof > 0.01)
        ec = cb.copy(mix(b.event ? 0.42 : 0.74)).lerp(ORANGE, proof);
      else ec = cb.copy(mix(b.event ? 0.42 : 0.74));
      for (let k = 0; k < unitEdges.length / 3; k++) {
        const o = i * unitEdges.length + k * 3;
        edgeCol[o] = ec.r;
        edgeCol[o + 1] = ec.g;
        edgeCol[o + 2] = ec.b;
      }
    }
    if (blockMesh.instanceColor) blockMesh.instanceColor.needsUpdate = true;
    dirty(edgeGeo, "color");
    // cages
    for (let ti = 0; ti < topics.length; ti++) {
      const hot = ti === hoveredTopic ? -0.2 : 0;
      const live = ti === ambientTopic && reduced ? 0.6 : (topicFlash[ti] ?? 0);
      mix(1 - (1 - (0.84 + hot + 0.13 * (topicDim[ti] ?? 0) - 0.04 * breath)) * fade, out);
      if (live > 0.001) out.lerp(ORANGE, Math.min(0.85, live) * (1 - (topicDim[ti] ?? 0) * 0.6));
      for (let k = 0; k < cageVerts; k++) {
        const o = (ti * cageVerts + k) * 3;
        cageCol[o] = out.r;
        cageCol[o + 1] = out.g;
        cageCol[o + 2] = out.b;
      }
    }
    dirty(cageGeo, "color");
    // grid
    const ga = mix4[GRID_A] ?? 1;
    for (let l = 0; l < gridMajor.length; l++) {
      mix(1 - (1 - (gridMajor[l] ? 0.86 : 0.93)) * fade * ga, out);
      for (let k = 0; k < 2; k++) {
        const o = (l * 2 + k) * 3;
        gridCol[o] = out.r;
        gridCol[o + 1] = out.g;
        gridCol[o + 2] = out.b;
      }
    }
    dirty(gridGeo, "color");
    // snapshot rings: ink, orange when they are the view; a pending one stays lighter
    for (let si = 0; si < data.snapshots.length; si++) {
      const s = data.snapshots[si];
      if (!s) continue;
      out.lerpColors(mix(s.anchor ? 0.3 : 0.55), ORANGE, proof * (si === hoveredSnap ? 1 : 0.85));
      if (si === hoveredSnap) out.lerp(pal.ink, 0.25);
      cb.lerpColors(pal.bg, out, fade);
      const n = RING * 4 * 3;
      for (let k = si * n; k < (si + 1) * n; k += 3) {
        snapCol[k] = cb.r;
        snapCol[k + 1] = cb.g;
        snapCol[k + 2] = cb.b;
      }
    }
    dirty(snapGeo, "color");
    // strata
    const sa = (mix4[STRATA_A] ?? 0) * fade;
    strata.visible = sa > 0.01 && nL > 0;
    for (let k = 0; k < nL; k++) {
      const hot = k === hoveredLayer ? 0.2 : 0;
      mix(1 - Math.min(1, 0.42 + hot) * sa, out);
      const fl = strataFlash[k] ?? 0;
      if (fl > 0.001) out.lerp(ORANGE, fl * Math.max(sa, 0.5));
      const n = STRATUM_SEGS * 6;
      for (let o = k * n; o < (k + 1) * n; o += 3) {
        strataCol[o] = out.r;
        strataCol[o + 1] = out.g;
        strataCol[o + 2] = out.b;
      }
    }
    dirty(strataGeo, "color");
  }

  function paint(assembly: number) {
    const fade = clamp((assembly - 0.62) / 0.38);
    if (paintAll || fade < 1 || tipFlash > 0.005 || breath > 0.001 || hasFlash()) paintStatic(fade);
    paintAll = false;
    // nodes and threads
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i];
      const dim = nodeDim[i] ?? 0;
      const base = c?.status === "established" ? 0.06 : 0.34;
      if (i === selected) out.copy(ORANGE);
      else if (i === hovered) mix(0, out);
      else mix(base + (0.92 - base) * dim + (paused ? 0.12 : 0) + breath * 0.06, out);
      const g = glow[i] ?? 0;
      if (g > 0.001 && i !== selected) out.lerp(ORANGE, g * (1 - dim * 0.55));
      nodeMesh.setColorAt(i, out);
      const fl = flash[i] ?? 0;
      const ta = Math.max(threadA[i] ?? 0, fl * 0.9) * fade;
      if (i === selected) cb.copy(ORANGE);
      else cb.copy(pal.ink).lerp(ORANGE, fl);
      for (let k = 0; k < 2; k++) {
        const o = i * 8 + k * 4;
        threadCol[o] = cb.r;
        threadCol[o + 1] = cb.g;
        threadCol[o + 2] = cb.b;
        threadCol[o + 3] = k === 0 ? ta : ta * (i === selected ? 1 : 0.7);
      }
    }
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
    dirty(threadGeo, "color");
    for (let k = 0; k < contested.length; k++) {
      const ci = contested[k] ?? 0;
      ringMesh.setColorAt(k, mix(0.1 + 0.8 * (nodeDim[ci] ?? 0), out));
    }
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
    // threats: their status color, quiet in the brain view
    const ta = (mix4[THREAT_A] ?? 0) * fade;
    threatMesh.visible = ta > 0.01 && threats.length > 0;
    halo.visible = threatMesh.visible && open.length > 0 && ta > 0.6;
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      if (!t) continue;
      out.copy(pal.status[t.status]).lerp(pal.bg, (1 - ta) * 0.75);
      const f = threatFlash[i] ?? 0;
      if (f > 0.001) out.lerp(pal.ink, f * 0.35);
      threatMesh.setColorAt(i, out);
    }
    if (threatMesh.instanceColor) threatMesh.instanceColor.needsUpdate = true;
    haloMat.color.copy(pal.status.open);
    haloMat.opacity = ta * 0.8;
    // ghosts: orange as they arrive, then ink like any claim
    for (let g = 0; g < ghostMesh.count; g++) {
      const age = now - (ghostT0[g] ?? 0);
      mix(0.06, out).lerp(ORANGE, clamp(1 - (age - 1.5) / 2.5));
      ghostMesh.setColorAt(g, out);
    }
    if (ghostMesh.instanceColor) ghostMesh.instanceColor.needsUpdate = true;
    // seals: orange when the proof view shows them, faint on the timeline
    sealMat.opacity = Math.max(mix4[SNAP_A] ?? 0, view.kind === "timeline" ? 0.35 : 0) * fade;
    seal.visible = sealMat.opacity > 0.01;
    sealRim.visible = seal.visible;
  }

  function hasFlash() {
    for (let i = 0; i < topicFlash.length; i++) if ((topicFlash[i] ?? 0) > 0.002) return true;
    for (let i = 0; i < strataFlash.length; i++) if ((strataFlash[i] ?? 0) > 0.002) return true;
    return false;
  }

  // --- geometry over time -----------------------------------------------------------------------

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  let placedBlocks = -1;

  function place(assembly: number) {
    const span = ASSEMBLE;
    if (placedBlocks !== assembly) {
      placedBlocks = assembly;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!b) continue;
        const delay = 0.4 * (i / Math.max(blocks.length - 1, 1));
        const p = ease(clamp((assembly * span - delay) / 0.75));
        v3.set(b.pos.x + (1 - p) * 9, b.pos.y * p, b.pos.z);
        s3.set(b.size.x, Math.max(b.size.y * p, 0.0001), b.size.z);
        m4.compose(v3, q.identity(), s3);
        blockMesh.setMatrixAt(i, m4);
        for (let k = 0; k < unitEdges.length; k += 3) {
          const o = i * unitEdges.length + k;
          edgePos[o] = v3.x + (unitEdges[k] ?? 0) * s3.x;
          edgePos[o + 1] = v3.y + (unitEdges[k + 1] ?? 0) * s3.y;
          edgePos[o + 2] = v3.z + (unitEdges[k + 2] ?? 0) * s3.z;
        }
      }
      blockMesh.instanceMatrix.needsUpdate = true;
      dirty(edgeGeo, "position");
    }

    q.identity();
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i];
      const delay = 0.35 + hash01(c?.id ?? "") * 0.45;
      const p = ease(clamp((assembly * span - delay) / 0.6));
      const at = nodePos[i] ?? v3;
      const g = glow[i] ?? 0;
      const scale =
        (i === hovered ? 1.9 : i === selected ? 1.6 : related[i] ? 1.35 : 1) * (1 + g * 0.7) * p;
      v3.set(at.x, at.y - (1 - p) * 2.4, at.z);
      s3.setScalar(Math.max(scale, 0.0001));
      m4.compose(v3, q, s3);
      nodeMesh.setMatrixAt(i, m4);
      // the thread's low end, easing to the tip after a recheck
      const a = anchors[i];
      const rt = reT0[i] ?? -1;
      if (a && rt >= 0 && now >= rt) {
        const u = clamp((now - rt) / 0.9);
        a.lerpVectors(reFrom[i] ?? tipTop, tipTop, ease(u));
        if (u >= 1) reT0[i] = -1;
      }
      const o = i * 6;
      threadPos[o] = v3.x;
      threadPos[o + 1] = v3.y;
      threadPos[o + 2] = v3.z;
      threadPos[o + 3] = a?.x ?? 0;
      threadPos[o + 4] = a?.y ?? 0;
      threadPos[o + 5] = a?.z ?? 0;
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    dirty(threadGeo, "position");

    for (let k = 0; k < contested.length; k++) {
      const ci = contested[k] ?? 0;
      const at = nodePos[ci] ?? v3;
      m4.compose(at, camera.quaternion, s3.setScalar(clamp(assembly)));
      ringMesh.setMatrixAt(k, m4);
    }
    ringMesh.instanceMatrix.needsUpdate = true;

    // threats: they rise into their stratum after the store assembles
    const lift = ease(clamp((assembly * span - 0.6) / 0.8));
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      if (!t) continue;
      const f = threatFlash[i] ?? 0;
      const s =
        (i === hoveredThreat ? 1.7 : i === focusThreat ? 1.5 : 1) *
        (0.65 + 0.35 * (mix4[THREAT_A] ?? 0)) *
        (1 + f * 0.8) *
        lift;
      v3.copy(t.pos);
      v3.y -= (1 - lift) * 1.2;
      q.setFromAxisAngle(pv.set(0, 1, 0), reduced ? 0.4 : now * 0.4 + i);
      m4.compose(v3, q, s3.setScalar(Math.max(s, 0.0001)));
      threatMesh.setMatrixAt(i, m4);
    }
    threatMesh.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < open.length; k++) {
      const ti = open[k] ?? 0;
      const t = threats[ti];
      if (!t) continue;
      const cyc = reduced ? 0.3 : ((now + ti * 0.37) % 2.4) / 2.4;
      m4.compose(t.pos, camera.quaternion, s3.setScalar((1 + cyc * 1.2) * lift));
      halo.setMatrixAt(k, m4);
    }
    halo.instanceMatrix.needsUpdate = true;

    for (let k = 0; k < signed.length; k++) {
      const at = sealAt[k];
      if (!at) continue;
      m4.compose(at, camera.quaternion, s3.setScalar(clamp(assembly)));
      seal.setMatrixAt(k, m4);
      sealRim.setMatrixAt(k, m4);
    }
    seal.instanceMatrix.needsUpdate = true;
    sealRim.instanceMatrix.needsUpdate = true;

    for (let g = 0; g < ghostMesh.count; g++) {
      const age = now - (ghostT0[g] ?? 0);
      const p = clamp(age / 0.9);
      // a small overshoot as it lands
      const s = p < 1 ? ease(p) * (1 + 0.5 * bump(p)) : 1;
      m4.compose(ghostPos[g] ?? v3, q.identity(), s3.setScalar(Math.max(s, 0.0001)));
      ghostMesh.setMatrixAt(g, m4);
    }
    if (ghostMesh.count) ghostMesh.instanceMatrix.needsUpdate = true;

    // synapses from the claim in focus to its related claims
    const focus = hovered >= 0 ? hovered : selected;
    const list = links[focus] ?? [];
    const fp = nodePos[focus];
    let n = 0;
    if (fp)
      for (const r of list) {
        const rp = nodePos[r];
        if (!rp || n >= SYNAPSES) continue;
        synPos.set([fp.x, fp.y, fp.z, rp.x, rp.y, rp.z], n * 6);
        const strong = focus === selected && hovered < 0;
        const c = strong ? ORANGE : pal.ink;
        for (let k = 0; k < 2; k++) {
          const o = n * 8 + k * 4;
          synCol[o] = c.r;
          synCol[o + 1] = c.g;
          synCol[o + 2] = c.b;
          synCol[o + 3] = (k === 0 ? 0.75 : 0.35) * clamp(assembly);
        }
        n++;
      }
    synGeo.setDrawRange(0, n * 2);
    if (n) {
      dirty(synGeo, "position");
      dirty(synGeo, "color");
    }
  }

  // --- the frame --------------------------------------------------------------------------------

  const off = { theta: 0, phi: 0, zoom: 0 };
  const sph = { phi: 1, theta: 0, d: 30 };

  /** Eases a toward b by k; true while any value still moves. */
  function approach(a: Float32Array, b: Float32Array, k: number): boolean {
    let moved = false;
    for (let i = 0; i < a.length; i++) {
      const d = (b[i] ?? 0) - (a[i] ?? 0);
      if (Math.abs(d) > 0.002) {
        a[i] = (a[i] ?? 0) + d * k;
        moved = true;
      } else a[i] = b[i] ?? 0;
    }
    return moved;
  }

  /** A ring that grows and fades on a point, turned to the camera; hidden without a point. */
  function pingAt(m: THREE.Mesh, at: THREE.Vector3 | undefined, period: number, grow: number) {
    if (!at) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.copy(at);
    m.quaternion.copy(camera.quaternion);
    const cycle = reduced ? 0.25 : (now % period) / period;
    m.scale.setScalar(1 + cycle * grow);
    (m.material as THREE.MeshBasicMaterial).opacity = reduced ? 0.8 : 0.9 * (1 - cycle) ** 1.5;
  }

  function frame() {
    raf = 0;
    frames++;
    const t = performance.now();
    const dt = Math.min((t - lastFrame) / 1000, 0.1);
    lastFrame = t;
    now += dt;
    const assembly = reduced ? 1 : clamp((now - t0) / ASSEMBLE);

    // ease dims toward their targets
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
    let settling = approach(nodeDim, nodeDimTo, k);
    settling = approach(topicDim, topicDimTo, k) || settling;
    settling = approach(threadA, threadATo, k) || settling;
    settling = approach(mix4, mix4To, k) || settling;
    if (settling) paintAll = true;

    const fxBusy = stepFx(dt) || queue.length > 0;
    if (queue.length && now >= queueNext) {
      const e = queue.shift();
      if (e) start(e);
      queueNext = now + 0.45;
    }

    // camera: the view's shot, the reader's offsets, and a flight between views
    const ctl = controls.step(dt, reduced);
    const o = controls.offset;
    off.theta = o.theta;
    off.phi = o.phi;
    off.zoom = o.zoom;
    const { s, d } = shotNow;
    const sway = reduced || paused ? 0 : Math.sin(now * 0.07) * s.sway;
    const phi = clamp(s.phi + off.phi, s.phiMin, s.phiMax);
    const theta = s.theta + sway + off.theta;
    const dist = Math.max(d * Math.exp(off.zoom), 2.4);
    let flying = false;
    let tweening = false;
    if (reduced || flightT0 < 0) {
      camTarget.copy(s.target);
      sph.phi = phi;
      sph.theta = theta;
      sph.d = dist;
    } else {
      const p = clamp((now - flightT0) / flightDur);
      const e = ease(p);
      camTarget.lerpVectors(fromTarget, s.target, e);
      sph.theta = from.theta + wrap(theta - from.theta) * e;
      // a long flight rises and pulls back a little, so the reader keeps their bearings
      sph.phi = from.phi + (phi - from.phi) * e - flightHop * 0.16 * bump(p);
      sph.d =
        Math.exp(Math.log(from.d) + (Math.log(dist) - Math.log(from.d)) * e) *
        (1 + flightHop * 0.22 * bump(p));
      tweening = p < 1;
      flying = p < 0.7;
      if (!tweening) flightT0 = -1;
    }
    camPos.copy(camTarget).addScaledVector(dirOf(sph.phi, sph.theta, v3), sph.d);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = sph.d * 0.85;
      scene.fog.far = sph.d * 2.4;
    }

    place(assembly);
    paint(assembly);

    // the ping on the selected claim, and on the threat in focus
    pingAt(ping, selected >= 0 ? nodePos[selected] : undefined, 2.6, 2.4);
    pingAt(threatPing, focusThreat >= 0 ? threats[focusThreat]?.pos : undefined, 2.2, 2.2);
    (threatPing.material as THREE.MeshBasicMaterial).color.copy(
      focusThreat >= 0 ? pal.status[threats[focusThreat]?.status ?? "open"] : ORANGE,
    );
    // the tip's halo when something lands on it
    tipRing.visible = tipFlash > 0.02;
    if (tipRing.visible) {
      tipRing.scale.setScalar(0.9 + (1 - tipFlash) * 1.4);
      (tipRing.material as THREE.LineBasicMaterial).opacity = tipFlash * 0.9;
    }

    renderer.render(scene, camera);
    // Labels wait while the store assembles and while the camera flies, then settle in place.
    positionLabels(assembly < 0.8 || flying);

    const moving =
      !reduced &&
      (assembly < 1 ||
        tweening ||
        settling ||
        ctl ||
        fxBusy ||
        selected >= 0 ||
        focusThreat >= 0 ||
        (s.sway > 0 && !paused && view.kind !== "topic") ||
        (open.length > 0 && (mix4[THREAT_A] ?? 0) > 0.01));
    if ((moving || (reduced && ctl)) && active) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && active) raf = requestAnimationFrame(frame);
  }

  const scr = { x: 0, y: 0, ok: false, z: 0 };
  const proj = new THREE.Vector3();
  function toScreen(p: THREE.Vector3) {
    proj.copy(p).project(camera);
    scr.ok = proj.z < 1 && proj.z > -1;
    scr.z = proj.z;
    // The view offset shifts the image; project() already includes it.
    scr.x = ((proj.x + 1) / 2) * width;
    scr.y = ((1 - proj.y) / 2) * height;
    return scr;
  }

  // Labels never collide: the hovered topic's goes first, then the tip, then the nearest; a label
  // that would overlap one already placed, or reach under the dock, waits until there is room.
  const placed: { l: number; t: number; r: number; b: number }[] = Array.from(
    { length: 64 },
    () => ({ l: 0, t: 0, r: 0, b: 0 }),
  );
  const cand: Label[] = [];
  const byRank = (a: Label, b: Label) => a.rank - b.rank || a.z - b.z;
  const setOn = (l: Label, on: boolean) => {
    if (l.on === on) return;
    l.on = on;
    l.el.classList.toggle(opts.classes.on, on);
  };
  function positionLabels(quiet: boolean) {
    cand.length = 0;
    for (const l of labels) {
      const forced = l.topic >= 0 && l.topic === hoveredTopic;
      if (!quiet && (forced || l.show(view))) {
        const s = toScreen(l.at);
        if (s.ok && s.y > 8 && s.y < height - 8) {
          l.x = s.x;
          l.y = s.y;
          l.z = s.z;
          // a label already shown keeps its place, so labels never trade places while fading
          const tip = l.el.classList.contains(opts.classes.tip);
          l.rank = forced ? 0 : tip ? 1 : l.on ? 2 : 3;
          cand.push(l);
          continue;
        }
      }
      setOn(l, false);
    }
    cand.sort(byRank);
    let n = 0;
    for (const l of cand) {
      if (!l.w) {
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
      const L = l.x - l.w / 2 - 6;
      const R = l.x + l.w / 2 + 6;
      const T = l.y - l.h - 3;
      const B = l.y + 3;
      let clash = L < panel + 4 || R > width - 4 || n >= placed.length;
      for (let j = 0; j < n && !clash; j++) {
        const p = placed[j];
        if (p && L < p.r && R > p.l && T < p.b && B > p.t) clash = true;
      }
      if (clash) {
        setOn(l, false);
        continue;
      }
      const slot = placed[n++];
      if (slot) {
        slot.l = L;
        slot.r = R;
        slot.t = T;
        slot.b = B;
      }
      setOn(l, true);
      const px = Math.round(l.x);
      const py = Math.round(l.y);
      if (px !== l.px || py !== l.py) {
        l.px = px;
        l.py = py;
        l.el.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
      }
    }
    // the topic the brain works on wears the accent
    for (let ti = 0; ti < topicLabels.length; ti++) {
      const l = topicLabels[ti];
      if (!l) continue;
      l.el.classList.toggle(opts.classes.active, ti === ambientTopic && view.kind === "brain");
    }
  }

  // --- pointer ----------------------------------------------------------------------------------

  type Hit =
    | { kind: "claim" | "topic" | "threat" | "block" | "layer" | "snapshot"; i: number }
    | { kind: "none"; i: -1 };
  const NONE: Hit = { kind: "none", i: -1 };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const right = new THREE.Vector3();

  function nearest(
    n: number,
    at: (i: number) => THREE.Vector3 | undefined,
    skip: (i: number) => boolean,
    cx: number,
    cy: number,
    r: number,
  ) {
    let best = -1;
    let bestD = r * r;
    let bestZ = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (skip(i)) continue;
      const p = at(i);
      if (!p) continue;
      const s = toScreen(p);
      if (!s.ok || s.x < panel) continue;
      const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
      if (d < bestD || (d < r * r && Math.abs(d - bestD) < 4 && s.z < bestZ)) {
        best = i;
        bestD = d;
        bestZ = s.z;
      }
    }
    return best;
  }

  function pick(cx: number, cy: number): Hit {
    if (cx < panel) return NONE;
    const k = view.kind;
    const threatsOn = (mix4To[THREAT_A] ?? 0) > 0.9;
    if (threatsOn && threats.length) {
      const t = nearest(
        threats.length,
        (i) => threats[i]?.pos,
        () => false,
        cx,
        cy,
        15,
      );
      if (t >= 0) return { kind: "threat", i: t };
    }
    if (k === "proof" && data.snapshots.length) {
      for (let si = data.snapshots.length - 1; si >= 0; si--) {
        va.set(snapX[si] ?? 0, 0.5, 0);
        const c = toScreen(va);
        const cx0 = c.x;
        const cy0 = c.y;
        vb.set(snapX[si] ?? 0, 0.5 + 1.58, 0);
        const e = toScreen(vb);
        const r = Math.hypot(e.x - cx0, e.y - cy0);
        const d = Math.hypot(cx - cx0, cy - cy0);
        if (d < r * 1.15 + 6 && d > r * 0.55) return { kind: "snapshot", i: si };
      }
    }
    if (k !== "security" && k !== "proof") {
      const c = nearest(
        claims.length,
        (i) => nodePos[i],
        (i) => (nodeDim[i] ?? 0) > 0.8,
        cx,
        cy,
        13,
      );
      if (c >= 0) return { kind: "claim", i: c };
      right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(CAGE);
      let topic = -1;
      for (let ti = 0; ti < clusters.length; ti++) {
        const cc = clusters[ti]?.center;
        if (!cc || (topicDim[ti] ?? 0) > 0.7) continue;
        if (view.kind === "topic" && topics[ti]?.slug === view.slug) continue;
        const s = toScreen(cc);
        if (!s.ok) continue;
        const sx = s.x;
        const sy = s.y;
        const e = toScreen(va.copy(cc).add(right));
        const r = Math.hypot(e.x - sx, e.y - sy);
        if (Math.hypot(sx - cx, sy - cy) < r) topic = ti;
      }
      if (topic >= 0) return { kind: "topic", i: topic };
    }
    // the chain: the block under the pointer
    if (k !== "security" || !nL) {
      const b = nearest(
        blocks.length,
        (i) => {
          const bl = blocks[i];
          return bl ? va.set(bl.pos.x, bl.size.y * 0.5, 0) : undefined;
        },
        () => false,
        cx,
        cy,
        9,
      );
      if (b >= 0) return { kind: "block", i: b };
    }
    // a stratum: where the pointer's ray meets its plane, inside its outline
    if ((mix4To[STRATA_A] ?? 0) > 0.9 && nL) {
      ndc.set((cx / width) * 2 - 1, -(cy / height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const o = ray.ray.origin;
      const d = ray.ray.direction;
      for (let l = 0; l < nL; l++) {
        if (Math.abs(d.y) < 1e-4) break;
        const t = (layerY(l) - o.y) / d.y;
        if (t <= 0) continue;
        const x = o.x + d.x * t;
        const z = o.z + d.z * t;
        if (x >= SX0 && x <= SX1 && Math.abs(z) <= STRATA.depth) return { kind: "layer", i: l };
      }
    }
    return NONE;
  }

  const statusWord = { defended: "defended", watching: "watching", open: "open" } as const;

  function describe(h: Hit, x: number, y: number): Hover | null {
    if (h.kind === "claim") {
      const c = claims[h.i];
      if (!c) return null;
      const t = topics[claimTopic[h.i] ?? -1]?.title ?? "";
      return { label: c.label, meta: c.status === "contested" ? `${t}, contested` : t, x, y };
    }
    if (h.kind === "topic") {
      const t = topics[h.i];
      return t ? { label: t.title, meta: `${t.count} claims`, x, y } : null;
    }
    if (h.kind === "threat") {
      const t = threats[h.i];
      if (!t) return null;
      return {
        label: t.label,
        meta: `${layers[t.layer]?.label ?? ""}, ${statusWord[t.status]}`,
        tone: t.status,
        x,
        y,
      };
    }
    if (h.kind === "block") {
      const b = blocks[h.i];
      if (!b) return null;
      const n = perBlock[h.i] ?? 0;
      const what =
        n === 1
          ? "1 claim last checked here"
          : n
            ? `${n} claims last checked here`
            : "No claim last checked here";
      return { label: what, meta: `Block ${fmt(b.h)}${h.i === tipIdx ? ", the tip" : ""}`, x, y };
    }
    if (h.kind === "layer") {
      const l = layers[h.i];
      if (!l) return null;
      const openN = l.threats.filter((t) => t.status === "open").length;
      const n = l.threats.length;
      return {
        label: l.label,
        meta: `${n} ${n === 1 ? "threat" : "threats"}${openN ? `, ${openN} open` : ""}`,
        x,
        y,
      };
    }
    if (h.kind === "snapshot") {
      const s = data.snapshots[h.i];
      if (!s) return null;
      const where = s.anchor ? `sealed in block ${fmt(s.anchor)}` : "proof pending";
      return {
        label: `Snapshot ${s.n}, taken at block ${fmt(s.height)}, ${where}${s.signed ? ", signed" : ""}`,
        meta: "Snapshot",
        tone: "accent",
        x,
        y,
      };
    }
    return null;
  }

  function hrefOf(h: Hit): string | null {
    if (h.kind === "claim") return claims[h.i] ? `/claims/${claims[h.i]?.id}` : null;
    if (h.kind === "topic") return topics[h.i] ? `/topics/${topics[h.i]?.slug}` : null;
    if (h.kind === "threat") return threats[h.i] ? `/security/${threats[h.i]?.id}` : null;
    if (h.kind === "snapshot") {
      const s = data.snapshots[h.i];
      return s ? `/verify#snapshot-${s.n}` : null;
    }
    return null;
  }

  function setHover(h: Hit) {
    const was = [hovered, hoveredTopic, hoveredThreat, hoveredBlock, hoveredLayer, hoveredSnap];
    hovered = h.kind === "claim" ? h.i : -1;
    hoveredTopic = h.kind === "topic" ? h.i : -1;
    hoveredThreat = h.kind === "threat" ? h.i : -1;
    hoveredBlock = h.kind === "block" ? h.i : -1;
    hoveredLayer = h.kind === "layer" ? h.i : -1;
    hoveredSnap = h.kind === "snapshot" ? h.i : -1;
    const now2 = [hovered, hoveredTopic, hoveredThreat, hoveredBlock, hoveredLayer, hoveredSnap];
    if (was.some((w, i) => w !== now2[i])) {
      setTargets();
      kick();
    }
  }

  const el = renderer.domElement;
  const desk = window.matchMedia("(min-width: 900px)");
  let usedOnce = false;
  const controls: Controls = createControls(el, {
    onHover(x, y) {
      const h = pick(x, y);
      setHover(h);
      el.style.cursor = hrefOf(h) ? "pointer" : controls.dragging() ? "grabbing" : "";
      opts.onHover(describe(h, x, y));
    },
    onLeave() {
      setHover(NONE);
      el.style.cursor = "";
      opts.onHover(null);
    },
    onTap(x, y) {
      const href = hrefOf(pick(x, y));
      if (href) opts.onPick(href);
    },
    onChange() {
      if (!usedOnce && controls.used() > 0) {
        usedOnce = true;
        opts.onUse?.();
      }
      kick();
    },
    wheelZooms: () => desk.matches,
  });
  controls.setBase(shotNow.s.phi, shotNow.s.phiMin, shotNow.s.phiMax);

  // --- public -------------------------------------------------------------------------------------

  function applyTheme() {
    pal = palette(dark);
    tone[1]?.copy(pal.status.defended);
    tone[2]?.copy(pal.status.watching);
    tone[3]?.copy(pal.status.open);
    renderer.setClearColor(pal.bg, 1);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(pal.bg);
    hemi.intensity = dark ? 1.3 : 2.4;
    sun.intensity = dark ? 0.9 : 1.4;
    hemi.groundColor.set(dark ? 0x30343c : 0x8a9099);
    paintAll = true;
  }
  for (const o of [
    blockMesh,
    edges,
    nodeMesh,
    ringMesh,
    threads,
    cages,
    snaps,
    strata,
    threatMesh,
    halo,
    seal,
    sealRim,
    ghostMesh,
    synapses,
  ])
    o.frustumCulled = false;
  applyTheme();
  setTargets();
  snapAll();
  place(reduced ? 1 : 0);

  function setFlight() {
    // the flight starts from wherever the camera is, offsets and all
    fromTarget.copy(camTarget);
    v3.copy(camPos).sub(camTarget);
    from.d = Math.max(v3.length(), 0.01);
    from.phi = Math.acos(clamp(v3.y / from.d, -1, 1));
    from.theta = Math.atan2(v3.x, v3.z);
    const travel = camTarget.distanceTo(shotNow.s.target);
    flightDur = clamp(0.95 + travel * 0.03, 0.95, 1.8);
    flightHop = clamp((travel - 6) / 14);
    flightT0 = now;
  }

  return {
    setView(v) {
      view = v;
      shotNow = framing(v);
      controls.reset();
      controls.setBase(shotNow.s.phi, shotNow.s.phiMin, shotNow.s.phiMax);
      setFlight();
      setTargets();
      kick();
    },
    setReduced(r) {
      reduced = r;
      if (r) {
        snapAll();
        sparks.clear();
      }
      kick();
    },
    setTheme(d) {
      dark = d;
      applyTheme();
      kick();
    },
    setActive(on) {
      active = on;
      if (on) {
        lastFrame = performance.now();
        kick();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    resize(w, h, p) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      panel = p > 0 && p < width - 120 ? p : 0;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
      camera.aspect = width / height;
      // Center the projection on the free area to the right of the panel.
      if (panel > 0) camera.setViewOffset(width + panel, height, 0, 0, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      fitted.clear();
      shotNow = framing(view);
      for (const l of labels) l.w = 0;
      kick();
    },
    signal(e) {
      if (reduced) {
        // no motion: only what stays true afterwards, drawn once
        signals++;
        settle(e);
        kick();
        return;
      }
      if (queue.length > 12) queue.shift();
      queue.push(e);
      kick();
    },
    setAmbient(a) {
      const was = ambient?.kind;
      ambient = a;
      ambientTopic = a?.topic ? (topicIdx.get(a.topic) ?? -1) : -1;
      paused = a?.kind === "paused";
      if (a?.kind !== was) ambientNext = now + 0.4;
      paintAll = true;
      kick();
    },
    probe() {
      return {
        view: view.kind,
        theta: sph.theta,
        phi: sph.phi,
        distance: sph.d,
        zoom: controls.offset.zoom,
        offset: { ...controls.offset },
        playing: fx.filter((f) => f.on).length + queue.length,
        frames,
        signals,
        ambient: ambient?.kind ?? null,
        threats: threats.length,
      };
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      controls.dispose();
      for (const l of labels) l.el.remove();
      sparks.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) for (const x of mat) x.dispose();
        else mat?.dispose();
      });
      renderer.dispose();
      el.remove();
    },
  };
}
