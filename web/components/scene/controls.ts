// The scene's hands: drag to turn, wheel or pinch to zoom, a tap to pick. The engine owns the
// camera; this only keeps three offsets from the view's framing (turn, tilt, zoom) and eases them
// home when the pointer has gone quiet, so every view returns to the shot it was framed for.

export interface Offset {
  /** Radians added to the view's azimuth. */
  theta: number;
  /** Radians added to the view's polar angle. */
  phi: number;
  /** Log of the distance multiplier: negative is closer. */
  zoom: number;
}

export interface ControlsOptions {
  /** A pointer moved over the scene with no button down (canvas pixels). */
  onHover(x: number, y: number): void;
  onLeave(): void;
  /** A press and release that did not travel: a pick. */
  onTap(x: number, y: number): void;
  /** Anything that should draw a frame. */
  onChange(): void;
  /** True when a plain wheel may zoom here (the scene fills the stage, so nothing else scrolls). */
  wheelZooms(): boolean;
}

export interface Controls {
  readonly offset: Offset;
  /** Advance damping, inertia and the return home; true while anything still moves. */
  step(dt: number, reduced: boolean): boolean;
  /** The view's own polar angle, so the tilt stays above the ground and below the zenith. */
  setBase(phi: number, phiMin: number, phiMax: number): void;
  /** A new view: forget the offsets (the camera flight starts from where the camera is). */
  reset(): void;
  dragging(): boolean;
  /** Count of drags and zooms since the start, for the hint. */
  used(): number;
  dispose(): void;
}

export const ZOOM_MIN = -1.05;
export const ZOOM_MAX = 0.7;
const TAP = 6;
const TURN = 0.0062;
/** The pointer has left: start home after this long. */
const HOME_AFTER_LEAVE = 1.6;
/** The pointer rests over the scene: start home after this long. */
const HOME_AFTER_STILL = 7;

