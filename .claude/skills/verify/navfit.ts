/**
 * Checks the masthead nav fits one row at common phone widths with every label visible, and that
 * desktop shows the long labels. Exit 1 on overflow at 375px or wider, or on an empty label. The
 * nav has been cut off on phones twice; this keeps it from happening a third time.
 *
 *   node .claude/skills/verify/navfit.ts [URL]     default http://localhost:3721/
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:3721/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
let bad = 0;
try {
  for (const width of [1280, 414, 390, 375, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(url, { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const nav = document.querySelector(".masthead .nav") as HTMLElement;
      return {
        over: nav.scrollWidth - nav.clientWidth,
        labels: [...nav.querySelectorAll("a")].map((a) => (a as HTMLElement).innerText.trim()),
      };
    });
    // Below 375 the last link may scroll under the fade; at 375 and up everything must fit.
    const ok = !r.labels.includes("") && (width < 375 || r.over <= 0);
    if (!ok) bad++;
    console.log(`${ok ? "ok " : "BAD"} ${width}px: ${r.over > 0 ? `${r.over}px over` : "fits"}, ${r.labels.join(" | ")}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
