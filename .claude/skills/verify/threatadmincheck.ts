// Drives the admin's "Threat map" page (/admin/threats) in a browser against a dev site and a dev
// daemon run from a scratch clone whose origin is a local bare repository, so every commit and push
// lands only there (features/admin.md). It signs in with a link from `pnpm brain admin-link`, then:
//
//   1. checks every threat on main is listed, by layer in the map's order, those with a gap first;
//   2. checks commands the page did not offer are refused (409 for a threat the map does not have,
//      a claim that is not published, a claim the threat already lists, an unlink of one it does not);
//   3. links the first suggestion of the first threat that has one as "what it is", sees the row say
//      "Sent", the brain report the job done, one owner-authored commit on the bare repository's main
//      that changes that threat's `claims:` line and nothing else, and the claim listed and no longer
//      suggested; then unlinks it, the same, and finds main's file byte for byte as it was;
//   4. links another published claim by its id as "what defends against it" from the field, then
//      unlinks it, the same;
//   5. runs axe-core on the page (desk and phone, light and dark) before and after, and writes
//      screenshots, checking the phone width has no sideways scroll.
//
//   node .claude/skills/verify/threatadmincheck.ts OUT_DIR BASE_URL BARE_REPO CLONE
//
// It refuses any BASE_URL but http://localhost:<port>, and a CLONE whose origin is not BARE_REPO:
// it commits to the threat map there. The dev keys come from web/.env.development.local, or from
// the file BLOCKLORE_DEV_ENV names (a worktree has none of its own); they never reach a command line.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

const [out, base, bare, clone] = process.argv.slice(2);
if (!out || !base || !bare || !clone) {
  console.error(
    "usage: node .claude/skills/verify/threatadmincheck.ts OUT_DIR BASE_URL BARE_REPO CLONE",
  );
  process.exit(2);
}
if (!/^http:\/\/localhost:\d+$/.test(base)) {
  console.error("refused: this check commits to the threat map; run it only against a dev site");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "../../..");
const origin = execFileSync("git", ["-C", clone, "remote", "get-url", "origin"], {
  encoding: "utf8",
}).trim();
if (path.resolve(origin) !== path.resolve(bare) || path.resolve(clone) === root) {
  console.error("refused: CLONE must be a scratch clone whose origin is BARE_REPO");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
const envFile = process.env.BLOCKLORE_DEV_ENV || path.join(root, "web/.env.development.local");
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
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

const DIR = "knowledge/security/threats";
const OWNER = "Xaxis <william.neeley@gmail.com>";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", bare, ...args], { encoding: "utf8" }).trim();
const onMain = (threat: string) => git("show", `main:${DIR}/${threat}.yaml`);
const threatsOnMain = () =>
  git("ls-tree", "--name-only", `main:${DIR}`)
    .split("\n")
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));

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
const gone = (l: Locator, timeout: number) =>
  l
    .first()
    .waitFor({ state: "detached", timeout })
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

/** The one commit main gained since `before`: the owner's, and changing only `file`. */
function oneCommit(before: string, file: string): { added: string[]; removed: string[] } {
  const shas = git("rev-list", `${before}..main`).split("\n").filter(Boolean);
  check(
    shas.length === 1,
    `exactly one new commit reached the bare repository's main (${shas.length})`,
  );
  const sha = shas[0] ?? "";
  const [author = "", subject = ""] = git("log", "-1", "--format=%an <%ae>%n%s", sha).split("\n");
  check(author === OWNER, `its author is the owner: ${author}`);
  console.log(`     ${sha.slice(0, 12)} ${subject}`);
  const files = git("diff", "--name-only", before, sha).split("\n").filter(Boolean);
  check(files.length === 1 && files[0] === file, `it changes only ${file}: ${files.join(", ")}`);
  const diff = git("diff", "--unified=0", before, sha, "--", file).split("\n");
  return {
    added: diff.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)),
    removed: diff.filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1)),
  };
}

const axeSource = fs.readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const SIZES = [
  { name: "desk", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** axe-core's WCAG A and AA rules and best practices, as tools/axe.ts runs them, on this page. */
async function axe(page: Page, when: string) {
  for (const size of SIZES)
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.waitForTimeout(400);
      if (!(await page.evaluate(() => "axe" in globalThis)))
        await page.addScriptTag({ content: axeSource });
      const violations = (await page.evaluate(async () => {
        // biome-ignore lint/suspicious/noExplicitAny: axe is injected as a page global
        const axe = (globalThis as any).axe;
        const r = await axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
          },
        });
        return r.violations.map(
          (v: { id: string; help: string; nodes: { target: string[] }[] }) => ({
            id: v.id,
            help: v.help,
            where: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
          }),
        );
      })) as { id: string; help: string; where: string[] }[];
      check(
        violations.length === 0,
        `axe ${when}, ${size.name} ${scheme}: ${violations.length ? violations.map((v) => `${v.id} (${v.help}) at ${v.where.join("; ")}`).join(" | ") : "no violations"}`,
      );
    }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

