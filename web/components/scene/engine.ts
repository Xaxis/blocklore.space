import * as THREE from "three";
import type { SceneData } from "@/lib/graph";

// The ledger: Blocklore's store drawn as a model anchored to the chain. A long axis of blocks (the
// heights where something happened, and the ones between them), one cluster per topic above it,
// a node per claim, and a thread from each claim to the block it was last checked at. Snapshots
// are rings around the axis. One renderer for the app's lifetime; views ease between each other.

export type View =
  | { kind: "overview"; variant: number }
  | { kind: "topic"; slug: string }
  | { kind: "claim"; id: string }
  | { kind: "timeline" }
  | { kind: "verify" };

export interface Hover {
  label: string;
  meta: string;
  x: number;
  y: number;
}

export interface EngineOptions {
  reduced: boolean;
  dark: boolean;
  classes: { label: string; topic: string; block: string; tip: string; on: string };
  onHover: (h: Hover | null) => void;
  onPick: (href: string) => void;
}

export interface Engine {
  setView(v: View): void;
  setReduced(r: boolean): void;
  setTheme(dark: boolean): void;
  setActive(on: boolean): void;
  resize(width: number, height: number, panel: number): void;
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
const TWEEN = 1.2;
const ASSEMBLE = 1.4;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (t: number) => Math.min(1, Math.max(0, t));

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
}

function palette(dark: boolean): Palette {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = css.getPropertyValue(name).trim();
    return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback);
  };
  const bg = read("--bg-subtle", dark ? "#111419" : "#f7f8fa");
  const ink = read("--ink", dark ? "#e8ebf0" : "#0f1217");
  return {
    bg,
    ink,
    face: dark ? new THREE.Color("#1a1e26") : new THREE.Color("#ffffff"),
    faceDim: dark ? new THREE.Color("#14171d") : new THREE.Color("#fbfbfc"),
  };
}

