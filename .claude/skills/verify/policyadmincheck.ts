// Drives the admin's "Gate policy" page (/admin/policy) in a browser against a dev site and a dev
// daemon run from a scratch clone whose origin is a local bare repository, so every commit and push
// lands only there (features/admin.md). It signs in with a link from `pnpm brain admin-link`, then:
//
//   1. checks every agenda topic is listed with its flags as main's brain/policy/topics.yaml sets
//      them, each unlisted one says so with nothing pre-selected and Save off, and each row's
//      waiting count is the daemon's review queue's for that topic;
//   2. checks commands the page did not offer are refused (409 for a topic that is neither on the
//      agenda nor published and for a term already listed, 400 for a term on two lines);
//   3. sets p2p-network to contested No and safety advice No, sees the row say "Sent", the brain
//      report the job done, one owner-authored commit on the bare repository's main that adds that
//      one line and changes nothing else, and the row show the file's new flags;
//   4. adds a test term and removes it, the same, and finds main's file as it was after step 3;
//   5. runs axe-core on the page (desk and phone, light and dark) before and after, and writes
//      screenshots, checking the phone width has no sideways scroll;
//   6. restores the file: reverts step 3's commit in the daemon's scratch clone and pushes it, so
//      main's file is again, byte for byte, what it was, and the page shows p2p-network unlisted.
//
//   node .claude/skills/verify/policyadmincheck.ts OUT_DIR BASE_URL BARE_REPO CLONE
//
// It refuses any BASE_URL but http://localhost:<port>, and a CLONE whose origin is not BARE_REPO:
// it commits to the gate policy there.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { parse } from "yaml";

