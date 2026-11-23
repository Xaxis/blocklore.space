// Drives the admin's "Advisories and NVD" page (/admin/advisories) in a browser against a dev site
// and a dev daemon run from a scratch clone whose origin is a local bare repository, so every
// commit and push lands only there (features/admin.md). It signs in with a link from
// `pnpm brain admin-link`, then:
//
//   1. files the first advisory to map under a threat, sees the row wait, waits for the brain's
//      job to report done, and reads the commit and the map on the bare repository's main;
//   2. settles the first NVD finding NVD's own pairs can settle, by recording the project, the same;
//   3. undoes the placement from step 1, the same;
//   4. undoes the settlement from step 2, the same, and finds main's map as it was before step 1;
//
// and checks after each that the page moved the row, that the commit is the owner's, and that
// the job's ship did not deploy. It also checks a command for an advisory that is not on the page
// is refused (409), and writes screenshots at desk and phone width in light and dark, checking
// the phone width has no sideways scroll. It leaves the map as it found it, so it can run again.
//
//   node .claude/skills/verify/advisoryadmincheck.ts OUT_DIR BASE_URL BARE_REPO
//
// It refuses any BASE_URL but http://localhost:<port>: it changes the advisory map.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

const [out, base, bare] = process.argv.slice(2);
if (!out || !base || !bare) {
  console.error(
    "usage: node .claude/skills/verify/advisoryadmincheck.ts OUT_DIR BASE_URL BARE_REPO",
  );
  process.exit(2);
}
if (!/^http:\/\/localhost:\d+$/.test(base)) {
  console.error("refused: this check commits to the advisory map; run it only against a dev site");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, "../../..");
