import * as THREE from "three";

// Sparks: small lights that travel on an arc, each with a short tail. One fixed pool for the
// engine's lifetime (an instanced head and one line buffer for the tails), so a burst of activity
// never allocates. A full pool reuses the oldest spark.

export interface Sparks {
  readonly group: THREE.Group;
  /** Sends one spark from a to b over `dur` seconds, starting at `t0`, arcing `lift` above. */
  emit(
    a: THREE.Vector3,
    b: THREE.Vector3,
    lift: number,
    t0: number,
    dur: number,
    c: THREE.Color,
  ): void;
  /** Places every live spark for time `now`; returns how many still fly. */
  update(now: number): number;
  clear(): void;
  dispose(): void;
}

const TAIL = 0.11;

export function createSparks(size: number, radius = 0.045): Sparks {
  const group = new THREE.Group();
  const from = new Float32Array(size * 3);
  const to = new Float32Array(size * 3);
  const lift = new Float32Array(size);
  const t0 = new Float32Array(size);
  const dur = new Float32Array(size).fill(0);
  const col = new Float32Array(size * 3);
  let next = 0;

  const head = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(radius, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
    size,
  );
  head.frustumCulled = false;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < size; i++) head.setMatrixAt(i, zero);
  head.setColorAt(0, new THREE.Color(1, 1, 1));

  const tailGeo = new THREE.BufferGeometry();
  const tailPos = new Float32Array(size * 6);
  const tailCol = new Float32Array(size * 8);
  tailGeo.setAttribute("position", new THREE.BufferAttribute(tailPos, 3));
  tailGeo.setAttribute("color", new THREE.BufferAttribute(tailCol, 4));
  const tail = new THREE.LineSegments(
    tailGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  tail.frustumCulled = false;
  group.add(tail, head);

  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const one = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  /** A point on the arc from i's start to its end at progress u. */
  function at(i: number, u: number, out: THREE.Vector3) {
    const k = i * 3;
    const v = 1 - u;
    const ax = from[k] ?? 0;
    const ay = from[k + 1] ?? 0;
    const az = from[k + 2] ?? 0;
    const bx = to[k] ?? 0;
    const by = to[k + 1] ?? 0;
    const bz = to[k + 2] ?? 0;
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2 + (lift[i] ?? 0);
    const cz = (az + bz) / 2;
    out.set(
      v * v * ax + 2 * v * u * cx + u * u * bx,
      v * v * ay + 2 * v * u * cy + u * u * by,
      v * v * az + 2 * v * u * cz + u * u * bz,
    );
    return out;
  }

  return {
    group,
    emit(a, b, l, start, d, color) {
      // the next free slot, or the oldest
      let i = -1;
      for (let k = 0; k < size; k++) {
        const j = (next + k) % size;
        if (!dur[j]) {
          i = j;
          break;
        }
      }
      if (i < 0) i = next;
      next = (i + 1) % size;
      from[i * 3] = a.x;
      from[i * 3 + 1] = a.y;
      from[i * 3 + 2] = a.z;
      to[i * 3] = b.x;
      to[i * 3 + 1] = b.y;
      to[i * 3 + 2] = b.z;
      lift[i] = l;
      t0[i] = start;
      dur[i] = Math.max(d, 0.05);
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
    },
    update(now) {
      let live = 0;
      for (let i = 0; i < size; i++) {
        const d = dur[i] ?? 0;
        if (!d) continue;
        const raw = (now - (t0[i] ?? 0)) / d;
        if (raw >= 1) {
          dur[i] = 0;
          head.setMatrixAt(i, zero);
          tailCol[i * 8 + 3] = 0;
          tailCol[i * 8 + 7] = 0;
          continue;
        }
        live++;
        if (raw < 0) {
          head.setMatrixAt(i, zero);
          tailCol[i * 8 + 3] = 0;
          tailCol[i * 8 + 7] = 0;
          continue;
        }
        const u = ease(raw);
        at(i, u, p);
        at(i, Math.max(0, u - TAIL), q);
        // fade in at the start and out at the end
        const a = Math.min(1, raw * 6, (1 - raw) * 5);
        m4.compose(p, one, s.setScalar(0.4 + 0.6 * a));
        head.setMatrixAt(i, m4);
        c.setRGB(col[i * 3] ?? 1, col[i * 3 + 1] ?? 1, col[i * 3 + 2] ?? 1);
        head.setColorAt(i, c);
        tailPos[i * 6] = p.x;
        tailPos[i * 6 + 1] = p.y;
        tailPos[i * 6 + 2] = p.z;
        tailPos[i * 6 + 3] = q.x;
        tailPos[i * 6 + 4] = q.y;
        tailPos[i * 6 + 5] = q.z;
        for (let k = 0; k < 2; k++) {
          const o = i * 8 + k * 4;
          tailCol[o] = c.r;
          tailCol[o + 1] = c.g;
          tailCol[o + 2] = c.b;
          tailCol[o + 3] = k === 0 ? 0.85 * a : 0;
        }
      }
      head.instanceMatrix.needsUpdate = true;
      if (head.instanceColor) head.instanceColor.needsUpdate = true;
      const pa = tailGeo.getAttribute("position");
      const ca = tailGeo.getAttribute("color");
      if (pa) pa.needsUpdate = true;
      if (ca) ca.needsUpdate = true;
      return live;
    },
    clear() {
      dur.fill(0);
      for (let i = 0; i < size; i++) head.setMatrixAt(i, zero);
      tailCol.fill(0);
      head.instanceMatrix.needsUpdate = true;
      const ca = tailGeo.getAttribute("color");
      if (ca) ca.needsUpdate = true;
    },
    dispose() {
      head.geometry.dispose();
      (head.material as THREE.Material).dispose();
      tailGeo.dispose();
      (tail.material as THREE.Material).dispose();
    },
  };
}
