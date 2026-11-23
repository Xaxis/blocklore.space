// Drives reader reports end to end against a dev site: a reader files a report on a claim page, a
// note holding a seed phrase is refused without being repeated, the brain pulls the report and
// rechecks the claim (`brain reports run --no-commit`, sources read fresh), and the outcome shows on
// the claim page and in the corrections view; then the owner sees the note in the admin and
// dismisses the report as abuse, and the public record says so. With OUT_DIR it writes the claim's
// reports, the corrections view and the admin at desk and phone sizes, light and dark.
//
//   node .claude/skills/verify/reportcheck.ts OUT_DIR [BASE_URL] [CLAIM_ID]
//
// The dev site needs web/.env.development.local with CONTROL_KEY and QUEUE_PULL_TOKEN (throwaway
// values; see features/reports.md). The recheck rewrites the claim's last_verified and writes a run
// log under knowledge/runs: restore them afterwards with git (the script prints the paths).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const [out, base = "http://localhost:3721", id = "halvings-and-supply.first-halving"] =
  process.argv.slice(2);
if (!out) {
  console.error("usage: node .claude/skills/verify/reportcheck.ts OUT_DIR [BASE_URL] [CLAIM_ID]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, "../../..");
// The brain reads the dev site's throwaway keys from the file; nothing reaches a command line.
const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
for (const line of fs
  .readFileSync(path.join(root, "web/.env.development.local"), "utf8")
  .split("\n")) {
  const m = /^(CONTROL_KEY|QUEUE_PULL_TOKEN)=(.+)$/.exec(line);
  if (m?.[1] && m[2]) env[m[1]] = m[2];
}
const brain = (...args: string[]) =>
  execFileSync(process.execPath, ["brain/cli.ts", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10 * 60_000,
  });

// Rendered text only: textContent also holds Next's flight data.
const text = (p: Page, s: string, timeout = 60_000) =>
  // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
  p.waitForFunction((t) => document.body.innerText.includes(t), s, { timeout });
const has = (p: Page, s: string) =>
  // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
  p.evaluate((t) => document.body.innerText.includes(t), s);

const SEED =
  "abandon ability able about above absent absorb abstract absurd abuse access accident";
const NOTE = `reportcheck ${Date.now()}: the subsidy height looks off by one`;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const pass = (p: Promise<unknown>, what: string) =>
  p.then(
    () => check(true, what),
    () => check(false, what),
  );

async function shots(name: string, url: string, anchor: string | null, ctx = browser) {
  for (const size of [
    { name: "desk", width: 1280, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ])
    for (const scheme of ["light", "dark"] as const) {
      const page = await ctx.newPage({ viewport: { width: size.width, height: size.height } });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto(base + url, { waitUntil: "networkidle" });
      if (anchor) {
        await page.locator(anchor).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: path.join(out, `${name}-${size.name}-${scheme}.png`) });
      await page.close();
    }
}

try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "X-Forwarded-For": `10.8.${Date.now() % 250}.${process.pid % 250}` },
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/claims/${id}`);
  await pass(text(page, "Reader reports"), "the claim page shows its reader reports");
  await page.getByRole("button", { name: "Report a problem" }).click();
  await page.getByLabel("What is the problem").selectOption("outdated");
  await page.getByLabel("A note for the brain (optional)").fill(`my seed is ${SEED}`);
  await page.getByRole("button", { name: "Send report" }).click();
  await pass(text(page, "looks like a seed phrase"), "a note holding a seed phrase is refused");
  check(!(await has(page, "abandon ability")), "the refusal does not repeat the words");
  await page.getByLabel("A note for the brain (optional)").fill(NOTE);
  await page.getByRole("button", { name: "Send report" }).click();
  await pass(
    page.waitForFunction(
      // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
      () => /Thank you\.|yours now counts too/.test(document.body.innerText),
      null,
      { timeout: 30_000 },
    ),
    "the report is taken",
  );
  await pass(text(page, "Waiting for the brain's next recheck"), "it waits for a recheck");
  check(!(await has(page, NOTE)), "the note is not on the public page");
  if (out) await shots("claim-received", `/claims/${id}`, "#reports");

  const said = brain("reports", "run", "--no-commit", "--limit", "3");
  console.log(said.trim().split("\n").slice(-2).join("\n"));
  check(/rechecked \d+ claim/.test(said), "the brain pulled the report and rechecked the claim");

  await page.goto(`${base}/claims/${id}`);
  await pass(
    page.waitForFunction(
      // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
      () => /Rechecked at block [\d,]+/.test(document.body.innerText),
      null,
      { timeout: 30_000 },
    ),
    "the outcome shows on the claim page",
  );
  check(!(await has(page, NOTE)), "the note is still not on the public page");
  await page.goto(`${base}/changes/corrections`);
  await pass(text(page, "Reader reports"), "the corrections view lists reader reports");
  await pass(
    page.waitForFunction(
      // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
      () => /Rechecked at block [\d,]+/.test(document.body.innerText),
      null,
      { timeout: 30_000 },
    ),
    "and the outcome",
  );
  check(!(await has(page, NOTE)), "the corrections view shows no note");
  if (out) {
    await shots("claim-outcome", `/claims/${id}`, "#reports");
    await shots("corrections", "/changes/corrections", "#reports");
  }

  // The owner: the note, and a dismissal.
  const link = /(https?:\/\/\S+#t=[A-Za-z0-9_-]+)/.exec(brain("admin-link"))?.[1];
  if (!link) throw new Error("admin-link printed no link");
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await owner.newPage();
  await admin.goto(link);
  await admin.getByRole("button", { name: "Sign in", exact: true }).click();
  await admin.waitForURL(`${base}/admin`, { timeout: 30_000 });
  await admin.goto(`${base}/admin/reports`);
  await pass(text(admin, NOTE), "the admin shows the reader's note");
  if (out) {
    for (const size of [
      { name: "desk", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ])
      for (const scheme of ["light", "dark"] as const) {
        const p = await owner.newPage({ viewport: { width: size.width, height: size.height } });
        await p.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await p.goto(`${base}/admin/reports`, { waitUntil: "networkidle" });
        await p.screenshot({ path: path.join(out, `admin-${size.name}-${scheme}.png`) });
        await p.close();
      }
  }
  const row = admin.getByRole("listitem").filter({ hasText: NOTE });
  await row.getByRole("button", { name: "Dismiss as abuse" }).click();
  await pass(
    row.getByRole("button", { name: "Restore and recheck" }).waitFor({ timeout: 30_000 }),
    "the owner dismissed it",
  );
  await page.goto(`${base}/claims/${id}`);
  await pass(text(page, "Dismissed by the owner as abuse"), "the public record says dismissed");
  const later = brain("reports", "pull");
  check(/Dismissed as abuse/.test(later), "the brain's next pull sees the dismissal");
} finally {
  await browser.close();
}
console.log(
  `restore with: git checkout -- knowledge/claims knowledge/rechecks.json && git clean -n knowledge/runs`,
);
process.exit(failed ? 1 : 0);
