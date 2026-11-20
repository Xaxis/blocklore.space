/**
 * Drives a topic page's depth dial in Chromium (SwiftShader) and prints, for each stop, the claims
 * the dial says it shows and the claim lines actually visible. Exit 1 when they disagree.
 *
 *   node .claude/skills/verify/dial.ts [URL]     default http://localhost:3721/topics/halvings-and-supply
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:3721/topics/halvings-and-supply";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  for (const stop of ["Curious", "User", "Holder", "Builder", "Researcher"]) {
    await page.getByRole("button", { name: stop, exact: true }).click();
    await page.waitForTimeout(100);
    const label = (await page.locator(".dial-label span").nth(1).textContent()) ?? "";
    const said = Number(label.split(" ")[0]);
    // The lede opens the page and is not repeated in the body, so the body shows one fewer.
    const visible = await page.locator(".claim-line:visible").count();
    const ok = visible === said - 1;
    if (!ok) bad++;
    console.log(`${ok ? "ok " : "BAD"} ${stop.padEnd(10)} dial says "${label}", ${visible} lines visible + the lede, url ${new URL(page.url()).search || "(no query)"}`);
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