export function createEngine(
  container: HTMLElement,
  overlay: HTMLElement,
  data: SceneData,
  opts: EngineOptions,
): Engine | null {
  // Ask quietly first: three logs an error when it cannot get a context, and the still drawing
  // is the expected path, not a failure.
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return null;
  probe.getExtension("WEBGL_lose_context")?.loseContext();
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
    ...data.snapshots.map((s) => s.height),
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
  const blockAt = new Map(blocks.map((b) => [b.h, b]));

  const blockMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    blocks.length,
  );
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
  const nT = Math.max(topics.length, 1);
  const cluster = new Map<
    string,
    { center: THREE.Vector3; i: number; title: string; count: number; angle: number }
  >();
  topics.forEach((t, i) => {
    const u = nT === 1 ? 0.5 : i / (nT - 1);
    const angle = (u - 0.5) * 2 * ARC.spread;
    const center = new THREE.Vector3(
      Math.sin(angle) * ARC.radius,
      4.4 + Math.cos(angle) * 1.8 + (i % 2) * 1.5,
      ARC.z - Math.cos(angle) * ARC.radius,
    );
    cluster.set(t.slug, { center, i, title: t.title, count: t.count, angle });
  });

  const claims = data.claims.filter((c) => cluster.has(c.topic));
  const claimIndex = new Map(claims.map((c, i) => [c.id, i]));
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
      const center = cluster.get(slug ?? "")?.center ?? new THREE.Vector3();
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
    claims.length,
  );
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

  // Threads: each claim down to the block it was last checked at.
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
  const anchorOf = (i: number) => {
    const b = blockAt.get(claims[i]?.checked ?? tip) ?? blocks.at(-1);
    return b ? new THREE.Vector3(b.pos.x, b.size.y, 0) : new THREE.Vector3();
  };
  const anchors = claims.map((_, i) => anchorOf(i));

  // Cages: three great circles per cluster, a stem to the ground and a foot.
  const SEG = 72;
  const cageVerts = (SEG * 3 + 3) * 2;
  const cageGeo = new THREE.BufferGeometry();
  const cagePos = new Float32Array(topics.length * cageVerts * 3);
  const cageCol = new Float32Array(topics.length * cageVerts * 3);
  topics.forEach((t, ti) => {
    const c = cluster.get(t.slug)?.center ?? new THREE.Vector3();
    let o = ti * cageVerts * 3;
    const put = (v: THREE.Vector3) => {
      cagePos[o++] = v.x;
      cagePos[o++] = v.y;
      cagePos[o++] = v.z;
    };
    const circle = (axis: 0 | 1 | 2) => {
      for (let s = 0; s < SEG; s++)
        for (const a of [s, s + 1]) {
          const th = (a / SEG) * Math.PI * 2;
          const p = [Math.cos(th) * CAGE, Math.sin(th) * CAGE];
          const v =
            axis === 0
              ? new THREE.Vector3(c.x + (p[0] ?? 0), c.y, c.z + (p[1] ?? 0))
              : axis === 1
                ? new THREE.Vector3(c.x + (p[0] ?? 0), c.y + (p[1] ?? 0) * 0.82, c.z)
                : new THREE.Vector3(c.x, c.y + (p[1] ?? 0) * 0.82, c.z + (p[0] ?? 0));
          put(v);
        }
    };
    circle(0);
    circle(1);
    circle(2);
    put(new THREE.Vector3(c.x, c.y - CAGE * 0.82, c.z));
    put(new THREE.Vector3(c.x, 0, c.z));
    put(new THREE.Vector3(c.x - 0.35, 0, c.z));
    put(new THREE.Vector3(c.x + 0.35, 0, c.z));
    put(new THREE.Vector3(c.x, 0, c.z - 0.35));
    put(new THREE.Vector3(c.x, 0, c.z + 0.35));
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

  // Snapshots: two thin rings around the axis at the snapshot's height.
  const RING = 64;
  const snapGeo = new THREE.BufferGeometry();
  const snapPos = new Float32Array(data.snapshots.length * RING * 2 * 2 * 3);
  const snapCol = new Float32Array(snapPos.length);
  data.snapshots.forEach((s, si) => {
    const x = xOf(s.height);
    let o = si * RING * 4 * 3;
    for (const r of [1.45, 1.58])
      for (let k = 0; k < RING; k++)
        for (const a of [k, k + 1]) {
          const th = (a / RING) * Math.PI * 2;
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

  // The selected claim's ping: an orange ring that grows and fades.
  const ping = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.162, 48),
    new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, side: THREE.DoubleSide }),
  );
  ping.visible = false;
  scene.add(ping);

  // --- labels (DOM, so they use the site's type) -------------------------------------------------

  interface Label {
    el: HTMLElement;
    at: THREE.Vector3;
    show: (v: View) => boolean;
    topic: number;
    w: number;
    h: number;
  }
  const labels: Label[] = [];
  const addLabel = (
    text: string,
    cls: string,
    at: THREE.Vector3,
    show: Label["show"],
    topic = -1,
  ) => {
    const el = document.createElement("span");
    el.className = `${opts.classes.label} ${cls}`;
    el.textContent = text;
    overlay.append(el);
    labels.push({ el, at, show, topic, w: 0, h: 0 });
  };
  for (const t of topics) {
    const c = cluster.get(t.slug);
    if (!c) continue;
    addLabel(
      t.title,
      opts.classes.topic,
      c.center.clone().add(new THREE.Vector3(0, CAGE * 0.82 + 0.55, 0)),
      (v) =>
        v.kind === "overview" ||
        (v.kind === "topic" && v.slug === t.slug) ||
        (v.kind === "claim" && claims[claimIndex.get(v.id) ?? -1]?.topic === t.slug),
      topics.indexOf(t),
    );
  }
  const tipBlock = blockAt.get(tip);
  if (tipBlock)
    addLabel(
      `Tip ${fmt(tip)}`,
      opts.classes.tip,
      new THREE.Vector3(tipBlock.pos.x, tipBlock.size.y + 0.5, 0),
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
  for (const s of data.snapshots)
    addLabel(
      `Snapshot ${s.n}`,
      opts.classes.block,
      new THREE.Vector3(xOf(s.height), 2.35, 0),
      (v) => v.kind === "verify" || v.kind === "timeline",
    );

  // --- state ------------------------------------------------------------------------------------

  const latest = claims.reduce((m, c) => Math.max(m, c.seen, c.checked), 0);
  const recent = claims.map((c) => c.seen === latest || c.checked === latest);

  let view: View = { kind: "overview", variant: 0 };
  const nodeDim = new Float32Array(claims.length).fill(0);
  const nodeDimTo = new Float32Array(claims.length).fill(0);
  const topicDim = new Float32Array(topics.length).fill(0);
  const topicDimTo = new Float32Array(topics.length).fill(0);
  const threadA = new Float32Array(claims.length).fill(0.05);
  const threadATo = new Float32Array(claims.length).fill(0.05);
  let hovered = -1;
  let hoveredTopic = -1;
  let selected = -1;
  let snapLit = 0;
  let snapLitTo = 0;

  const camPos = new THREE.Vector3(0, 9, 34);
  const camTarget = new THREE.Vector3(0, 3.5, 0);
  let fromPos = camPos.clone();
  let fromTarget = camTarget.clone();
  let tweenStart = -1;

  let width = 1;
  let height = 1;
  let panel = 0;
  let active = true;
  let raf = 0;
  const clock = new THREE.Clock();
  const t0 = reduced ? -ASSEMBLE : 0;
  let now = 0;

  // --- framing: each view names a target, a direction and the points that must stay in view;
  // the distance is fitted to the free area (right of the dock), so nothing hides under it.

  interface Shot {
    target: THREE.Vector3;
    phi: number;
    theta: number;
    sway: number;
    keep: THREE.Vector3[];
    min: number;
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
      ...data.snapshots.map((x) => new THREE.Vector3(xOf(x.height), 2.6, 0)),
    ];
  };
  const everything = [
    ...topics.flatMap((t) => shell(cluster.get(t.slug)?.center ?? new THREE.Vector3(), CAGE)),
    ...axisEnds(),
  ];
  const middle = new THREE.Box3().setFromPoints(everything).getCenter(new THREE.Vector3());

  function shot(v: View): Shot {
    if (v.kind === "topic") {
      const k = cluster.get(v.slug);
      const c = k?.center;
      if (c)
        return {
          target: c.clone(),
          phi: 1.12,
          // from the arc's middle, toward the cluster, a little from the left
          theta: -(k?.angle ?? 0) * 0.85 - 0.2,
          sway: 0.05,
          keep: shell(c, CAGE * 1.35),
          min: 6,
        };
    }
    if (v.kind === "claim") {
      const i = claimIndex.get(v.id);
      const p = i === undefined ? undefined : nodePos[i];
      const a = i === undefined ? undefined : anchors[i];
      const k = i === undefined ? undefined : cluster.get(claims[i]?.topic ?? "");
      if (p && a && k) {
        // From above the front of its cluster, so its thread drops toward the chain below.
        const t = a.clone().sub(p).normalize();
        return {
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
        target: new THREE.Vector3((xOf(minH) + xOf(tip)) / 2 + AXIS * 0.08, 0.7, 0),
        phi: 1.26,
        theta: -1.02,
        sway: 0.08,
        keep: axisEnds(),
        min: 10,
      };
    if (v.kind === "verify") {
      const sn = data.snapshots.at(-1);
      const x = sn ? xOf(sn.height) : xOf(tip);
      const ring = [-1.7, 1.7].flatMap((d) => [
        new THREE.Vector3(x, 0.5 + d, 0),
        new THREE.Vector3(x, 0.5, d),
      ]);
      return {
        target: new THREE.Vector3(x, 0.6, 0),
        phi: 1.2,
        theta: -0.78,
        sway: 0.05,
        keep: [...ring, new THREE.Vector3(x, 2.9, 0)],
        min: 5,
      };
    }
    const variant = v.kind === "overview" ? v.variant : 0;
    return {
      target: middle.clone(),
      phi: 1.06,
      theta: -0.3 + variant * 0.05,
      sway: 0.12,
      keep: everything,
      min: 14,
    };
  }

  const probeCam = new THREE.PerspectiveCamera();
  const pv = new THREE.Vector3();
  const dirOf = (phi: number, theta: number) =>
    new THREE.Vector3(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(theta),
    );

  function fits(s: Shot, d: number): boolean {
    probeCam.copy(camera);
    probeCam.position.copy(s.target).addScaledVector(dirOf(s.phi, s.theta), d);
    probeCam.lookAt(s.target);
    probeCam.updateMatrixWorld();
    probeCam.updateProjectionMatrix();
    const left = panel > 0 ? (panel / width) * 2 - 1 : -1;
    for (const p of s.keep) {
      pv.copy(p).project(probeCam);
      if (pv.z > 1 || pv.x < left + 0.08 || pv.x > 0.93 || pv.y < -0.88 || pv.y > 0.84)
        return false;
    }
    return true;
  }

  const fitted = new Map<string, { s: Shot; d: number }>();
  function framing(v: View) {
    const key = JSON.stringify(v);
    const hit = fitted.get(key);
    if (hit) return hit;
    const s = shot(v);
    let lo = s.min;
    let hi = 260;
    if (!fits(s, lo)) {
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (fits(s, mid)) hi = mid;
        else lo = mid;
      }
      lo = hi;
    }
    const out = { s, d: lo };
    fitted.set(key, out);
    return out;
  }

  function goal(v: View, t: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const { s, d } = framing(v);
    const theta = s.theta + (reduced ? 0 : Math.sin(t * 0.09) * s.sway);
    return {
      target: s.target,
      pos: s.target.clone().addScaledVector(dirOf(s.phi, theta), d),
    };
  }

  function setTargets() {
    const sel = view.kind === "claim" ? (claimIndex.get(view.id) ?? -1) : -1;
    selected = sel;
    const focusTopic =
      view.kind === "topic"
        ? view.slug
        : view.kind === "claim" && sel >= 0
          ? (claims[sel]?.topic ?? null)
          : null;
    topics.forEach((t, ti) => {
      topicDimTo[ti] =
        view.kind === "timeline" || view.kind === "verify"
          ? 0.55
          : focusTopic && t.slug !== focusTopic
            ? 0.8
            : 0;
    });
    claims.forEach((c, i) => {
      let d = 0;
      if (view.kind === "timeline") d = recent[i] ? 0 : 0.72;
      else if (view.kind === "verify") d = 0.7;
      else if (focusTopic && c.topic !== focusTopic) d = 0.86;
      else if (sel >= 0 && i !== sel) d = 0.45;
      nodeDimTo[i] = d;
    });
    // Threads: a whisper in the overview, the focus's own in a topic or claim, the recent ones on
    // the timeline.
    claims.forEach((c, i) => {
      let a = 0.028;
      if (view.kind === "timeline") a = recent[i] ? 0.34 : 0.025;
      else if (view.kind === "verify") a = 0.04;
      else if (sel >= 0) a = i === sel ? 0.95 : c.topic === focusTopic ? 0.1 : 0.012;
      else if (focusTopic) a = c.topic === focusTopic ? 0.3 : 0.012;
      threadATo[i] = a;
    });
    snapLitTo = view.kind === "verify" ? 1 : 0;
    if (reduced) snapAll();
  }

  function snapAll() {
    nodeDim.set(nodeDimTo);
    topicDim.set(topicDimTo);
    threadA.set(threadATo);
    snapLit = snapLitTo;
  }

  // --- colors -----------------------------------------------------------------------------------

  const tmp = new THREE.Color();
  const mix = (t: number, out = tmp) => out.lerpColors(pal.ink, pal.bg, clamp(t));

  function paint(assembly: number) {
    const fade = clamp((assembly - 0.62) / 0.38);
    // blocks
    blocks.forEach((b, i) => {
      const c = b.h === tip ? ORANGE : b.event ? pal.face : pal.faceDim;
      blockMesh.setColorAt(i, c);
      const ec = b.h === tip ? ORANGE : mix(b.event ? 0.42 : 0.74);
      for (let k = 0; k < unitEdges.length / 3; k++) {
        const o = i * unitEdges.length + k * 3;
        edgeCol[o] = ec.r;
        edgeCol[o + 1] = ec.g;
        edgeCol[o + 2] = ec.b;
      }
    });
    if (blockMesh.instanceColor) blockMesh.instanceColor.needsUpdate = true;
    dirty(edgeGeo, "color");
    // nodes and threads
    const out = new THREE.Color();
    claims.forEach((c, i) => {
      const base = c.status === "established" ? 0.06 : 0.34;
      if (i === selected) out.copy(ORANGE);
      else if (i === hovered) mix(0, out);
      else mix(base + (0.92 - base) * (nodeDim[i] ?? 0), out);
      nodeMesh.setColorAt(i, out);
      const ta = (threadA[i] ?? 0) * fade;
      for (let k = 0; k < 2; k++) {
        const o = i * 8 + k * 4;
        threadCol[o] = pal.ink.r;
        threadCol[o + 1] = pal.ink.g;
        threadCol[o + 2] = pal.ink.b;
        threadCol[o + 3] = ta;
      }
    });
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
    dirty(threadGeo, "color");
    contested.forEach((ci, k) => {
      ringMesh.setColorAt(k, mix(0.1 + 0.8 * (nodeDim[ci] ?? 0), out));
    });
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
    // cages
    topics.forEach((_, ti) => {
      const hot = ti === hoveredTopic ? -0.2 : 0;
      const cc = mix(1 - (1 - (0.84 + hot + 0.13 * (topicDim[ti] ?? 0))) * fade, out);
      for (let k = 0; k < cageVerts; k++) {
        const o = (ti * cageVerts + k) * 3;
        cageCol[o] = cc.r;
        cageCol[o + 1] = cc.g;
        cageCol[o + 2] = cc.b;
      }
    });
    dirty(cageGeo, "color");
    // grid
    for (let l = 0; l < gridMajor.length; l++) {
      const gc = mix(1 - (1 - (gridMajor[l] ? 0.86 : 0.93)) * fade, out);
      for (let k = 0; k < 2; k++) {
        const o = (l * 2 + k) * 3;
        gridCol[o] = gc.r;
        gridCol[o + 1] = gc.g;
        gridCol[o + 2] = gc.b;
      }
    }
    dirty(gridGeo, "color");
    // snapshot rings: ink, orange when they are the view
    const sc = out.lerpColors(mix(0.3), ORANGE, snapLit);
    const sf = new THREE.Color().lerpColors(pal.bg, sc, fade);
    for (let k = 0; k < snapCol.length; k += 3) {
      snapCol[k] = sf.r;
      snapCol[k + 1] = sf.g;
      snapCol[k + 2] = sf.b;
    }
    dirty(snapGeo, "color");
  }

  // --- geometry over time (the first-load assembly) ----------------------------------------------

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  function place(assembly: number) {
    const span = ASSEMBLE;
    blocks.forEach((b, i) => {
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
    });
    blockMesh.instanceMatrix.needsUpdate = true;
    dirty(edgeGeo, "position");

    claims.forEach((c, i) => {
      const delay = 0.35 + hash01(c.id) * 0.45;
      const p = ease(clamp((assembly * span - delay) / 0.6));
      const at = nodePos[i] ?? v3;
      const scale = (i === hovered ? 1.9 : i === selected ? 1.6 : 1) * p;
      v3.set(at.x, at.y - (1 - p) * 2.4, at.z);
      s3.setScalar(Math.max(scale, 0.0001));
      m4.compose(v3, q.identity(), s3);
      nodeMesh.setMatrixAt(i, m4);
      const a = anchors[i] ?? v3;
      threadPos.set([v3.x, v3.y, v3.z, a.x, a.y, a.z], i * 6);
    });
    nodeMesh.instanceMatrix.needsUpdate = true;
    dirty(threadGeo, "position");

    contested.forEach((ci, k) => {
      const at = nodePos[ci] ?? v3;
      m4.compose(at, camera.quaternion, s3.setScalar(clamp(assembly)));
      ringMesh.setMatrixAt(k, m4);
    });
    ringMesh.instanceMatrix.needsUpdate = true;
  }

  // --- the frame --------------------------------------------------------------------------------

  let lastAssembly = -1;

  function frame() {
    raf = 0;
    const dt = Math.min(clock.getDelta(), 0.1);
    now += dt;
    const assembly = reduced ? 1 : clamp((now - t0) / ASSEMBLE);

    // ease dims toward their targets
    let settling = false;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
    const step1 = (a: Float32Array, b: Float32Array) => {
      for (let i = 0; i < a.length; i++) {
        const d = (b[i] ?? 0) - (a[i] ?? 0);
        if (Math.abs(d) > 0.002) {
          a[i] = (a[i] ?? 0) + d * k;
          settling = true;
        } else a[i] = b[i] ?? 0;
      }
    };
    step1(nodeDim, nodeDimTo);
    step1(topicDim, topicDimTo);
    step1(threadA, threadATo);
    const lit = snapLitTo - snapLit;
    snapLit = Math.abs(lit) > 0.002 ? snapLit + lit * k : snapLitTo;
    if (Math.abs(lit) > 0.002) settling = true;

    // camera
    const g = goal(view, now);
    let tweening = false;
    let flying = false;
    if (reduced || tweenStart < 0) {
      camPos.copy(g.pos);
      camTarget.copy(g.target);
    } else {
      const p = clamp((now - tweenStart) / TWEEN);
      const e = ease(p);
      camPos.lerpVectors(fromPos, g.pos, e);
      camTarget.lerpVectors(fromTarget, g.target, e);
      tweening = p < 1;
      flying = p < 0.7;
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    const dist = camPos.distanceTo(camTarget);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = dist * 0.85;
      scene.fog.far = dist * 2.4;
    }

    if (assembly !== lastAssembly || contested.length || hovered >= 0 || selected >= 0)
      place(assembly);
    lastAssembly = assembly;
    paint(assembly);

    // the ping on the selected claim
    if (selected >= 0 && nodePos[selected]) {
      ping.visible = true;
      ping.position.copy(nodePos[selected] as THREE.Vector3);
      ping.quaternion.copy(camera.quaternion);
      const cycle = reduced ? 0.25 : (now % 2.6) / 2.6;
      ping.scale.setScalar(1 + cycle * 2.4);
      (ping.material as THREE.MeshBasicMaterial).opacity = reduced ? 0.8 : 0.9 * (1 - cycle) ** 1.5;
    } else ping.visible = false;

    renderer.render(scene, camera);
    // Labels wait while the store assembles and while the camera flies, then settle in place.
    positionLabels(assembly < 0.8 || flying);

    const moving =
      !reduced &&
      (assembly < 1 ||
        tweening ||
        settling ||
        selected >= 0 ||
        view.kind === "overview" ||
        view.kind === "timeline" ||
        view.kind === "verify");
    if (moving && active) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && active) raf = requestAnimationFrame(frame);
  }

  const proj = new THREE.Vector3();
  function toScreen(p: THREE.Vector3): { x: number; y: number; ok: boolean } {
    proj.copy(p).project(camera);
    const ok = proj.z < 1 && proj.z > -1;
    // The view offset shifts the image; project() already includes it.
    return { x: ((proj.x + 1) / 2) * width, y: ((1 - proj.y) / 2) * height, ok };
  }

  // Labels never collide: the hovered topic's goes first, then the tip, then the nearest; a label
  // that would overlap one already placed, or reach under the dock, waits until there is room.
  const placed: { l: number; t: number; r: number; b: number }[] = [];
  function positionLabels(quiet: boolean) {
    const cand: { l: Label; x: number; y: number; rank: number; z: number }[] = [];
    for (const l of labels) {
      const forced = l.topic >= 0 && l.topic === hoveredTopic;
      const s = toScreen(l.at);
      if (!quiet && (forced || l.show(view)) && s.ok && s.y > 8 && s.y < height - 8) {
        // a label already shown keeps its place, so labels never trade places while fading
        const on = l.el.classList.contains(opts.classes.on);
        const tip = l.el.classList.contains(opts.classes.tip);
        cand.push({ l, x: s.x, y: s.y, rank: forced ? 0 : tip ? 1 : on ? 2 : 3, z: proj.z });
      } else l.el.classList.remove(opts.classes.on);
    }
    cand.sort((a, b) => a.rank - b.rank || a.z - b.z);
    placed.length = 0;
    for (const c of cand) {
      if (!c.l.w) {
        c.l.w = c.l.el.offsetWidth;
        c.l.h = c.l.el.offsetHeight;
      }
      const box = {
        l: c.x - c.l.w / 2 - 6,
        r: c.x + c.l.w / 2 + 6,
        t: c.y - c.l.h - 3,
        b: c.y + 3,
      };
      const clash = placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t);
      if (clash || box.l < panel + 4 || box.r > width - 4) {
        c.l.el.classList.remove(opts.classes.on);
        continue;
      }
      placed.push(box);
      c.l.el.classList.add(opts.classes.on);
      c.l.el.style.transform = `translate3d(${Math.round(c.x)}px, ${Math.round(c.y)}px, 0) translate(-50%, -100%)`;
    }
  }

  // --- pointer ----------------------------------------------------------------------------------

  const rect = () => renderer.domElement.getBoundingClientRect();
  let downAt: { x: number; y: number } | null = null;

  function pick(cx: number, cy: number): { claim: number; topic: number } {
    let best = -1;
    let bestD = 13 * 13;
    let bestZ = Number.POSITIVE_INFINITY;
    for (let i = 0; i < claims.length; i++) {
      if ((nodeDim[i] ?? 0) > 0.8) continue;
      const p = nodePos[i];
      if (!p) continue;
      const s = toScreen(p);
      if (!s.ok || s.x < panel) continue;
      const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
      const z = proj.z;
      if (d < bestD || (d < 13 * 13 && Math.abs(d - bestD) < 4 && z < bestZ)) {
        best = i;
        bestD = d;
        bestZ = z;
      }
    }
    if (best >= 0) return { claim: best, topic: -1 };
    let topic = -1;
    topics.forEach((t, ti) => {
      const c = cluster.get(t.slug)?.center;
      if (!c) return;
      const s = toScreen(c);
      const edge = toScreen(
        c
          .clone()
          .add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(CAGE)),
      );
      const r = Math.hypot(edge.x - s.x, edge.y - s.y);
      if (s.ok && s.x > panel && Math.hypot(s.x - cx, s.y - cy) < r) topic = ti;
    });
    return { claim: -1, topic };
  }

  function onMove(e: PointerEvent) {
    const r = rect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const { claim, topic } = pick(cx, cy);
    const changed = claim !== hovered || topic !== hoveredTopic;
    hovered = claim;
    hoveredTopic = claim >= 0 ? -1 : topic;
    renderer.domElement.style.cursor = claim >= 0 || hoveredTopic >= 0 ? "pointer" : "";
    if (claim >= 0) {
      const c = claims[claim];
      const t = c ? cluster.get(c.topic) : undefined;
      opts.onHover(c ? { label: c.label, meta: t?.title ?? "", x: cx, y: cy } : null);
    } else if (hoveredTopic >= 0) {
      const t = topics[hoveredTopic];
      opts.onHover(t ? { label: t.title, meta: `${t.count} claims`, x: cx, y: cy } : null);
    } else opts.onHover(null);
    if (changed) {
      place(1);
      kick();
    }
  }

  function onLeave() {
    if (hovered >= 0 || hoveredTopic >= 0) {
      hovered = -1;
      hoveredTopic = -1;
      renderer.domElement.style.cursor = "";
      kick();
    }
    opts.onHover(null);
  }

  function onDown(e: PointerEvent) {
    downAt = { x: e.clientX, y: e.clientY };
  }

  function onUp(e: PointerEvent) {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    downAt = null;
    const r = rect();
    const { claim, topic } = pick(e.clientX - r.left, e.clientY - r.top);
    const c = claims[claim];
    if (c) opts.onPick(`/claims/${c.id}`);
    else if (topic >= 0 && topics[topic]) opts.onPick(`/topics/${topics[topic]?.slug}`);
  }

  const el = renderer.domElement;
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);

  // --- public -------------------------------------------------------------------------------------

  function applyTheme() {
    pal = palette(dark);
    renderer.setClearColor(pal.bg, 1);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(pal.bg);
    hemi.intensity = dark ? 1.3 : 2.4;
    sun.intensity = dark ? 0.9 : 1.4;
    hemi.groundColor.set(dark ? 0x30343c : 0x8a9099);
  }
  for (const o of [blockMesh, edges, nodeMesh, ringMesh, threads, cages, snaps])
    o.frustumCulled = false;
  applyTheme();
  setTargets();
  snapAll();
  place(reduced ? 1 : 0);

  return {
    setView(v) {
      view = v;
      fromPos = camPos.clone();
      fromTarget = camTarget.clone();
      tweenStart = now;
      setTargets();
      kick();
    },
    setReduced(r) {
      reduced = r;
      if (r) snapAll();
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
        clock.getDelta();
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
      kick();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      for (const l of labels) l.el.remove();
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
