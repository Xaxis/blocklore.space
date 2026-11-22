/**
 * Drives the 3D scene (web/components/scene/) and exits 1 on any failed check:
 *   - it starts (data-mode="ready") and is hidden from assistive technology
 *   - the same canvas survives a client navigation (the scene never remounts)
 *   - hovering a cluster shows a tooltip and clicking it opens that view
 *   - a drag turns the camera, and with the pointer gone it returns to the view's framing
 *   - the wheel zooms within its limits over the scene, and scrolls the panel over the panel
 *   - every kind of feed event plays without a page error (frame times reported)
 *   - security: threats hover with their status and a click opens /security/<id>
 *   - proof: hovering a snapshot ring names it
 *   - under reduced motion a signal draws a still frame, not an animation
 *   - the admin hides it
 *   - on a phone it stops drawing when scrolled out of view, and starts again on return
 *   - without WebGL it shows the still drawing, with no page error
 * With OUT_DIR it also shoots every view in light and dark at desk and phone sizes.
 *
 *   node .claude/skills/verify/scenecheck.ts [OUT_DIR] [BASE_URL]
 *     default OUT_DIR: no screenshots; default BASE_URL http://localhost:3721
 *
 * Needs `next dev`: the feed and security checks use the development fixture (?scene=fixture)
 * and the engine handle on window.__scene, neither of which exists in a production build.
 * In `next dev`, open a route the server has not compiled yet through about:blank, or Playwright
 * can report "navigation interrupted" while HMR touches the page's history.
 */
import fs from "node:fs";
import { type BrowserContext, chromium, type Page } from "playwright-core";

const out = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3721";
if (out) fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
const shot = async (p: Page, name: string) => {
  if (out) await p.screenshot({ path: `${out}/${name}.png` });
};

interface Probe {
  view: string;
  theta: number;
  phi: number;
  distance: number;
  zoom: number;
  offset: { theta: number; phi: number; zoom: number };
  playing: number;
  frames: number;
  signals: number;
  ambient: string | null;
  threats: number;
}
const probe = (p: Page) =>
  p.evaluate(() => (window as unknown as { __scene: { probe(): Probe } }).__scene.probe());
const ready = (p: Page) => p.waitForSelector("[data-mode='ready'] canvas", { timeout: 120_000 });
const open = async (p: Page, path: string) => {
  await p.goto("about:blank");
  await p.goto(`${base}${path}`, { timeout: 180_000 });
  await ready(p);
};
/** Polls the engine until `ok` holds or `ms` pass; returns the last probe. */
const until = async (p: Page, ok: (x: Probe) => boolean, ms: number) => {
  const end = Date.now() + ms;
  let x = await probe(p);
  while (!ok(x) && Date.now() < end) {
    await p.waitForTimeout(250);
    x = await probe(p);
  }
  return x;
};
/** Moves the pointer over the free area until a tooltip shows; returns where and its text. */
async function sweep(
  p: Page,
  want: (text: string) => boolean,
  links = false,
  area = { x0: 660, x1: 1420 },
) {
  for (let y = 120; y < 860; y += 12)
    for (let x = area.x0; x < area.x1; x += 12) {
      await p.mouse.move(x, y);
      const r = await p.evaluate(() => ({
        tip: document.querySelector('[class*="tooltip"]')?.textContent ?? null,
        pointer: document.querySelector("canvas")?.style.cursor === "pointer",
      }));
      if (r.tip && want(r.tip) && (!links || r.pointer)) return { x, y, tip: r.tip };
    }
  return null;
}
/** Frame intervals over `ms`, measured in the page. */
const frameTimes = (p: Page, ms: number) =>
  p.evaluate(
    (ms) =>
      new Promise<{ median: number; p95: number; n: number }>((r) => {
        const d: number[] = [];
        let last = 0;
        const end = performance.now() + ms;
        const f = (t: number) => {
          if (last) d.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(f);
          else {
            d.sort((a, b) => a - b);
            r({
              median: Math.round(d[Math.floor(d.length / 2)] ?? 0),
              p95: Math.round(d[Math.floor(d.length * 0.95)] ?? 0),
              n: d.length,
            });
          }
        };
        requestAnimationFrame(f);
      }),
    ms,
  );

