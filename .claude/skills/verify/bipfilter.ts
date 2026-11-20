/**
 * Drives the BIP index's filter in Chromium (SwiftShader): types "taproot", then picks the Deployed
 * status, and checks each shows only matching rows. Exit 1 when a row slips through or none show.
 *
 *   node .claude/skills/verify/bipfilter.ts [URL]     default http://localhost:3721/bips
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:3721/bips";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  const rows = page.locator(".bip-table tbody tr");
  const all = await rows.count();
  console.log(`${all} rows before filtering`);

  await page.getByLabel("Filter BIPs").fill("taproot");
  const titles = await page.locator(".bip-table tbody td.title").allTextContents();
  const layers = await page.locator(".bip-table tbody td.hide-phone.muted").allTextContents();
  const off = titles.filter((t, i) => !`${t} ${layers[i]}`.toLowerCase().includes("taproot"));
  if (!titles.length || off.length || titles.length >= all) bad++;
  console.log(`${titles.length && !off.length ? "ok " : "BAD"} "taproot": ${titles.length} rows: ${titles.join("; ")}`);

  await page.getByLabel("Filter BIPs").fill("");
  await page.getByLabel("Status").selectOption("Deployed");
  const chips = await page.locator(".bip-table tbody .chip").allTextContents();
  const wrong = chips.filter((c) => c !== "Deployed");
  if (!chips.length || wrong.length) bad++;
  console.log(`${chips.length && !wrong.length ? "ok " : "BAD"} Deployed: ${chips.length} rows, ${wrong.length} with another status`);
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
