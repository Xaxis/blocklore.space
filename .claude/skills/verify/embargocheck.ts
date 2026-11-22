// Drives the admin's Security embargo page against a dev daemon whose BLOCKLORE_EMBARGO_DIR holds a
// test finding (never the devbox's real var/embargo): signs in, checks the finding shows with its
// reasons and Bitcoin Core's reporting address, that Release stays off until the owner confirms
// the project published, then dismisses it and waits for the brain to take it out.
//
//   node .claude/skills/verify/embargocheck.ts OUT_DIR [BASE_URL]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const [out, base = "http://localhost:3721"] = process.argv.slice(2);
if (!out) {
  console.error("usage: node .claude/skills/verify/embargocheck.ts OUT_DIR [BASE_URL]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, "../../..");
const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
for (const line of fs.readFileSync(path.join(root, "web/.env.development.local"), "utf8").split("\n")) {
  const m = /^(CONTROL_KEY)=(.+)$/.exec(line);
  if (m?.[1] && m[2]) env[m[1]] = m[2];
}
const said = execFileSync(process.execPath, ["brain/cli.ts", "admin-link"], {
  cwd: root,
  env,
  encoding: "utf8",
});
const link = /(https?:\/\/\S+#t=[A-Za-z0-9_-]+)/.exec(said)?.[1];
if (!link) throw new Error("admin-link printed no link");

const text = (p: Page, s: string, timeout = 60_000) =>
  p.waitForFunction((t) => document.body.innerText.includes(t), s, { timeout });
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 30_000 });
  // The daemon sends the embargo on its next sync; reload until it is there.
  let shown = false;
  for (let i = 0; i < 20 && !shown; i++) {
    await page.goto(`${base}/admin/security`);
    shown = !(await page.textContent("body"))?.includes("Nothing is embargoed");
    if (!shown) await page.waitForTimeout(3000);
  }
  check(shown, "the embargoed finding reached the owner's admin");
  const body = (await page.textContent("body")) ?? "";
  check(body.includes("Held because:"), "it says why it was held");
  check(body.includes("security@bitcoincore.org"), "it names Bitcoin Core's reporting address");
  const release = page.getByRole("button", { name: /^Release/ }).first();
  check(await release.isDisabled(), "Release is off until the owner confirms the project published");
  await page.getByLabel("The project has published an advisory or a fix").first().check();
  check(await release.isEnabled(), "and on once confirmed");
  await page.getByLabel("The project has published an advisory or a fix").first().uncheck();
  for (const scheme of ["light", "dark"] as const)
    for (const size of [
      { name: "desk", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.screenshot({
        path: path.join(out, `embargo-${size.name}-${scheme}.png`),
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  await text(page, "dismissed: nothing was published", 90_000).then(
    () => check(true, "the brain dismissed it"),
    () => check(false, "the brain dismissed it"),
  );
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    await page.waitForTimeout(3000);
    await page.goto(`${base}/admin/security`);
    gone = !!(await page.textContent("body"))?.includes("Nothing is embargoed");
  }
  check(gone, "it left the admin");
  await page.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
