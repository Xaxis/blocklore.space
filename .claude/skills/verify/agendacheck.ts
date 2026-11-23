// Drives the admin's agenda in a browser: signs in with a link from `pnpm brain admin-link`, waits
// for the brain's agenda, checks every topic in brain/agenda/proposed.yaml that is not on it yet is
// listed under Proposed, and that "Review and add" opens the new-topic form filled with that
// proposal. It never submits the form: saving would commit to brain/agenda/seed.yaml.
//
// Run it against a daemon that is paused and syncs to the dev site (features/admin.md):
//   node .claude/skills/verify/agendacheck.ts OUT_DIR [BASE_URL]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { parseProposals } from "../../../core/src/proposals.ts";

const [out, maybeBase] = process.argv.slice(2);
if (!out) {
  console.error("usage: node .claude/skills/verify/agendacheck.ts OUT_DIR [BASE_URL]");
  process.exit(2);
}
const base = maybeBase ?? "http://localhost:3721";
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, "..", "..", "..");

const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
const devEnv = path.join(root, "web/.env.development.local");
if (base.startsWith("http://localhost") && fs.existsSync(devEnv))
  for (const line of fs.readFileSync(devEnv, "utf8").split("\n")) {
    const m = /^(CONTROL_KEY)=(.+)$/.exec(line);
    if (m?.[1] && m[2]) env[m[1]] = m[2];
  }
const said = execFileSync(
  process.execPath,
  ["--env-file-if-exists=.env", "brain/cli.ts", "admin-link"],
  { cwd: root, env, encoding: "utf8" },
);
const link = /(https?:\/\/\S+#t=[A-Za-z0-9_-]+)/.exec(said)?.[1];
if (!link) throw new Error("admin-link printed no link");

const proposals = parseProposals(
  fs.readFileSync(path.join(root, "brain", "agenda", "proposed.yaml"), "utf8"),
);

// Rendered text only: textContent also holds the page's <script> data.
const text = (p: Page, s: string, timeout = 60_000) =>
  // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 30_000 });
  check(true, "signed in");

  await page.goto(`${base}/admin/agenda`);
  await text(page, "Topic", 60_000);
  const listed = await page
    .locator("table tbody tr")
    .count()
    .catch(() => 0);
  check(listed > 0, `the brain's agenda shows ${listed} topics`);
  const onAgenda = await page.locator("table tbody tr").allInnerTexts();
  // A row starts with its topic's title (the scope follows on the next line).
  const titles = new Set(onAgenda.map((row) => row.split("\n")[0]?.trim()));
  const open = proposals.filter((p) => !titles.has(p.title));
  check(proposals.length > 0, `${proposals.length} proposals in brain/agenda/proposed.yaml`);

  if (open.length) {
    await text(page, "Proposed", 30_000);
    const section = page.locator("section[aria-labelledby=proposed-h]");
    for (const p of open)
      check(
        (await section.getByRole("heading", { name: p.title, exact: true }).count()) === 1,
        `proposed: ${p.title}`,
      );
    await page.screenshot({ path: path.join(out, "agenda-proposed.png"), fullPage: true });

    const first = open[0];
    if (first) {
      await section.getByRole("button", { name: "Review and add" }).first().click();
      await text(page, "New topic", 10_000);
      const form = page.locator("form.panel");
      const title = await form.locator("input").first().inputValue();
      const slug = await form.locator("input.mono").first().inputValue();
      const scope = await form.locator("textarea").inputValue();
      check(title === first.title, `the form's title is the proposal's: ${title}`);
      check(slug === first.slug, `the form's slug is the proposal's: ${slug}`);
      check(scope === first.scope, "the form's scope is the proposal's, whole");
      await page.screenshot({ path: path.join(out, "agenda-review.png") });
      await form.getByRole("button", { name: "Cancel" }).click();
      check((await page.locator("form.panel").count()) === 0, "Cancel closes it; nothing was sent");
    }
  } else check(true, "every proposal is already on the agenda; nothing to list");
} finally {
  await browser.close();
}
if (failed) process.exit(1);
console.log("agendacheck passed");
