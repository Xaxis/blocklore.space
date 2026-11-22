"use client";

import type { BrainFeed } from "@blocklore/core/feed";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACTIVITY_WORD, useBrainFeed } from "@/components/brain/feed";
import type { SceneData } from "@/lib/graph";
import type { Engine, Hover, View } from "./engine";
import styles from "./scene.module.css";

// The persistent 3D scene behind every view. It lives in the root layout, so it is created once
// (the first time a public view shows) and flies between views as the path changes. It is drawn
// for pointers only and hidden from assistive technology: every fact it shows is in the panel.

// The modes' pages (web/lib/nav.ts). A small turn per page, so moving between a mode's pages is
// felt but never jumps.
const BRAIN = ["/", "/gaps", "/connect", "/about/api"];
const KNOWLEDGE = ["/topics", "/proposals", "/bips"];
const PROOF = ["/verify", "/verify/keys", "/about"];

const under = (path: string, v: string) =>
  v === "/" ? path === "/" : path === v || path.startsWith(`${v}/`);
/** The most specific page of a list the path is on, or -1. */
const page = (path: string, list: string[]) => {
  let best = -1;
  list.forEach((v, i) => {
    if (under(path, v) && (best < 0 || v.length > (list[best]?.length ?? 0))) best = i;
  });
  return best;
};

export function viewFor(path: string): View | null {
  if (path === "/admin" || path.startsWith("/admin/")) return null;
  const topic = /^\/topics\/([^/]+)/.exec(path);
  if (topic?.[1]) return { kind: "topic", slug: decodeURIComponent(topic[1]) };
  const claim = /^\/claims\/([^/]+)/.exec(path);
  if (claim?.[1]) return { kind: "claim", id: decodeURIComponent(claim[1]) };
  const threat = /^\/security\/([^/]+)/.exec(path);
  if (threat?.[1]) return { kind: "security", threat: decodeURIComponent(threat[1]) };
  if (under(path, "/security")) return { kind: "security" };
  if (/^\/(changes|digest|log|pulse)(\/|$)/.test(path)) return { kind: "timeline" };
  const b = page(path, BRAIN);
  if (b > 0) return { kind: "brain", variant: b };
  if (under(path, "/snapshots")) return { kind: "proof", variant: 0 };
  const p = page(path, PROOF);
  if (p >= 0) return { kind: "proof", variant: p };
  const k = page(path, KNOWLEDGE);
  if (k >= 0) return { kind: "knowledge", variant: k - 1 };
  return { kind: "brain", variant: 0 };
}

const keyOf = (e: { at: string; kind: string; text: string }) => `${e.at}|${e.kind}|${e.text}`;

