/**
 * Drives the 3D scene (web/components/scene/) and exits 1 on any failed check:
 *   - it starts (data-mode="ready") and is hidden from assistive technology
 *   - the same canvas survives a client navigation (the scene never remounts)
 *   - hovering a cluster shows a tooltip and clicking it opens that view
 *   - the admin hides it
 *   - on a phone it stops drawing when scrolled out of view, and starts again on return
 *   - without WebGL it shows the still drawing, with no page error
 *
 *   node .claude/skills/verify/scenecheck.ts [OUT_DIR] [BASE_URL]
 *     default OUT_DIR: no screenshots; default BASE_URL http://localhost:3721
 *
 * In `next dev`, open a route the server has not compiled yet through about:blank, or Playwright
 * can report "navigation interrupted" while HMR touches the page's history.
 */
import fs from "node:fs";
import { chromium, type Page } from "playwright-core";

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

const gl = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
try {
  const ctx = await gl.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/`);
  await p.waitForSelector("[data-mode='ready'] canvas", { timeout: 60_000 });
  check(
    await p.evaluate(() => document.querySelector("[data-mode]")?.getAttribute("aria-hidden") === "true"),
    "the scene starts and is aria-hidden",
  );
  await p.waitForTimeout(2500);
  await shot(p, "scene-home");

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
  await shot(p, "scene-topic");

  // Sweep the free area right of the dock for something to hover.
  let found: { x: number; y: number } | null = null;
  sweep: for (let y = 160; y < 820; y += 14)
    for (let x = 680; x < 1420; x += 14) {
      await p.mouse.move(x, y);
      const tip = await p.evaluate(
        () => document.querySelector('[class*="tooltip"]')?.textContent ?? null,
      );
      if (tip) {
        found = { x, y };
        break sweep;
      }
    }
  check(found !== null, "hovering the scene shows a tooltip");
  if (found) {
    const before = p.url();
    await p.mouse.click(found.x, found.y);
    await p.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }).catch(() => {});
    check(p.url() !== before, `clicking it opens ${p.url().replace(base, "")}`);
  }

  await p.goto("about:blank");
  await p.goto(`${base}/admin/login`, { timeout: 120_000 });
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

  // On a phone the scene is a band at the top: scrolled away, it should stop asking for frames.
  const phone = await gl.newContext({ viewport: { width: 390, height: 844 } });
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
  await pp.goto(`${base}/`);
  await pp.waitForSelector("[data-mode='ready'] canvas", { timeout: 60_000 });
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
  const back = await perSecond();
  check(
    away <= 2 && back > away,
    `phone frames per second: in view ${top}, scrolled away ${away}, back ${back}`,
  );
  await phone.close();
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
  await p.goto(`${base}/`);
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
