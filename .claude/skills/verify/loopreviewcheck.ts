// Drives the admin's "Weekly review" page (/admin/loop) in a browser against a dev site and a dev
// daemon run from a scratch clone, with its own control folder (features/admin.md). It signs in
// with a link from `pnpm brain admin-link`, then:
//
//   1. finds the Overview's line about the latest review and follows it to the page, and finds the
//      page in the console's nav;
//   2. waits for the brain's review to reach the page, checks each finding's evidence links point
//      at the admin page that shows them, and that opening the page sent nothing;
//   3. presses the first "Keep this rule as a standing lesson" proposal still open, sees it Sent,
//      waits for the brain to report it done, finds the lesson, word for word the rule's own
//      description, in the scratch daemon's settings.json, and sees the finding say it is done;
//
// and writes screenshots of the page at desk and phone width in light and dark before and after,
// checking nothing scrolls sideways at phone width. It clicks nothing but that one proposal.
//
//   node .claude/skills/verify/loopreviewcheck.ts OUT_DIR BASE_URL CONTROL_DIR
//
// It refuses any BASE_URL but http://localhost:<port>, and a CONTROL_DIR under the devbox's var/.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { EVALUATOR_RULES, type EvaluatorRule } from "../../../core/src/evaluate.ts";
import { ruleLesson } from "../../../core/src/loopreview.ts";

const [out, base, controlDir] = process.argv.slice(2);
if (!out || !base || !controlDir) {
  console.error("usage: node .claude/skills/verify/loopreviewcheck.ts OUT_DIR BASE_URL CONTROL_DIR");
  process.exit(2);
}
if (!/^http:\/\/localhost:\d+$/.test(base)) {
  console.error("refused: this check sends a command; run it only against a dev site");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "../../..");