const [out, base, bare, clone] = process.argv.slice(2);
if (!out || !base || !bare || !clone) {
  console.error(
    "usage: node .claude/skills/verify/policyadmincheck.ts OUT_DIR BASE_URL BARE_REPO CLONE",
  );
  process.exit(2);
}
if (!/^http:\/\/localhost:\d+$/.test(base)) {
  console.error("refused: this check commits to the gate policy; run it only against a dev site");
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

const FILE = "brain/policy/topics.yaml";
const OWNER = "Xaxis <william.neeley@gmail.com>";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", bare, ...args], { encoding: "utf8" }).trim();
const policyOnMain = () => git("show", `main:${FILE}`);
const agendaOnMain = () =>
  (parse(git("show", "main:brain/agenda/seed.yaml")) as { topics: { slug: string }[] }).topics;
type Flags = { contested: boolean; safety: boolean };
const flagsOnMain = () =>
  (parse(policyOnMain()) as { topics: Record<string, Flags> }).topics;

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

/** The one commit main gained since `before`: the owner's, and changing only the gate policy. */
function oneCommit(before: string): { sha: string; added: string[]; removed: string[] } {
  const shas = git("rev-list", `${before}..main`).split("\n").filter(Boolean);
  check(shas.length === 1, `exactly one new commit reached the bare repository's main (${shas.length})`);
  const sha = shas[0] ?? "";
  const [author = "", subject = ""] = git("log", "-1", "--format=%an <%ae>%n%s", sha).split("\n");
  check(author === OWNER, `its author is the owner: ${author}`);
  console.log(`     ${sha.slice(0, 12)} ${subject}`);
  const files = git("diff", "--name-only", before, sha).split("\n").filter(Boolean);
  check(files.length === 1 && files[0] === FILE, `it changes only ${FILE}: ${files.join(", ")}`);
  const diff = git("diff", "--unified=0", before, sha, "--", FILE).split("\n");
  const added = diff.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  const removed = diff
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1));
  return { sha, added, removed };
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
        return r.violations.map((v: { id: string; help: string; nodes: { target: string[] }[] }) => ({
          id: v.id,
          help: v.help,
          where: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        }));
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
const original = policyOnMain();
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

  const nav = page.locator("nav.admin-nav").getByRole("link", { name: "Gate policy" });
  check(await visible(nav, 10_000), "the console's nav links Gate policy");
  await nav.click();
  await page.waitForURL(`${base}/admin/policy`);
  check(
    (await nav.getAttribute("aria-current")) === "page",
    "and marks it as the current page",
  );
  // The daemon sends the policy on its next sync; reload until it is there.
  const rows = page.locator("section[aria-labelledby=topics-h] li[data-slug]");
  let arrived = false;
  for (let i = 0; i < 30 && !arrived; i++) {
    arrived = await visible(rows, 3000);
    if (!arrived) await page.reload();
  }
  check(arrived, "the brain's gate policy reached the page");
  const header = await page.locator(".page-header .meta").innerText();
  console.log(`     ${header.replace(/\s*\n\s*/g, "; ")}`);
  const lede = await page.locator(".page-header").innerText();
  check(
    /Contested holds every claim on the topic for the evaluator/.test(lede) &&
      /two independent\s+sources/.test(lede) &&
      /Loosening the gate is your decision and only yours/.test(lede) &&
      /claims\s+already waiting keep waiting for the evaluator/.test(lede),
    "the lede says what each flag does, whose decision loosening is, and that waiting claims keep waiting",
  );

  // 1. Every agenda topic, as the file sets it.
  const file = flagsOnMain();
  const slugs = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-slug")));
  const agenda = agendaOnMain().map((t) => t.slug);
  check(
    agenda.every((s, i) => slugs[i] === s),
    `the ${agenda.length} agenda topics are listed in the agenda's order (${slugs.length} rows)`,
  );
  const poll = (await page.evaluate(async () => (await fetch("/api/admin/poll")).json())) as {
    state: { review: { topics: { topic: string; count: number }[] } } | null;
  };
  const queue = new Map((poll.state?.review.topics ?? []).map((t) => [t.topic, t.count]));
  let unlisted = 0;
  const mismatched: string[] = [];
  for (const slug of slugs) {
    const row = rows.and(page.locator(`[data-slug="${slug}"]`));
    const pressed = await row
      .locator("fieldset")
      .evaluateAll((fs) =>
        fs.map((f) => f.querySelector('button[aria-pressed="true"]')?.textContent ?? null),
      );
    const save = row.getByRole("button", { name: "Save" });
    const waiting = Number(await row.locator("[data-waiting]").getAttribute("data-waiting"));
    if (waiting !== (queue.get(slug ?? "") ?? 0)) mismatched.push(`${slug} waiting ${waiting}`);
    const f = file[slug ?? ""];
    if (!f) {
      unlisted++;
      const says = await row
        .getByText("Not listed: every claim on it waits for the evaluator")
        .count();
      if (says !== 1 || pressed.some((p) => p !== null) || !(await save.isDisabled()))
        mismatched.push(`${slug} unlisted`);
    } else {
      const want = [f.contested ? "Yes" : "No", f.safety ? "Yes" : "No"];
      if (pressed[0] !== want[0] || pressed[1] !== want[1] || !(await save.isDisabled()))
        mismatched.push(`${slug} ${pressed.join("/")} want ${want.join("/")}`);
    }
  }
  check(
    mismatched.length === 0,
    `every row shows main's flags, ${unlisted} unlisted with nothing pre-selected and Save off, and waiting counts that match the daemon's queue${mismatched.length ? `: ${mismatched.join(", ")}` : ""}`,
  );
  const p2p = rows.and(page.locator('[data-slug="p2p-network"]'));
  const p2pWaiting = await p2p.locator("[data-waiting]").innerText();
  console.log(`     p2p-network: ${p2pWaiting}`);
  check(!file["p2p-network"], "p2p-network is not listed on main before the check");

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
  const noTopic = await post({
    type: "policy.topic",
    slug: "no-such-topic",
    contested: false,
    safety: false,
  });
  check(
    noTopic.status === 409 && /neither on the agenda nor published/.test(noTopic.body.error ?? ""),
    `a topic the page did not show is refused: ${noTopic.status} ${noTopic.body.error}`,
  );
  const firstTerm = (parse(original) as { contested_terms: string[] }).contested_terms[0] ?? "";
  const twice = await post({ type: "policy.term", term: firstTerm.toLowerCase(), add: true });
  check(
    twice.status === 409 && /already a contested term/.test(twice.body.error ?? ""),
    `a term already listed is refused: ${twice.status} ${twice.body.error}`,
  );
  const twoLines = await post({ type: "policy.term", term: "two\nlines", add: true });
  check(twoLines.status === 400, `a term on two lines is refused: ${twoLines.status}`);

  await shoot(page, "policy-before");
  await axe(page, "before");

  // 3. p2p-network: neither contested nor safety advice.
  let before = git("rev-parse", "main");
  const save = p2p.getByRole("button", { name: "Save" });
  await p2p
    .getByRole("group", { name: "Contested" })
    .getByRole("button", { name: "No", exact: true })
    .click();
  check(
    (await save.isDisabled()) && (await p2p.getByText("Pick both flags to save.").count()) === 1,
    "with one flag picked, Save stays off and the row asks for both",
  );
  await p2p
    .getByRole("group", { name: "Safety advice" })
    .getByRole("button", { name: "No", exact: true })
    .click();
  check(!(await save.isDisabled()), "with both picked, Save is on");
  await page.screenshot({ path: path.join(out, "policy-picked.png") });
  await save.click();
  check(
    await visible(p2p.getByText("Sent: the brain commits it as yours"), 10_000),
    "the row says Sent once saved",
  );
  await page.screenshot({ path: path.join(out, "policy-pending.png") });
  const listed = await result(page, "List p2p-network as neither contested nor safety advice");
  check(listed.ok, `the brain reports the job done: ${listed.text}`);
  check(
    /^List p2p-network in the gate policy as neither contested nor safety advice, as the owner asked in the admin/.test(
      listed.text,
    ),
    "its message says the owner asked in the admin",
  );
  check(
    /ship failed: deploy failed: .*no VERCEL_TOKEN/.test(listed.text),
    "its ship pushed to the bare repository and did not deploy (no VERCEL_TOKEN)",
  );
  const listedCommit = oneCommit(before);
  check(
    listedCommit.removed.length === 0 &&
      listedCommit.added.length === 1 &&
      listedCommit.added[0] === "  p2p-network: { contested: false, safety: false }",
    `the commit adds that one line and removes none: ${JSON.stringify(listedCommit.added)}`,
  );
  check(
    await visible(
      p2p.getByText("The file sets it as neither contested nor safety advice", { exact: false }),
      30_000,
    ),
    "the row now shows the file's flags",
  );
  const pressedAfter = await p2p
    .locator("fieldset")
    .evaluateAll((fs) =>
      fs.map((f) => f.querySelector('button[aria-pressed="true"]')?.textContent ?? null),
    );
  check(
    pressedAfter.join("/") === "No/No" && (await save.isDisabled()),
    `with No and No pressed and Save off again (${pressedAfter.join("/")})`,
  );
  const afterListing = policyOnMain();

  // 4. A test term, added and removed.
  const TERM = "gate policy check term";
  before = git("rev-parse", "main");
  const terms = page.locator("section[aria-labelledby=terms-h]");
  await terms.getByLabel("Add a term").fill(TERM);
  await terms.getByRole("button", { name: "Add", exact: true }).click();
  check(
    await visible(terms.locator(`li[data-term="${TERM}"]`).getByText("Sent"), 10_000),
    "the new term shows Sent",
  );
  const add = await result(page, `Add the contested term ${TERM}`);
  check(add.ok, `the brain reports the job done: ${add.text}`);
  const addCommit = oneCommit(before);
  check(
    addCommit.removed.length === 0 &&
      addCommit.added.length === 1 &&
      addCommit.added[0] === `  - ${TERM}`,
    `the commit adds that one line: ${JSON.stringify(addCommit.added)}`,
  );
  const termChip = terms.locator(`li[data-term="${TERM}"]:not([data-adding])`);
  check(await visible(termChip, 30_000), "the term is listed among the contested terms");

  before = git("rev-parse", "main");
  await termChip.getByRole("button", { name: `Remove ${TERM}` }).click();
  await termChip.getByRole("button", { name: "Remove", exact: true }).click();
  check(await visible(termChip.getByText("Sent"), 10_000), "the term shows Sent once removed");
  const remove = await result(page, `Remove the contested term ${TERM}`);
  check(remove.ok, `the brain reports the job done: ${remove.text}`);
  const removeCommit = oneCommit(before);
  check(
    removeCommit.added.length === 0 &&
      removeCommit.removed.length === 1 &&
      removeCommit.removed[0] === `  - ${TERM}`,
    `the commit removes that one line: ${JSON.stringify(removeCommit.removed)}`,
  );
  check(
    policyOnMain() === afterListing,
    "main's topics.yaml is again, byte for byte, what it was before the term",
  );
  check(
    await terms
      .locator(`li[data-term="${TERM}"]`)
      .waitFor({ state: "detached", timeout: 30_000 })
      .then(
        () => true,
        () => false,
      ),
    "the term left the page",
  );

  await shoot(page, "policy-after");
  await axe(page, "after");

  // 6. Put the file back: revert step 3 in the daemon's scratch clone, and push it.
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Xaxis",
      "-c",
      "user.email=william.neeley@gmail.com",
      "revert",
      "--no-edit",
      listedCommit.sha,
    ],
    { cwd: clone, stdio: "ignore" },
  );
  execFileSync("git", ["push", "-q", "origin", "HEAD:main"], { cwd: clone, stdio: "ignore" });
  check(policyOnMain() === original, "restored: main's topics.yaml is byte for byte what it was");
  let back = false;
  for (let i = 0; i < 20 && !back; i++) {
    await page.reload();
    back = await visible(
      rows
        .and(page.locator('[data-slug="p2p-network"]'))
        .getByText("Not listed: every claim on it waits for the evaluator"),
      3000,
    );
  }
  check(back, "and the page shows p2p-network not listed again");
  await page.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);
} finally {
  await browser.close();
}
console.log(failed ? "policyadmincheck FAILED" : "policyadmincheck passed");
process.exit(failed ? 1 : 0);