const gl = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
try {
  const ctx = await gl.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/`, { timeout: 180_000 });
  await ready(p);
  check(
    await p.evaluate(
      () => document.querySelector("[data-mode]")?.getAttribute("aria-hidden") === "true",
    ),
    "the scene starts and is aria-hidden",
  );
  check((await probe(p)).view === "brain", "the landing page shows the brain view");
  await p.waitForTimeout(2500);

  await p.evaluate(() => {
    const c = document.querySelector("canvas");
    if (c) c.dataset.mark = "first";
  });
  const link = p.locator('main a[href^="/topics/"]').first();
  const href = (await link.getAttribute("href")) ?? "";
  await link.click();
  await p.waitForURL(`${base}${href}`);
  await p.waitForTimeout(1600);
  check(
    await p.evaluate(
      () =>
        document.querySelectorAll("canvas").length === 1 &&
        document.querySelector("canvas")?.dataset.mark === "first",
    ),
    `one canvas, the same one, after a client navigation to ${href}`,
  );
  check((await probe(p)).view === "topic", "a topic page shows the topic view");

  const found = await sweep(p, () => true, true);
  check(found !== null, `hovering the scene shows a tooltip${found ? `: ${found.tip.slice(0, 60)}` : ""}`);
  if (found) {
    const before = p.url();
    await p.mouse.click(found.x, found.y);
    await p.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }).catch(() => {});
    check(p.url() !== before, `clicking it opens ${p.url().replace(base, "")}`);
  }

  // Orbit: a drag over the free area turns the camera; with the pointer on the panel, it returns.
  await open(p, "/topics");
  await p.waitForTimeout(2200);
  const home = await probe(p);
  check(home.view === "knowledge", "/topics shows the knowledge view");
  await p.mouse.move(1150, 520);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(1150 + i * 22, 520 - i * 4);
  await p.mouse.up();
  const turned = await until(p, (x) => Math.abs(x.offset.theta) > 0.5, 3000);
  check(
    Math.abs(turned.offset.theta) > 0.5 && Math.abs(wrap(turned.theta - home.theta)) > 0.4,
    `a drag turns the camera: offset ${turned.offset.theta.toFixed(2)} rad, azimuth ${home.theta.toFixed(2)} to ${turned.theta.toFixed(2)}`,
  );
  check(p.url().endsWith("/topics"), "a drag that ends over a node does not navigate");
  await p.mouse.move(200, 400);
  const back = await until(p, (x) => Math.abs(x.offset.theta) < 0.03, 30_000);
  check(
    Math.abs(back.offset.theta) < 0.03 && Math.abs(wrap(back.theta - home.theta)) < 0.25,
    `with the pointer gone it returns to the framing: offset ${back.offset.theta.toFixed(3)} rad`,
  );

  // Zoom: the wheel over the scene zooms in and out within limits and never scrolls the page.
  await p.mouse.move(1150, 520);
  for (let i = 0; i < 12; i++) await p.mouse.wheel(0, -500);
  const near = await until(p, (x) => x.offset.zoom < -1, 6000);
  for (let i = 0; i < 20; i++) await p.mouse.wheel(0, 500);
  const far = await until(p, (x) => x.offset.zoom > 0.69, 6000);
  const scrolled = await p.evaluate(() => window.scrollY);
  check(
    near.offset.zoom >= -1.06 &&
      near.offset.zoom < -1 &&
      far.offset.zoom <= 0.71 &&
      far.offset.zoom > 0.69 &&
      near.distance < far.distance &&
      scrolled === 0,
    `the wheel zooms within limits: ${near.offset.zoom.toFixed(2)} (${near.distance.toFixed(1)} units) to ${far.offset.zoom.toFixed(2)} (${far.distance.toFixed(1)}), page scroll ${scrolled}`,
  );
  const dockBefore = await p.evaluate(() => document.querySelector(".dock")?.scrollTop ?? 0);
  const zBefore = (await probe(p)).offset.zoom;
  await p.mouse.move(300, 500);
  for (let i = 0; i < 4; i++) await p.mouse.wheel(0, 300);
  await p.waitForTimeout(500);
  const dockAfter = await p.evaluate(() => document.querySelector(".dock")?.scrollTop ?? 0);
  check(
    dockAfter > dockBefore && Math.abs((await probe(p)).offset.zoom - zBefore) < 0.2,
    `the wheel over the panel scrolls the panel (${dockBefore} to ${dockAfter}) and does not zoom`,
  );

  // The feed: the fixture plays a script; then every kind of event, by hand.
  await open(p, "/?scene=fixture");
  const fed = await until(p, (x) => x.ambient !== null && x.signals > 0, 20_000);
  check(
    fed.ambient !== null && fed.signals > 0,
    `the fixture's feed sets the brain's state (${fed.ambient}) and plays events (${fed.signals})`,
  );
  const topic = (await (await fetch(`${base}/api/v1/topics/segwit`)).json()) as {
    topic: { sections: { claims: { id: string }[] }[] };
  };
  const ids = topic.topic.sections.flatMap((s) => s.claims.map((c) => c.id)).slice(0, 6);
  const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const kinds = [
    { kind: "ingest", text: "t" },
    { kind: "research", text: "t", topic: "segwit" },
    { kind: "verify", text: "t", topic: "segwit", claims: ids.slice(0, 2) },
    { kind: "evaluate", text: "t", claims: ids.slice(0, 3), outcome: "ok" },
    { kind: "publish", text: "t", topic: "segwit", claims: [ids[0], "segwit.not-yet-deployed"] },
    { kind: "recheck", text: "t", claims: ids, outcome: "ok" },
    { kind: "watch", text: "t", threat: "bgp-partition" },
    { kind: "lab", text: "t", threat: "eclipse", outcome: "ok" },
    { kind: "snapshot", text: "t" },
    { kind: "idle", text: "t" },
    { kind: "paused", text: "t" },
  ].map((e) => ({ at, ...e }));
  await open(p, "/?scene=fixture-data");
  await p.waitForTimeout(1500);
  const s0 = await probe(p);
  await p.evaluate((events) => {
    const s = (window as unknown as { __scene: { signal(e: unknown): void } }).__scene;
    for (const e of events) s.signal(e);
  }, kinds);
  const playing = await until(p, (x) => x.signals >= s0.signals + kinds.length, 30_000);
  const ft = await frameTimes(p, 3000);
  await shot(p, "scene-signals");
  check(
    playing.signals === s0.signals + kinds.length && errors.length === 0,
    `all ${kinds.length} kinds of feed event play (${playing.signals - s0.signals} started), ${errors.length} page errors`,
  );
  console.log(`info frame interval while events play: median ${ft.median} ms, p95 ${ft.p95} ms over ${ft.n} frames`);

  // Security: the strata and their threats, from the fixture until the security watch lands.
  await open(p, "/security?scene=fixture");
  await p.waitForTimeout(2500);
  const sec = await probe(p);
  check(sec.view === "security" && sec.threats > 0, `/security shows the security view with ${sec.threats} threats`);
  const threat = await sweep(p, (t) => /(defended|watching|open)/.test(t));
  check(threat !== null, `hovering a threat names it with its status${threat ? `: ${threat.tip.slice(0, 70)}` : ""}`);
  if (threat) {
    await p.mouse.click(threat.x, threat.y);
    await p.waitForURL(/\/security\/[^/?]+/, { timeout: 15_000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const focused = await probe(p);
    check(
      /\/security\/[a-z0-9-]+/.test(p.url()) && focused.view === "security",
      `clicking it opens ${p.url().replace(base, "")} and the camera flies to it`,
    );
    await shot(p, "scene-security-threat");
  }

  // Proof, on the real store: snapshot rings locked to their blocks, signed ones sealed.
  await open(p, "/verify");
  await p.waitForTimeout(2500);
  check((await probe(p)).view === "proof", "/verify shows the proof view");
  const ring = await sweep(p, (t) => t.includes("Snapshot"), true);
  check(ring !== null, `hovering a snapshot ring names it${ring ? `: ${ring.tip.slice(0, 90)}` : ""}`);
  await shot(p, "scene-proof");
  await open(p, "/verify/keys");
  check((await probe(p)).view === "proof", "/verify/keys shows the proof view");

  await p.goto("about:blank");
  await p.goto(`${base}/admin/login`, { timeout: 180_000 });
  await p.waitForTimeout(800);
  check(
    await p.evaluate(() => {
      const c = document.querySelector("canvas");
      return !c || c.offsetParent === null;
    }),
    "the admin hides the scene",
  );
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ""}`);
  await ctx.close();

  // Reduced motion: a signal settles into a still frame; the scene does not keep drawing.
  const still = await gl.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const sp = await still.newPage();
  const stillErrors: string[] = [];
  sp.on("pageerror", (e) => stillErrors.push(e.message));
  await open(sp, "/topics");
  await sp.waitForTimeout(1500);
  const r0 = await probe(sp);
  await sp.evaluate((events) => {
    const s = (window as unknown as { __scene: { signal(e: unknown): void } }).__scene;
    for (const e of events) s.signal(e);
  }, kinds);
  await sp.waitForTimeout(2000);
  const r1 = await probe(sp);
  check(
    r1.signals >= r0.signals + kinds.length && r1.frames - r0.frames < 30 && stillErrors.length === 0,
    `under reduced motion the events settle in ${r1.frames - r0.frames} frames, not an animation`,
  );
  await still.close();

  // On a phone the scene is a band at the top: scrolled away, it should stop asking for frames.
  const phone = await gl.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    window.requestAnimationFrame = (cb) => {
      w.__raf++;
      return raf(cb);
    };
  });
  const pp = await phone.newPage();
  await pp.goto(`${base}/`, { timeout: 180_000 });
  await ready(pp);
  await pp.waitForTimeout(2500);
  const perSecond = () =>
    pp.evaluate(
      () =>
        new Promise<number>((r) => {
          const w = window as unknown as { __raf: number };
          const a = w.__raf;
          setTimeout(() => r(w.__raf - a), 1000);
        }),
    );
  const top = await perSecond();
  await pp.evaluate(() => window.scrollTo(0, 1600));
  await pp.waitForTimeout(600);
  const away = await perSecond();
  await pp.evaluate(() => window.scrollTo(0, 0));
  await pp.waitForTimeout(600);
  const back2 = await perSecond();
  check(
    away <= 2 && back2 > away,
    `phone frames per second: in view ${top}, scrolled away ${away}, back ${back2}`,
  );
  await phone.close();

  if (out) await shoot(gl.newContext.bind(gl));
} finally {
  await gl.close();
}

