"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SceneData } from "@/lib/graph";
import type { Engine, Hover, View } from "./engine";
import styles from "./scene.module.css";

// The persistent 3D scene behind every view. It lives in the root layout, so it is created once
// (the first time a public view shows) and eases between views as the path changes. It is drawn
// for pointers only and hidden from assistive technology: every fact it shows is in the dock.

const OVERVIEWS = ["/proposals", "/bips", "/", "/topics", "/gaps", "/about", "/connect"];

export function viewFor(path: string): View | null {
  if (path === "/admin" || path.startsWith("/admin/")) return null;
  const topic = /^\/topics\/([^/]+)/.exec(path);
  if (topic?.[1]) return { kind: "topic", slug: decodeURIComponent(topic[1]) };
  const claim = /^\/claims\/([^/]+)/.exec(path);
  if (claim?.[1]) return { kind: "claim", id: decodeURIComponent(claim[1]) };
  if (/^\/(changes|digest|log|pulse)(\/|$)/.test(path)) return { kind: "timeline" };
  if (/^\/verify(\/|$)/.test(path)) return { kind: "verify" };
  // A small turn per view, so moving between the overview's views is felt but never jumps.
  const i = OVERVIEWS.findIndex((v) =>
    v === "/" ? path === "/" : path === v || path.startsWith(`${v}/`),
  );
  return { kind: "overview", variant: i < 0 ? 0 : i - 2 };
}

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
    import("./engine")
      .then((mod) => {
        if (mine !== generation.current) return;
        const e = mod.createEngine(st, ov, data, {
          reduced: reducedQ.matches,
          dark: darkQ.matches,
          classes: {
            label: styles.label ?? "",
            topic: styles.topic ?? "",
            block: styles.block ?? "",
            tip: styles.tip ?? "",
            on: styles.on ?? "",
          },
          onHover: setHover,
          onPick: (href) => router.push(href),
        });
        if (!e) {
          setMode("fallback");
          return;
        }
        engine.current = e;
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
          ro.disconnect();
          io.disconnect();
          document.removeEventListener("visibilitychange", onVis);
          reducedQ.removeEventListener("change", onReduced);
          darkQ.removeEventListener("change", onDark);
          e.dispose();
        };
      })
      .catch(() => setMode("fallback"));
  }, [hidden, data, router]);

  // Follow the path: ease to the new view, or rest while an admin page shows.
  const key = view ? JSON.stringify(view) : "hidden";
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the view
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (current.current) e.setView(current.current);
    sync.current();
    setHover(null);
  }, [key]);

  const width = box.current?.clientWidth ?? 0;
  return (
    <div ref={box} className={styles.scene} hidden={hidden} data-mode={mode} aria-hidden="true">
      <div ref={probe} className={styles.probe} />
      <div ref={stage} className={styles.stage} />
      <div ref={overlay} className={styles.overlay} />
      {mode === "fallback" && <Still />}
      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: hover.x > width - 360 ? undefined : hover.x + 14,
            right: hover.x > width - 360 ? width - hover.x + 14 : undefined,
            top: hover.y + 16,
          }}
        >
          <span className={styles.meta}>{hover.meta}</span>
          {hover.label}
        </div>
      )}
    </div>
  );
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