const control = path.resolve(controlDir);
if (control.startsWith(path.join(root, "var")) || control.includes(`${path.sep}var${path.sep}control`)) {
  console.error("refused: CONTROL_DIR must be a scratch daemon's, never the devbox's var/control");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
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

const lessons = (): { text: string; from: string }[] =>
  JSON.parse(fs.readFileSync(path.join(control, "settings.json"), "utf8")).lessons ?? [];
const results = () => {
  const f = path.join(control, "results.jsonl");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
};

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
  const sentBefore = results().length;

  // 1. The Overview's line, and the nav. The daemon sends the review on its first sync.
  const line = page.locator("p[data-loop-findings]");
  let arrived = false;
  for (let i = 0; i < 30 && !arrived; i++) {
    arrived = await visible(line, 3000);
    if (!arrived) await page.reload();
  }
  check(arrived, "the Overview has a line about the latest weekly review");
  if (arrived) console.log(`     ${(await line.innerText()).trim()}`);
  await page.screenshot({ path: path.join(out, "overview-line.png") });
  const nav = page.locator("nav.admin-nav").getByRole("link", { name: "Weekly review" });
  check(await visible(nav, 5000), "the console's nav links Weekly review");
  await line.getByRole("link", { name: "Open the weekly review" }).click();
  await page.waitForURL(`${base}/admin/loop`);
  check(true, "the Overview's line opens /admin/loop");
  check(
    (await nav.getAttribute("aria-current")) === "page",
    "and the nav marks it as the page shown",
  );

  // 2. The findings, their evidence and their proposals.
  const findings = page.locator("article[data-code]");
  check(await visible(findings, 30_000), "the brain's review reached the page");
  const meta = await page.locator(".page-header .meta").innerText();
  console.log(`     ${meta.replace(/\s*\n\s*/g, "; ")}`);
  const n = await findings.count();
  const codes: string[] = [];
  for (let i = 0; i < n; i++) codes.push((await findings.nth(i).getAttribute("data-code")) ?? "");
  check(n > 0, `${n} findings, most weight first: ${codes.join(", ")}`);
  const heading = await page.locator("#findings-h").innerText();
  check(heading === `Findings (${n})`, `the section says how many: ${heading}`);
  const WHERE: Record<string, RegExp> = {
    Session: /^\/admin\/runs$/,
    "Evaluator batch": /^\/admin\/evaluator#decisions-h$/,
    Decision: /^\/admin\/evaluator#decisions-h$/,
    Topic: /^\/admin\/agenda$/,
    Claim: /^\/claims\/[a-z0-9.-]+$/,
    Waiting: /^\/admin\/evaluator$/,
    Report: /^\/admin\/reports$/,
    Source: /^https:\/\//,
  };
  const links = await page.locator('article[data-code] ul[aria-label="Evidence"] li').evaluateAll(
    (lis) =>
      lis.map((li) => ({
        kind: li.querySelector("span")?.textContent ?? "",
        href: li.querySelector("a")?.getAttribute("href") ?? "",
      })),
  );
  const wrong = links.filter((l) => !WHERE[l.kind]?.test(l.href));
  check(
    links.length > 0 && wrong.length === 0,
    `each of ${links.length} evidence links goes to the page that shows it${wrong.length ? `; wrong: ${JSON.stringify(wrong.slice(0, 3))}` : ""}`,
  );
  const buttons = await findings.locator("button").count();
  const none = await findings.getByText("No command fits this one").count();
  check(buttons + none <= n, `${buttons} findings carry a proposal button, ${none} say no command fits`);
  await page.waitForTimeout(6000);
  check(
    results().length === sentBefore,
    `opening the page sent the brain nothing (${results().length - sentBefore} new results)`,
  );
  await shoot(page, "loop-before");

  // 3. Press one lesson proposal.
  const LABEL = "Keep this rule as a standing lesson for research";
  const open = page.locator('article[data-code="rule.broken"]', {
    has: page.getByRole("button", { name: LABEL }),
  });
  check((await open.count()) > 0, `a rule.broken finding offers "${LABEL}"`);
  const target = open.first();
  const id = (await target.getAttribute("aria-labelledby")) ?? "";
  const rule = ((await target.locator("h3").innerText()).split(": ")[1] ?? "") as EvaluatorRule;
  check(EVALUATOR_RULES.includes(rule), `its rule is one of the evaluator's: "${rule}"`);
  const want = ruleLesson(rule);
  check(!lessons().some((l) => l.text === want), "the scratch daemon does not keep that lesson yet");
  const row = page.locator(`article[aria-labelledby="${id}"]`);
  await row.getByRole("button", { name: LABEL }).click();
  check(await visible(row.getByText(/^Sent/), 5000), "the finding says Sent once pressed");
  await page.screenshot({ path: path.join(out, "loop-sent.png") });
  const sent = page.locator('ul[aria-live="polite"] li', { hasText: LABEL }).first();
  check(await visible(sent, 5000), "the sent list has the command under its label");
  const end = sent.locator(".badge-ok, .badge-bad");
  await end.waitFor({ state: "visible", timeout: 120_000 });
  const ok = (await end.getAttribute("class"))?.includes("badge-ok") ?? false;
  check(ok, `the brain reports it done: ${(await end.innerText()).trim()}`);
  const told = (await sent.innerText()).replace(/\s+/g, " ").trim();
  check(
    told.includes("lesson kept; every research session from now on reads it"),
    `the sent list's row says what the brain did: ${told}`,
  );
  const kept = lessons().filter((l) => l.text === want);
  check(
    kept.length === 1 && kept[0]?.from === "owner",
    `the scratch daemon keeps the lesson, word for word, as the owner's: ${kept[0]?.text}`,
  );
  check(
    await visible(row.getByText("It is a standing lesson now."), 30_000),
    "the finding now says it is a standing lesson, with no button",
  );
  check((await row.getByRole("button").count()) === 0, "and its button is gone");
  const others = await page.locator("article[data-code] button").count();
  check(others === buttons - 1, `every other proposal still waits for you (${others} buttons)`);
  const lines = results().slice(sentBefore).map((l) => JSON.parse(l) as { type: string });
  check(
    lines.length > 0 && lines.every((l) => l.type === "lesson.add"),
    `the only command the brain received was lesson.add (${lines.length} result line(s))`,
  );
  await shoot(page, "loop-after");
  await page.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);
} finally {
  await browser.close();
}
console.log(failed ? "loopreviewcheck FAILED" : "loopreviewcheck passed");
process.exit(failed ? 1 : 0);