const flat = await chromium.launch({
  headless: true,
  args: ["--disable-webgl", "--disable-3d-apis", "--disable-gpu"],
});
try {
  const p = await flat.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/`, { timeout: 180_000 });
  await p.waitForSelector("[data-mode='fallback']", { timeout: 60_000 }).catch(() => {});
  const r = await p.evaluate(() => ({
    canvas: document.querySelectorAll("canvas").length,
    still: !!document.querySelector('[class*="still"]'),
  }));
  check(
    r.canvas === 0 && r.still && errors.length === 0,
    `without WebGL: the still drawing, no canvas, ${errors.length} page errors`,
  );
  await shot(p, "scene-nowebgl");
} finally {
  await flat.close();
}
process.exit(bad ? 1 : 0);

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Every view, light and dark, desk and phone, with the fixture so the brain is busy. */
async function shoot(make: (o: object) => Promise<BrowserContext>) {
  const views: [string, string][] = [
    ["brain", "/?scene=fixture"],
    ["knowledge", "/topics?scene=fixture"],
    ["proposals", "/proposals?scene=fixture"],
    ["topic", "/topics/segwit?scene=fixture"],
    ["claim", "/claims/lightning.anchor-outputs?scene=fixture"],
    ["timeline", "/changes?scene=fixture"],
    ["security", "/security?scene=fixture"],
    ["threat", "/security/bgp-partition?scene=fixture"],
    ["proof", "/verify?scene=fixture"],
  ];
  for (const [size, viewport] of [
    ["desk", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ] as const)
    for (const scheme of ["light", "dark"] as const) {
      const c = await make({ viewport, colorScheme: scheme });
      const p = await c.newPage();
      for (const [name, path] of views) {
        await open(p, path);
        await p.waitForTimeout(4200);
        await p.screenshot({ path: `${out}/view-${name}-${size}-${scheme}.png` });
      }
      await c.close();
    }
  console.log(`info wrote ${views.length * 4} view screenshots to ${out}`);
}