const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
for (const line of fs
  .readFileSync(path.join(root, "web/.env.development.local"), "utf8")
  .split("\n")) {
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

const git = (...args: string[]) =>
  execFileSync("git", ["-C", bare, ...args], { encoding: "utf8" }).trim();
const mapOnMain = () => git("show", "main:knowledge/security/advisory-map.yaml");

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const visible = (l: Locator, timeout: number) =>
  l
    .first()
    .waitFor({ state: "visible", timeout })
    .then(
      () => true,
      () => false,
    );

/** Waits for the sent command `label` to end, and returns its badge's words and whether it is done. */
async function result(page: Page, label: string): Promise<{ ok: boolean; text: string }> {
  const row = page.locator('ul[aria-live="polite"] li', { hasText: label }).first();
  const end = row.locator(".badge-ok, .badge-bad");
  await end.waitFor({ state: "visible", timeout: 180_000 });
  return {
    ok: (await end.getAttribute("class"))?.includes("badge-ok") ?? false,
    text: (await end.innerText()).trim(),
  };
}

/** The bare repository's newest commit on main, and the proof that it is the owner's. */
function lastCommit(before: string): { sha: string; author: string; subject: string } {
  const [sha = "", author = "", subject = ""] = git(
    "log",
    "-1",
    "--format=%H%n%an <%ae>%n%s",
    "main",
  ).split("\n");
  check(sha !== before, `a new commit reached the bare repository's main: ${sha.slice(0, 12)}`);
  check(author === "Xaxis <william.neeley@gmail.com>", `its author is the owner: ${author}`);
  console.log(`     subject: ${subject}`);
  return { sha, author, subject };
}

const shoot = async (page: Page, name: string) => {
  for (const scheme of ["light", "dark"] as const)
    for (const size of [
      { name: "desk", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.waitForTimeout(400);
      if (size.name === "phone" && scheme === "light") {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth);
        check(wide <= size.width, `${name}: nothing scrolls sideways at phone width (${wide}px)`);
      }
      await page.screenshot({
        path: path.join(out, `${name}-${size.name}-${scheme}.png`),
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "X-Blocklore-Check": "1" },
  });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 60_000 });
  check(true, "signed in");

  const nav = page.locator("nav.admin-nav").getByRole("link", { name: "Advisories and NVD" });
  check(await visible(nav, 10_000), "the console's nav links Advisories and NVD");
  await nav.click();
  await page.waitForURL(`${base}/admin/advisories`);
  // The daemon sends the map on its next sync; reload until it is there.
  const toMap = page.locator("section[aria-labelledby=tomap-h] article[data-key]");
  let arrived = false;
  for (let i = 0; i < 30 && !arrived; i++) {
    arrived = await visible(toMap, 3000);
    if (!arrived) await page.reload();
  }
  check(arrived, "the brain's advisory map reached the page");
  const header = await page.locator(".page-header .meta").innerText();
  console.log(`     ${header.replace(/\s*\n\s*/g, "; ")}`);
  const findings = page.locator("section[aria-labelledby=findings-h] article[data-cve]");
  check((await toMap.count()) > 0, `${await toMap.count()} advisories to map are listed`);
  check((await findings.count()) > 0, `${await findings.count()} NVD findings are listed`);
  await shoot(page, "advisories-before");

  // A command for something the page did not show is refused before it is signed.
  const refused = await page.evaluate(async () => {
    const res = await fetch("/api/admin/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: { type: "advisory.unassign", advisory: "CVE-2099-0001" } }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  });
  check(
    refused.status === 409 && /not placed CVE-2099-0001/.test(refused.body.error ?? ""),
    `a command for an advisory the page did not show is refused: ${refused.status} ${refused.body.error}`,
  );

  // 1. File the first advisory to map under a threat.
  const original = mapOnMain();
  const key = (await toMap.first().getAttribute("data-key")) ?? "";
  const first = page.locator(`section[aria-labelledby=tomap-h] article[data-key="${key}"]`);
  const title = (await first.locator("h3").innerText()).trim();
  console.log(`     filing ${key}: ${title}`);
  let before = git("rev-parse", "main");
  await first.getByRole("button", { name: "File under threats" }).click();
  const box = first.locator('input[type=checkbox][value="peer-dos"]');
  const threat = (await box.count())
    ? "peer-dos"
    : await first.locator("input[type=checkbox]").first().getAttribute("value");
  await first.locator(`input[type=checkbox][value="${threat}"]`).check();
  await page.screenshot({ path: path.join(out, "advisories-picker.png") });
  await first.getByRole("button", { name: "File under 1 threat" }).click();
  check(
    await visible(first.getByText("Sent: the brain commits it as yours"), 10_000),
    "the row waits for the brain once sent",
  );
  await page.waitForTimeout(300);
  const top = await first.evaluate((el) => el.getBoundingClientRect().top);
  check(
    top >= 0 && top < 900,
    `and stays in view as the picker closes (its top at ${Math.round(top)}px)`,
  );
  await page.screenshot({ path: path.join(out, "advisories-pending.png") });
  const filed = await result(page, `File ${key} under ${threat}`);
  check(filed.ok, `the brain reports the job done: ${filed.text}`);
  check(
    /ship failed: deploy failed: .*no VERCEL_TOKEN/.test(filed.text),
    "its ship pushed to the bare repository and did not deploy (no VERCEL_TOKEN)",
  );
  lastCommit(before);
  const line = mapOnMain()
    .split("\n")
    .find((l) => l.startsWith(`  ${key}:`));
  check(line === `  ${key}: [${threat}]`, `main's advisory-map.yaml says: ${line}`);
  check(
    await visible(page.locator(`section[aria-labelledby=placed-h] li[data-key="${key}"]`), 30_000),
    "the page lists it under Your placements",
  );
  check(
    (await page.locator(`section[aria-labelledby=tomap-h] article[data-key="${key}"]`).count()) ===
      0,
    "and no longer under Advisories to map",
  );

  // 2. Settle the first NVD finding NVD's pairs can settle.
  // Found by its id: once sent, its form (and the button found it by) is gone.
  const cve =
    (await findings
      .filter({ has: page.getByRole("button", { name: "Record it as expected" }) })
      .first()
      .getAttribute("data-cve")) ?? "";
  const settleable = page.locator(`section[aria-labelledby=findings-h] article[data-cve="${cve}"]`);
  const pair =
    (await settleable.locator("input[type=checkbox]").first().getAttribute("value")) ?? "";
  const NAMES: Record<string, string> = {
    "openssl:openssl": "OpenSSL",
    "tukaani:xz": "xz",
    "libbitcoin:libbitcoin_explorer": "Libbitcoin Explorer",
  };
  const name = NAMES[pair] ?? (await settleable.locator("input.input").inputValue());
  console.log(`     settling ${cve}: NVD names ${pair}, recorded as ${name}`);
  before = git("rev-parse", "main");
  await settleable.locator("input.input").fill(name);
  await settleable.getByRole("button", { name: "Record it as expected" }).click();
  check(
    await visible(settleable.getByText("Sent: the brain commits it as yours"), 10_000),
    "the finding waits for the brain once sent",
  );
  const settled = await result(page, `Expect ${name} (${pair}) for ${cve}`);
  check(settled.ok, `the brain reports the job done: ${settled.text}`);
  lastCommit(before);
  const map = mapOnMain();
  check(
    map.includes(`  ${name}:\n    cpe: ["${pair}"]\n    words: []\n    pages: []\n`),
    `main's map has the project ${name} claiming ${pair}`,
  );
  check(map.includes(`  ${cve}: [${name}]`), `and expects ${name} for ${cve}`);
  const done = page.locator(`section[aria-labelledby=expected-h] li[data-cve="${cve}"]`);
  check(await visible(done, 30_000), "the page lists it under Settled by you");
  check((await done.innerText()).includes("Matches now"), "and says NVD's record matches now");
  check(
    (await page
      .locator(`section[aria-labelledby=findings-h] article[data-cve="${cve}"]`)
      .count()) === 0,
    "and the finding left NVD findings",
  );

  // 3. Undo the placement of step 1.
  before = git("rev-parse", "main");
  const placed = page.locator(`section[aria-labelledby=placed-h] li[data-key="${key}"]`);
  await placed.getByRole("button", { name: "Undo" }).click();
  check(
    await visible(placed.getByText("Sent: the brain commits it as yours"), 10_000),
    "the placement waits for the brain once undone",
  );
  const undone = await result(page, `Undo your placement of ${key}`);
  check(undone.ok, `the brain reports the job done: ${undone.text}`);
  lastCommit(before);
  check(
    !mapOnMain()
      .split("\n")
      .some((l) => l.startsWith(`  ${key}:`)),
    `main's advisory-map.yaml no longer places ${key}`,
  );
  check(
    await visible(
      page.locator(`section[aria-labelledby=tomap-h] article[data-key="${key}"]`),
      30_000,
    ),
    "the page lists it under Advisories to map again",
  );
  // Every result so far is a sentence or two; the label beside it must stay readable.
  const labels = await page
    .locator('ul[aria-live="polite"] li > span.small')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  check(
    labels.length === 3 && labels.every((w) => w >= 150),
    `the sent list keeps each label readable beside its result (${labels.join(", ")} px wide)`,
  );
  await shoot(page, "advisories-after");

  // 4. Undo the settlement of step 2.
  before = git("rev-parse", "main");
  await done.getByRole("button", { name: "Undo" }).click();
  check(
    await visible(done.getByText("Sent: the brain commits it as yours"), 10_000),
    "the settlement waits for the brain once undone",
  );
  const unsettled = await result(page, `Undo what you settled for ${cve}`);
  check(unsettled.ok, `the brain reports the job done: ${unsettled.text}`);
  lastCommit(before);
  check(
    mapOnMain() === original,
    "main's advisory-map.yaml is again, byte for byte, what it was before step 1",
  );
  check(
    await visible(
      page.locator(`section[aria-labelledby=findings-h] article[data-cve="${cve}"]`),
      30_000,
    ),
    `the page lists ${cve} under NVD findings again`,
  );
  await page.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);
} finally {
  await browser.close();
}
console.log(failed ? "advisoryadmincheck FAILED" : "advisoryadmincheck passed");
process.exit(failed ? 1 : 0);