export function createControls(el: HTMLElement, opts: ControlsOptions): Controls {
  const offset: Offset = { theta: 0, phi: 0, zoom: 0 };
  let zoomTo = 0;
  let vTheta = 0;
  let vPhi = 0;
  let base = { phi: 1, min: 0.3, max: 1.5 };
  let clock = 0;
  let lastInput = -1e9;
  let leftAt = -1e9;
  let inside = false;
  let uses = 0;

  // Pointers down, by id; one is a drag, two are a pinch.
  const down = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 };
  let last = { x: 0, y: 0, t: 0 };
  let drag = false;
  let pinch = { d: 0, zoom: 0 };

  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clampPhi = (p: number) => Math.min(base.max - base.phi, Math.max(base.min - base.phi, p));
  const touch = () => {
    lastInput = clock;
    opts.onChange();
  };

  function onDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    down.set(e.pointerId, p);
    if (down.size === 1) {
      start = p;
      last = { x: p.x, y: p.y, t: performance.now() };
      drag = false;
      vTheta = 0;
      vPhi = 0;
    } else if (down.size === 2) {
      const [a, b] = [...down.values()];
      if (a && b) pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: zoomTo };
      drag = true;
    }
    touch();
  }

  function onMove(e: PointerEvent) {
    const p = local(e);
    inside = true;
    if (!down.has(e.pointerId)) {
      lastInput = clock;
      opts.onHover(p.x, p.y);
      return;
    }
    down.set(e.pointerId, p);
    if (down.size >= 2) {
      const [a, b] = [...down.values()];
      if (a && b) {
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoomTo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.zoom - Math.log(d / pinch.d)));
        uses++;
      }
      touch();
      return;
    }
    if (!drag && Math.hypot(p.x - start.x, p.y - start.y) > TAP) {
      drag = true;
      uses++;
      el.setPointerCapture?.(e.pointerId);
      opts.onLeave();
    }
    if (drag) {
      const now = performance.now();
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const dt = Math.max((now - last.t) / 1000, 1 / 240);
      offset.theta -= dx * TURN;
      offset.phi = clampPhi(offset.phi - dy * TURN);
      // a short memory of the speed, for the coast after release
      vTheta = vTheta * 0.6 + ((-dx * TURN) / dt) * 0.4;
      vPhi = vPhi * 0.6 + ((-dy * TURN) / dt) * 0.4;
      last = { x: p.x, y: p.y, t: now };
      touch();
    }
  }

  function onUp(e: PointerEvent) {
    if (!down.has(e.pointerId)) return;
    const p = local(e);
    const wasDrag = drag;
    const single = down.size === 1;
    down.delete(e.pointerId);
    if (
      e.type === "pointerup" &&
      single &&
      !wasDrag &&
      Math.hypot(p.x - start.x, p.y - start.y) <= TAP
    )
      opts.onTap(p.x, p.y);
    if (down.size === 0) {
      drag = false;
      // a release after a pause does not coast
      if (performance.now() - last.t > 80) {
        vTheta = 0;
        vPhi = 0;
      }
    } else if (down.size === 1) {
      const [rest] = [...down.values()];
      if (rest) last = { x: rest.x, y: rest.y, t: performance.now() };
    }
    touch();
  }

  function onLeave() {
    inside = false;
    leftAt = clock;
    if (!down.size) opts.onLeave();
    opts.onChange();
  }

  function onWheel(e: WheelEvent) {
    // A pinch on a trackpad arrives as a wheel with ctrlKey; a plain wheel zooms only where the
    // scene is the stage, never where the page scrolls past it.
    if (!e.ctrlKey && !e.metaKey && !opts.wheelZooms()) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const k = e.ctrlKey ? 0.01 : 0.0016;
    zoomTo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTo + e.deltaY * unit * k));
    uses++;
    touch();
  }

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("wheel", onWheel, { passive: false });

  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  return {
    offset,
    step(dt, reduced) {
      clock += dt;
      let moving = drag || down.size > 0;
      if (!drag && !reduced && (Math.abs(vTheta) > 1e-3 || Math.abs(vPhi) > 1e-3)) {
        offset.theta += vTheta * dt;
        offset.phi = clampPhi(offset.phi + vPhi * dt);
        const f = Math.exp(-dt * 4.5);
        vTheta *= f;
        vPhi *= f;
        moving = true;
      } else if (!drag) {
        vTheta = 0;
        vPhi = 0;
      }
      const z = zoomTo - offset.zoom;
      if (Math.abs(z) > 1e-4) {
        offset.zoom = reduced ? zoomTo : offset.zoom + z * (1 - Math.exp(-dt * 9));
        moving = true;
      } else offset.zoom = zoomTo;
      // Home: once the pointer has left or gone still, ease the offsets back to the framing.
      const away =
        !down.size &&
        ((!inside && clock - leftAt > HOME_AFTER_LEAVE) || clock - lastInput > HOME_AFTER_STILL);
      const off = Math.abs(offset.theta) + Math.abs(offset.phi) + Math.abs(zoomTo);
      if (off > 1e-4) {
        if (away && !reduced) {
          offset.theta = wrap(offset.theta);
          const f = Math.exp(-dt * 1.35);
          offset.theta *= f;
          offset.phi *= f;
          zoomTo *= Math.exp(-dt * 1.1);
          if (Math.abs(offset.theta) + Math.abs(offset.phi) + Math.abs(zoomTo) < 1e-3) {
            offset.theta = 0;
            offset.phi = 0;
            zoomTo = 0;
          }
        }
        // While away from home, keep drawing so the return can begin on time.
        if (!reduced) moving = true;
      }
      return moving;
    },
    setBase(phi, phiMin, phiMax) {
      base = { phi, min: phiMin, max: phiMax };
      offset.phi = clampPhi(offset.phi);
    },
    reset() {
      offset.theta = 0;
      offset.phi = 0;
      offset.zoom = 0;
      zoomTo = 0;
      vTheta = 0;
      vPhi = 0;
    },
    dragging: () => drag,
    used: () => uses,
    dispose() {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
    },
  };
}
