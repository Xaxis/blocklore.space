/**
 * Screenshots of the running site, to look at a page the way a reader will before calling it done.
 * Chromium on SwiftShader, never the box's GPU. Run under ~/.claude/claude-core/bin/heavy.
 *
 *   node tools/shots.ts OUT_DIR [BASE_URL] PATH...
 *
 * Each path is shot at desktop and phone widths, in light and dark. A path may end in "!open" to
 * open the first claim on the page before the shot.
 */
import path from "node:path";
import { chromium } from "playwright-core";

const [out, maybeBase, ...rest] = process.argv.slice(2);
if (!out || !maybeBase) {
  console.error("usage: node tools/shots.ts OUT_DIR [BASE_URL] PATH...");
  process.exit(2);
}
const base = maybeBase.startsWith("http") ? maybeBase : "http://localhost:3721";
const paths = maybeBase.startsWith("http") ? rest : [maybeBase, ...rest];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
const sizes = [
  { name: "desk", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
];
let n = 0;
try {
  for (const raw of paths) {
    const open = raw.endsWith("!open");
    const p = open ? raw.slice(0, -5) : raw;
    for (const size of sizes)
      for (const scheme of ["light", "dark"] as const) {
        const page = await browser.newPage({
          viewport: { width: size.width, height: size.height },
        });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        // The box is shared: under load a software-rendered page can take minutes, not seconds.
        page.setDefaultTimeout(180_000);
        const res = await page.goto(base + p, { waitUntil: "networkidle", timeout: 180_000 });
        if (!res?.ok()) console.error(`${p}: HTTP ${res?.status()}`);
        if (open) await page.locator(".claim-line summary").first().click();
        const slug = p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
        const name = `${slug}${open ? "-open" : ""}-${size.name}-${scheme}.png`;
        await page.screenshot({ path: path.join(out, name), fullPage: size.name === "desk" });
        await page.close();
        n++;
      }
  }
} finally {
  await browser.close();
}
console.log(`Wrote ${n} screenshots to ${out}.`);