export function Scene({ data }: { data: SceneData }) {
  const path = usePathname();
  const router = useRouter();
  const view = viewFor(path);
  const hidden = view === null;

  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const teardown = useRef<(() => void) | null>(null);
  const started = useRef(false);
  // Bumped on unmount and on every start: an import that resolves for an older start is dropped,
  // so React's double effects in development never build a second engine.
  const generation = useRef(0);
  const current = useRef(view);
  current.current = view;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const sync = useRef<() => void>(() => {});
  const [mode, setMode] = useState<"loading" | "ready" | "fallback">("loading");
  const [hover, setHover] = useState<Hover | null>(null);
  const [used, setUsed] = useState(false);
  const [store, setStore] = useState(data);
  // The brain's live feed, shared with the panel; in development the fixture's, when asked for.
  const brain = useBrainFeed();
  const [devFeed, setDevFeed] = useState<BrainFeed | undefined>(undefined);
  const live = devFeed ?? brain.feed ?? undefined;
  // A copy over five minutes old means the brain is offline: the scene rests.
  const stale = !devFeed && !brain.online;

  // Dispose only when the layout itself goes away.
  useEffect(() => {
    return () => {
      generation.current++;
      teardown.current?.();
      teardown.current = null;
      engine.current = null;
      started.current = false;
    };
  }, []);

  // Create the engine the first time a public view shows; three loads only then.
  useEffect(() => {
    if (hidden || started.current) return;
    started.current = true;
    const mine = ++generation.current;
    const el = box.current;
    const st = stage.current;
    const ov = overlay.current;
    if (!el || !st || !ov) return;
    const reducedQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkQ = window.matchMedia("(prefers-color-scheme: dark)");
    let stopFixture: (() => void) | undefined;
    const load = async () => {
      let sceneData = data;
      // ?scene=fixture adds placeholder layers and replays a script of events; fixture-data
      // adds only the layers, so a check can send its own events and count them.
      const ask =
        process.env.NODE_ENV !== "production"
          ? new URLSearchParams(window.location.search).get("scene")
          : null;
      if (process.env.NODE_ENV !== "production" && ask?.startsWith("fixture")) {
        const fx = await import("./fixture");
        sceneData = fx.withFixture(data);
        if (ask === "fixture") stopFixture = fx.replay(sceneData, setDevFeed);
      }
      const mod = await import("./engine");
      return { mod, sceneData };
    };
    load()
      .then(({ mod, sceneData }) => {
        if (mine !== generation.current) {
          stopFixture?.();
          return;
        }
        const e = mod.createEngine(st, ov, sceneData, {
          reduced: reducedQ.matches,
          dark: darkQ.matches,
          classes: {
            label: styles.label ?? "",
            topic: styles.topic ?? "",
            block: styles.block ?? "",
            tip: styles.tip ?? "",
            on: styles.on ?? "",
            stratum: styles.stratum ?? "",
            active: styles.active ?? "",
            threat: styles.threat ?? "",
          },
          onHover: setHover,
          onPick: (href) => router.push(href),
          onUse: () => setUsed(true),
        });
        if (!e) {
          stopFixture?.();
          setMode("fallback");
          return;
        }
        engine.current = e;
        setStore(sceneData);
        if (process.env.NODE_ENV !== "production")
          (window as unknown as { __scene?: Engine }).__scene = e;
        const measure = () => {
          const r = st.getBoundingClientRect();
          e.resize(r.width, r.height, probe.current?.getBoundingClientRect().width ?? 0);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(st);
        if (probe.current) ro.observe(probe.current);
        let onScreen = true;
        let visible = document.visibilityState === "visible";
        sync.current = () => e.setActive(onScreen && visible && !hiddenRef.current);
        const io = new IntersectionObserver((entries) => {
          onScreen = entries.some((x) => x.isIntersecting);
          sync.current();
        });
        io.observe(el);
        const onVis = () => {
          visible = document.visibilityState === "visible";
          sync.current();
        };
        const onReduced = () => e.setReduced(reducedQ.matches);
        const onDark = () => e.setTheme(darkQ.matches);
        document.addEventListener("visibilitychange", onVis);
        reducedQ.addEventListener("change", onReduced);
        darkQ.addEventListener("change", onDark);
        if (current.current) e.setView(current.current);
        setMode("ready");
        teardown.current = () => {
          stopFixture?.();
          ro.disconnect();
          io.disconnect();
          document.removeEventListener("visibilitychange", onVis);
          reducedQ.removeEventListener("change", onReduced);
          darkQ.removeEventListener("change", onDark);
          e.dispose();
        };
      })
      .catch(() => {
        stopFixture?.();
        setMode("fallback");
      });
  }, [hidden, data, router]);

  // Follow the path: fly to the new view, or rest while an admin page shows.
  const key = view ? JSON.stringify(view) : "hidden";
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the view
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (current.current) e.setView(current.current);
    sync.current();
    setHover(null);
  }, [key]);

  // The brain's feed: `now` sets the scene's continuous state, and each event that is new since
  // the last copy plays once, oldest first. The first copy plays only its newest event, and only
  // when it is recent; a stale feed (the brain is offline) rests the scene.
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  useEffect(() => {
    const e = engine.current;
    if (!e || mode !== "ready" || !live) return;
    e.setAmbient(
      stale
        ? { kind: "paused" }
        : { kind: live.now.kind, ...(live.now.topic ? { topic: live.now.topic } : {}) },
    );
    const fresh = live.events.filter((x) => !seen.current.has(keyOf(x)));
    seen.current = new Set(live.events.map(keyOf));
    if (stale) return;
    if (!primed.current) {
      primed.current = true;
      const newest = live.events[0];
      if (newest && Date.parse(live.at) - Date.parse(newest.at) < 120_000) e.signal(newest);
      return;
    }
    for (const x of fresh.reverse()) e.signal(x);
  }, [live, mode, stale]);

  const width = box.current?.clientWidth ?? 0;
  const k = view?.kind;
  const doing = live && !stale && k === "brain" ? live.now : null;
  const doingTopic = doing?.topic ? store.topics.find((t) => t.slug === doing.topic)?.title : null;
  return (
    <div ref={box} className={styles.scene} hidden={hidden} data-mode={mode} aria-hidden="true">
      <div ref={probe} className={styles.probe} />
      <div ref={stage} className={styles.stage} />
      <div ref={overlay} className={styles.overlay} />
      {mode === "fallback" && <Still />}
      {mode === "ready" && (
        <div className={styles.corner}>
          {doing && (
            <p className={styles.doing} data-kind={doing.kind}>
              <span className={styles.pulse} />
              {ACTIVITY_WORD[doing.kind]}
              {doingTopic ? <span className={styles.doingTopic}>{doingTopic}</span> : null}
            </p>
          )}
          {k && <Legend kind={k} data={store} />}
          <p className={styles.hint} data-used={used || undefined}>
            <span className={styles.hintFine}>Drag to turn, scroll to zoom</span>
            <span className={styles.hintTouch}>Swipe sideways to turn, pinch to zoom</span>
          </p>
        </div>
      )}
      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: hover.x > width - 360 ? undefined : hover.x + 14,
            right: hover.x > width - 360 ? width - hover.x + 14 : undefined,
            top: hover.y + 16,
          }}
        >
          <span className={styles.meta}>
            {hover.tone && <span className={styles.swatch} data-tone={hover.tone} />}
            {hover.meta}
          </span>
          {hover.label}
        </div>
      )}
    </div>
  );
}