const shoot = async (page: Page, name: string) => {
  for (const scheme of ["light", "dark"] as const)
    for (const size of SIZES) {
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

  const nav = page.locator("nav.admin-nav").getByRole("link", { name: "Threat map" });
  check(await visible(nav, 10_000), "the console's nav links Threat map");
  await nav.click();
  await page.waitForURL(`${base}/admin/threats`);
  check((await nav.getAttribute("aria-current")) === "page", "and marks it as the current page");
  // The daemon sends the map on its next sync; reload until it is there.
  const rows = page.locator("li[data-threat]");
  let arrived = false;
  for (let i = 0; i < 30 && !arrived; i++) {
    arrived = await visible(rows, 3000);
    if (!arrived) await page.reload();
  }
  check(arrived, "the brain's threat map reached the page");
  console.log(
    `     ${(await page.locator(".page-header .meta").innerText()).replace(/\s*\n\s*/g, "; ")}`,
  );

  // 1. Every threat on main, by layer, gaps first in each.
  const listed = await rows.evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-threat") ?? "",
      gap: el.hasAttribute("data-gap"),
      layer: el.closest("section")?.getAttribute("aria-labelledby") ?? "",
    })),
  );
  const main = threatsOnMain();
  check(
    listed.length === main.length && main.every((id) => listed.some((t) => t.id === id)),
    `every threat on main is listed (${listed.length} rows, ${main.length} files)`,
  );
  const layers = [...new Set(listed.map((t) => t.layer))];
  const ordered = layers.every((l) => {
    const gaps = listed.filter((t) => t.layer === l).map((t) => t.gap);
    return gaps.indexOf(false) === -1 || !gaps.slice(gaps.indexOf(false)).includes(true);
  });
  check(ordered, `in each of the ${layers.length} layers the threats with a gap come first`);

  // The target: the first threat with a suggestion, and its first suggestion.
  const target = rows.filter({ has: page.locator("[data-suggestion]") }).first();
  check(await visible(target, 5000), "a threat has a suggestion to link");
  const T = (await target.getAttribute("data-threat")) ?? "";
  const C =
    (await target.locator("[data-suggestion]").first().getAttribute("data-suggestion")) ?? "";
  const FILE = `${DIR}/${T}.yaml`;
  const original = onMain(T);
  console.log(`     ${T}: suggests ${C}`);

  // 2. Commands the page did not offer are refused before they are signed.
  const post = (cmd: unknown) =>
    page.evaluate(async (c) => {
      const res = await fetch("/api/admin/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: c }),
      });
      return { status: res.status, body: (await res.json()) as { error?: string } };
    }, cmd);
  const refused = async (cmd: Record<string, string>, why: RegExp, what: string) => {
    const r = await post(cmd);
    check(r.status === 409 && why.test(r.body.error ?? ""), `${what}: ${r.status} ${r.body.error}`);
  };
  await refused(
    { type: "threat.link", threat: "no-such-threat", part: "claims", claim: C },
    /no threat no-such-threat/,
    "a threat the map does not have is refused",
  );
  await refused(
    { type: "threat.link", threat: T, part: "claims", claim: "taproot.no-such-claim" },
    /not a published claim/,
    "a claim that is not published is refused",
  );
  await refused(
    { type: "threat.unlink", threat: T, part: "mitigations", claim: C },
    /does not list/,
    "an unlink of a claim the threat does not list is refused",
  );
  const already = await target.locator("[data-part=claims] [data-linked]").first();
  if (await already.count()) {
    const id = (await already.getAttribute("data-linked")) ?? "";
    await refused(
      { type: "threat.link", threat: T, part: "claims", claim: id },
      /already lists/,
      "a claim the threat already lists is refused",
    );
  }
  check(git("show", `main:${FILE}`) === original, "nothing refused reached main");

  await shoot(page, "threats-before");
  await axe(page, "before");

  // 3. Link the suggestion as what it is, then unlink it.
  let before = git("rev-parse", "main");
  await target.getByRole("button", { name: `Link as what it is: ${C} to ${T}` }).click();
  check(
    await visible(target.locator(`[data-suggestion="${C}"]`).getByText("Sent"), 10_000),
    "the suggestion says Sent once linked",
  );
  const linked = await result(page, `Link ${C} to ${T} as what it is`);
  check(linked.ok, `the brain reports the job done: ${linked.text.slice(0, 200)}`);
  check(
    linked.text.startsWith(`Link ${C} to the threat ${T} as what it is, as the owner asked`),
    "its message says the owner asked in the admin",
  );
  check(
    /ship failed: deploy failed: .*no VERCEL_TOKEN/.test(linked.text),
    "its ship pushed to the bare repository and did not deploy (no VERCEL_TOKEN)",
  );
  const linkCommit = oneCommit(before, FILE);
  check(
    linkCommit.added.length === 1 &&
      linkCommit.removed.length === 1 &&
      /^claims: \[/.test(linkCommit.added[0] ?? "") &&
      (linkCommit.added[0] ?? "").endsWith(`${C}]`) &&
      /^claims: \[/.test(linkCommit.removed[0] ?? ""),
    `the commit changes the claims line only, ending in the claim: ${JSON.stringify(linkCommit.added)}`,
  );
  const listedNow = target.locator(`[data-part=claims] [data-linked="${C}"]`);
  check(await visible(listedNow, 30_000), "the claim is listed under What it is");
  check(
    await gone(target.locator(`[data-suggestion="${C}"]`), 30_000),
    "and no longer suggested",
  );
  await page.screenshot({ path: path.join(out, "threats-linked.png") });

  before = git("rev-parse", "main");
  await listedNow.getByRole("button", { name: `Unlink ${C} from ${T}` }).click();
  await listedNow.getByRole("button", { name: "Unlink", exact: true }).click();
  check(await visible(listedNow.getByText("Sent"), 10_000), "the claim says Sent once unlinked");
  const unlinked = await result(page, `Unlink ${C} from ${T}`);
  check(unlinked.ok, `the brain reports the job done: ${unlinked.text.slice(0, 120)}`);
  const unlinkCommit = oneCommit(before, FILE);
  check(
    JSON.stringify(unlinkCommit.added) === JSON.stringify(linkCommit.removed),
    "the commit puts the claims line back",
  );
  check(onMain(T) === original, "main's threat file is byte for byte what it was");
  check(
    await visible(target.locator(`[data-suggestion="${C}"]`), 30_000),
    "and the claim is suggested again",
  );

  // 4. Link another published claim by its id, as what defends against it, then unlink it.
  const field = target.getByLabel("Link another published claim");
  await field.fill("not an id");
  check(
    await target.getByRole("button", { name: "Link", exact: true }).isDisabled(),
    "an id that is not one leaves Link off",
  );
  await field.fill(C);
  await target.getByRole("group", { name: "As" }).getByRole("button", { name: "what defends against it" }).click();
  check(
    !(await target.getByRole("button", { name: "Link", exact: true }).isDisabled()),
    "a published claim and a list turn Link on",
  );
  before = git("rev-parse", "main");
  await target.getByRole("button", { name: "Link", exact: true }).click();
  const byId = await result(page, `Link ${C} to ${T} as what defends against it`);
  check(byId.ok, `the brain reports the job done: ${byId.text.slice(0, 120)}`);
  const byIdCommit = oneCommit(before, FILE);
  check(
    byIdCommit.added.length === 1 &&
      /^mitigations: \[/.test(byIdCommit.added[0] ?? "") &&
      (byIdCommit.added[0] ?? "").endsWith(`${C}]`),
    `the commit changes the mitigations line only: ${JSON.stringify(byIdCommit.added)}`,
  );
  const defense = target.locator(`[data-part=mitigations] [data-linked="${C}"]`);
  check(await visible(defense, 30_000), "the claim is listed under What defends against it");
  before = git("rev-parse", "main");
  await defense.getByRole("button", { name: `Unlink ${C} from ${T}` }).click();
  await defense.getByRole("button", { name: "Unlink", exact: true }).click();
  const back = await result(page, `Unlink ${C} from ${T}`);
  check(back.ok, `the brain reports the job done: ${back.text.slice(0, 120)}`);
  oneCommit(before, FILE);
  check(onMain(T) === original, "restored: main's threat file is byte for byte what it was");
  check(await gone(defense, 30_000), "and the page lists it there no more");

  await shoot(page, "threats-after");
  await axe(page, "after");
  await page.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);
} finally {
  await browser.close();
}
console.log(failed ? "threatadmincheck FAILED" : "threatadmincheck passed");
process.exit(failed ? 1 : 0);
