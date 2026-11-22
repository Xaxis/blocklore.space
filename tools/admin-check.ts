// Drives the admin in a browser: signs in with a link from `pnpm brain admin-link`, checks the
// round trip to the brain with a ping, and screenshots every admin page (desk and phone, light and
// dark). With --write it also adds and removes a lesson, changes and restores the research mode,
// and sends a well-formed but unknown subscription token through the connect form, so run that only
// against a daemon with its own BLOCKLORE_CONTROL_DIR and BLOCKLORE_ENV_FILE (see
// .claude/skills/verify/features/admin.md).
//
//   node tools/admin-check.ts OUT_DIR [BASE_URL] [--write]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const args = process.argv.slice(2);
const write = args.includes("--write");
const [out, maybeBase] = args.filter((a) => a !== "--write");
if (!out) {
  console.error("usage: node tools/admin-check.ts OUT_DIR [BASE_URL] [--write]");
  process.exit(2);
}
const base = maybeBase ?? "http://localhost:3721";
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, "..");

// The dev site's keys live in web/.env.development.local; production's in .env.
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

// Rendered text only: textContent also holds the page's <script> data (Next.js puts the server's
// state there, old command results included), which matched before the step under test had run.
const text = (p: Page, s: string, timeout = 60_000) =>
  // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
  p.waitForFunction((t) => document.body.innerText.includes(t), s, { timeout });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 30_000 });
  check(!page.url().includes("#"), "signed in; the token left the address bar");
  const cookie = (await ctx.cookies()).find((c) => c.name.endsWith("bl_admin"));
  check(!!cookie?.httpOnly && cookie.sameSite === "Lax", `session cookie ${cookie?.name}`);

  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await again.getByRole("button", { name: "Sign in", exact: true }).click();
  await text(again, "already used", 15_000).then(
    () => check(true, "the link does not work twice"),
    () => check(false, "the link does not work twice"),
  );

  const online = await text(page, "Online", 60_000).then(
    () => true,
    () => false,
  );
  check(online, "the brain is online");
  if (online) {
    await page.goto(`${base}/admin/settings`);
    await page.getByRole("button", { name: "Ping the brain" }).click();
    await text(page, "pong from").then(
      () => check(true, "ping answered"),
      () => check(false, "ping answered"),
    );
  }
  if (online && write) {
    await page.goto(`${base}/admin/lessons`);
    await page.getByLabel("New lesson").fill("admin-check: a lesson to remove again");
    await page.getByRole("button", { name: "Add lesson" }).click();
    await text(page, "admin-check: a lesson").then(
      () => check(true, "lesson added"),
      () => check(false, "lesson added"),
    );
    await page
      .getByRole("listitem")
      .filter({ hasText: "admin-check: a lesson" })
      .getByRole("button", { name: "Remove" })
      .click();
    await page
      // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
      .waitForFunction(() => !document.body.innerText.includes("admin-check: a lesson"), null, {
        timeout: 60_000,
      })
      .then(
        () => check(true, "lesson removed"),
        () => check(false, "lesson removed"),
      );
    await page.goto(`${base}/admin/research`);
    await text(page, "When it runs");
    const was = await page.locator(".segmented button[aria-pressed=true]").first().textContent();
    const to = was?.trim() === "Daily" ? "Continuous" : "Daily";
    await page.getByRole("button", { name: to, exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await text(page, `mode "${to.toLowerCase()}"`).then(
      () => check(true, `research mode set to ${to}`),
      () => check(false, `research mode set to ${to}`),
    );
    await page.getByRole("button", { name: was?.trim() ?? "Off", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await text(page, `mode "${was?.trim().toLowerCase()}"`).then(
      () => check(true, `research mode back to ${was}`),
      () => check(false, `research mode back to ${was}`),
    );
    // Who decides gated claims: hold them for the owner (the queue appears), then hand back.
    await page.goto(`${base}/admin/evaluator`);
    await text(page, "Who decides");
    await page.getByRole("button", { name: "Hold for me", exact: true }).click();
    await text(page, "Waiting for you (").then(
      () => check(true, "gated claims held for the owner: the queue shows"),
      () => check(false, "gated claims held for the owner: the queue shows"),
    );
    await page.getByRole("button", { name: "The evaluator", exact: true }).click();
    await page
      // biome-ignore lint/performance/useDomNodeTextContent: rendered text, never the script data
      .waitForFunction(() => !document.body.innerText.includes("Waiting for you ("), null, {
        timeout: 60_000,
      })
      .then(
        () => check(true, "the evaluator decides again"),
        () => check(false, "the evaluator decides again"),
      );

    // The subscription form, end to end with a well-formed token no account has: the site seals it,
    // the daemon opens it, a one-turn session is refused, and nothing is saved. The token must never
    // come back in the page.
    const fake = `sk-ant-oat01-${"Zz9_".repeat(20)}`;
    await page.goto(`${base}/admin/research`);
    await text(page, "Your Claude subscription");
    const form = page.locator("section", { hasText: "Your Claude subscription" });
    if (await form.getByRole("button", { name: "Replace the token" }).isVisible())
      await form.getByRole("button", { name: "Replace the token" }).click();
    await form.getByLabel("Token").fill("sk-ant-api03-not-a-subscription");
    check(
      await form.getByRole("button", { name: /^(Connect|Replace the token)$/ }).isDisabled(),
      "an API key cannot be sent",
    );
    await form.getByLabel("Token").fill(fake);
    const box = form.getByRole("checkbox");
    if (await box.isVisible()) await box.uncheck();
    await form.getByRole("button", { name: /^(Connect|Replace the token)$/ }).click();
    await text(page, "did not start a session, so nothing was saved", 180_000).then(
      () => check(true, "a token no account has is checked and refused, nothing saved"),
      () => check(false, "a token no account has is checked and refused, nothing saved"),
    );
    const html = await page.content();
    const at = html.indexOf(fake);
    check(at < 0, "the token never comes back in the page");
    // Where it lingered, with the token itself masked, so a failure says what to fix.
    if (at >= 0)
      console.log(
        `     ...${html
          .slice(Math.max(0, at - 300), at + fake.length + 80)
          .split(fake)
          .join("[token]")}...`,
      );
  }

  const pages = [
    "",
    "/evaluator",
    "/security",
    "/research",
    "/runs",
    "/agenda",
    "/lessons",
    "/questions",
    "/settings",
  ];
  let n = 0;
  for (const scheme of ["light", "dark"] as const)
    for (const size of [
      { name: "desk", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const p of pages) {
        await page.goto(`${base}/admin${p}`);
        await page.waitForTimeout(1200);
        const name = (p || "/overview").slice(1);
        await page.screenshot({
          path: path.join(out, `${name}-${size.name}-${scheme}.png`),
          fullPage: true,
        });
        n++;
      }
    }
  console.log(`Wrote ${n} screenshots to ${out}.`);

  // End the session it made, so a check against production leaves no live session behind.
  const bye = await page.evaluate(
    async () => (await fetch("/api/admin/logout", { method: "POST" })).status,
  );
  const after = await page.request.get(`${base}/admin`, { maxRedirects: 0 });
  check(bye === 200 && after.status() !== 200, "signed out; the session no longer opens the admin");
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