/** A small key to what the view draws, only where a mark is not obvious. */
function Legend({ kind, data }: { kind: View["kind"]; data: SceneData }) {
  if (kind === "security") {
    if (!data.security.length) return null;
    return (
      <ul className={styles.legend}>
        <li>
          <span className={styles.swatch} data-tone="defended" />
          Defended
        </li>
        <li>
          <span className={styles.swatch} data-tone="watching" />
          Watching
        </li>
        <li>
          <span className={styles.swatch} data-tone="open" />
          Open
        </li>
      </ul>
    );
  }
  if (kind === "proof") {
    const signed = data.snapshots.some((s) => s.signed);
    const pending = data.snapshots.some((s) => !s.anchor);
    return (
      <ul className={styles.legend}>
        <li>
          <span className={styles.keyRing} />
          Snapshot, sealed in its block
        </li>
        {pending && (
          <li>
            <span className={styles.keyRing} data-pending="" />
            Proof pending
          </li>
        )}
        {signed && (
          <li>
            <span className={styles.keySeal} />
            Signed
          </li>
        )}
      </ul>
    );
  }
  if (kind === "knowledge" || kind === "topic" || kind === "claim") {
    const contested = data.claims.some((c) => c.status === "contested");
    return (
      <ul className={styles.legend}>
        <li>
          <span className={styles.keyDot} />
          Claim
        </li>
        <li>
          <span className={styles.keyLine} />
          The block it was last checked at
        </li>
        {contested && (
          <li>
            <span className={styles.keyRing} data-small="" />
            Contested
          </li>
        )}
      </ul>
    );
  }
  return null;
}

/** Without WebGL: the chain as a quiet drawing, no motion and no error. */
function Still() {
  const blocks = Array.from({ length: 14 }, (_, i) => i);
  return (
    <svg
      className={styles.still}
      viewBox="0 0 600 220"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="The chain, drawn as a row of blocks"
    >
      <line x1="20" y1="170" x2="580" y2="170" className={styles.stillLine} />
      {blocks.map((i) => {
        const s = 1 - i * 0.045;
        const x = 60 + i * 36;
        const h = (i % 4 === 0 ? 46 : 22) * s;
        return (
          <rect
            key={i}
            x={x}
            y={170 - h}
            width={22 * s}
            height={h}
            className={i === blocks.length - 1 ? styles.stillTip : styles.stillBlock}
          />
        );
      })}
    </svg>
  );
}
