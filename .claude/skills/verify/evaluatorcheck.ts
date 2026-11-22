// Proves the evaluator end to end in a browser, all inside a scratch clone, so no checkout's var/,
// knowledge/ or dev site is touched (.claude/skills/verify/features/review.md).
//
//   node .claude/skills/verify/evaluatorcheck.ts seed CLONE
//       Writes a throwaway CLONE/web/.env.development.local, four fixture gated claims into
//       CLONE/var/review, and decides one batch with a fake check and a fake verifier (accepts the
//       fixtures, rejects the test claims, leaves one unanswered), then applies it with a commit in
//       CLONE. Refuses unless CLONE is on a branch other than main and its push URL goes nowhere.
//   node .claude/skills/verify/evaluatorcheck.ts drive CLONE OUT [BASE]
//       With CLONE's dev site on BASE (default http://localhost:3722) and CLONE's daemon synced to
//       it: signs in, checks the Evaluator page, sets the threshold, runs a batch (no token: it must
//       say so), holds for the owner and approves the held claim, hands back, withdraws one claim
//       from its row and one by id, checks the lessons; then compiles CLONE's store into CLONE's
//       bundle and checks the public pages. Screenshots go to OUT.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";
import { parse, stringify } from "yaml";

const [mode, cloneArg, out, maybeBase] = process.argv.slice(2);
if (!mode || !cloneArg || (mode === "drive" && !out)) {
  console.error("usage: evaluatorcheck.ts seed CLONE | drive CLONE OUT [BASE]");
  process.exit(2);
}
const clone = path.resolve(cloneArg);
const devEnv = path.join(clone, "web", ".env.development.local");
const git = (...a: string[]) => execFileSync("git", a, { cwd: clone, encoding: "utf8" }).trim();
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const push = git("remote", "get-url", "--push", "origin");
if (branch === "main" || fs.existsSync(push) || /^(https?|git@|ssh)/.test(push))
  throw new Error(`refusing: ${clone} must be on a branch other than main with a push URL that goes nowhere`);

const ID = {
  letter: "covenants.ctv-letter-benefits",
  what: "covenants.what-ctv-commits-to",
  unlinked: "covenants.ctv-review-cost",
  held: "covenants.csfs-pairing",
};

if (mode === "seed") await seed();
else await drive();

async function seed() {
  // The fake verifier's run folders stay inside the clone, not in the devbox's staging root.
  process.env.BLOCKLORE_AGENT_ROOT = path.join(clone, "var", "agent");
  if (!fs.existsSync(devEnv)) {
    const key = () => randomBytes(32).toString("hex");
    fs.writeFileSync(devEnv, `OWNER_EMAIL=owner@example.test\nCONTROL_KEY=${key()}\nBRAIN_SYNC_TOKEN=${key()}\n`, {
      mode: 0o600,
    });
  }
  const mod = (p: string) => import(pathToFileURL(path.join(clone, p)).href);
  const ev = await mod("brain/src/evaluator.ts");
  const { canaryEntries } = await mod("brain/src/canary.ts");
  const { readPending } = await mod("brain/src/store.ts");
  const { readSettings } = await mod("brain/src/control.ts");
  const { loadStore } = await mod("core/src/node/index.ts");
  const { nowStamp } = await mod("brain/src/store.ts");
  const { chainSource } = await mod("brain/src/chain.ts");
  const { PUBLISHER_KEY_VAR, publisherFrom } = await mod("brain/src/orangecheck.ts");

  const url = "https://gnusha.org/pi/bitcoindev/evaluatorcheck-letter/";
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const src = (u: string, quote: string, kind = "mailing-list") => ({
    tier: "T1",
    kind,
    title: "Fixture source",
    url: u,
    locator: "the message",
    quote,
    published: "2025-06-09",
    accessed: "2026-11-20",
    supports: "direct",
  });
  const argument = (id: string, statement: string, attributed: object) => ({
    id,
    statement,
    kind: "argument",
    topics: ["covenants"],
    depth: "builder",
    status: "contested",
    confidence: "medium",
    people: ["James O'Beirne"],
    attributed_to: [attributed],
    related: [ID.what],
    sources: [src(url, "we believe the benefits outweigh the cost")],
  });
  const candidates = [
    argument(
      ID.letter,
      "James O'Beirne argued on the bitcoindev mailing list on 9 June 2025 that the benefits of activating CTV outweigh its review cost.",
      { name: "James O'Beirne", url },
    ),
    {
      id: ID.what,
      statement:
        "BIP 119 specifies OP_CHECKTEMPLATEVERIFY, an opcode that commits to the exact outputs of the transaction that spends it.",
      kind: "fact",
      topics: ["covenants"],
      depth: "builder",
      status: "established",
      confidence: "high",
      people: [],
      related: [ID.letter],
      sources: [
        src(
          `https://github.com/bitcoin/bips/blob/${commit}/bip-0119.mediawiki`,
          "commits to the exact outputs",
          "bip",
        ),
      ],
    },
    argument(
      ID.unlinked,
      "James O'Beirne argued on the bitcoindev mailing list on 9 June 2025 that reviewing CTV has taken more than five years of work.",
      { name: "James O'Beirne" },
    ),
    argument(
      ID.held,
      "James O'Beirne argued on the bitcoindev mailing list on 9 June 2025 that CTV should be paired with OP_CHECKSIGFROMSTACK.",
      { name: "James O'Beirne", url },
    ),
  ];
  const review = path.join(clone, "var", "review");
  fs.mkdirSync(path.join(review, "claims"), { recursive: true });
  fs.mkdirSync(path.join(review, "layouts"), { recursive: true });
  // The real tip: a withdrawal later stamps the real height, and revisions never go back in height.
  const at = await nowStamp(chainSource());
  // A throwaway publisher key, held only in memory: the batch's decisions are signed as on the devbox.
  const signer = publisherFrom({ [PUBLISHER_KEY_VAR]: randomBytes(32).toString("hex") });
  for (const c of candidates)
    fs.writeFileSync(
      path.join(review, "claims", `${c.id}.yaml`),
      stringify({
        candidate: c,
        reasons: ["contested topic: covenants"],
        run: "2026-11-20-daily-covenants",
        proposed: at,
        verdict: { id: c.id, verdict: "accept", reason: "the research run's verifier accepted it" },
        method: "quotes 1/1",
        updates: false,
      }),
    );
  fs.writeFileSync(
    path.join(review, "layouts", "covenants.yaml"),
    stringify({
      slug: "covenants",
      title: "Covenants",
      lede: ID.what,
      contested: true,
      safety: false,
      group: "protocol",
      sections: [{ id: "basics", title: "Basics", depth: "curious", claims: candidates.map((c) => c.id) }],
    }),
  );

  const files = ev.evaluatorFiles();
  const isCanary = (id: string) => canaryEntries().some((c: { id: string }) => c.id === id);
  const r = await ev.evaluateBatch({
    files,
    settings: readSettings,
    now: async () => at,
    check: async (c: { id: string }) => ({ id: c.id, ok: true, issues: [], sources: [], checks: [], method: "quotes 1/1" }),
    verify: async (dir: string, _task: string, model: string) => {
      for (const f of fs.readdirSync(path.join(dir, "claims"))) {
        const id = f.replace(/\.yaml$/, "");
        if (id === ID.held) continue;
        const verdict = isCanary(id) ? "reject" : "accept";
        fs.writeFileSync(
          path.join(dir, "verdicts", f),
          stringify({ id, verdict, reason: `the fixture verifier on ${model} says ${verdict}` }),
        );
      }
      return undefined;
    },
    modelReady: () => true,
    store: () => loadStore(path.join(clone, "knowledge")).store,
    pending: readPending,
    publisher: () => signer,
  });
  console.log(r.message);
  if (!r.batch) process.exit(1);
  for (const d of r.decisions) console.log(`  ${d.outcome.padEnd(8)} ${d.canary ? `test claim (${d.canary.kind})` : d.id}`);
  const applied = ev.applyBatch(r.batch, at, { commit: true, push: false }, readSettings(), files);
  console.log(applied.message);
  process.exit(applied.code);
}

async function drive() {
  const base = maybeBase ?? "http://localhost:3722";
  fs.mkdirSync(out as string, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
  for (const line of fs.readFileSync(devEnv, "utf8").split("\n")) {
    const m = /^(CONTROL_KEY)=(.+)$/.exec(line);
    if (m?.[1] && m[2]) env[m[1]] = m[2];
  }
  const said = execFileSync(process.execPath, ["brain/cli.ts", "admin-link"], { cwd: clone, env, encoding: "utf8" });
  const link = /(https?:\/\/\S+#t=[A-Za-z0-9_-]+)/.exec(said)?.[1];
  if (!link) throw new Error("admin-link printed no link");
  // A site that does not trust BASE hands out a link to the canonical site; never open that.
  if (!link.startsWith(`${base}/`)) throw new Error(`the sign-in link is not for ${base}; nothing was opened`);

  const text = (p: Page, s: string, timeout = 90_000) =>
    p.waitForFunction((t) => (document.body.textContent ?? "").includes(t), s, { timeout });
  let failed = false;
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failed = true;
  };
  const expect = (p: Promise<unknown>, what: string) =>
    p.then(
      () => check(true, what),
      () => check(false, what),
    );
  const claimFile = (id: string) =>
    path.join(clone, "knowledge", "claims", id.split(".")[0] as string, `${id}.yaml`);
  const status = (id: string) => /^status: (\w+)$/m.exec(fs.readFileSync(claimFile(id), "utf8"))?.[1];

  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(link);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${base}/admin`, { timeout: 60_000 });
    await expect(text(page, "Online"), "signed in; the brain is online");
    await page.goto(`${base}/admin/review`);
    check(page.url().endsWith("/admin/evaluator"), "/admin/review leads to the Evaluator page");

    await expect(text(page, "Waiting for the subscription token"), "no token: the state says so");
    await expect(text(page, "Test claim:"), "decisions list the test claims");
    await expect(text(page, ID.letter), "decisions list the published fixture");
    await page.getByText("Every check").first().click();
    await expect(text(page, "Verifier B"), "a decision shows every check");
    await expect(text(page, "rules: attributed with a link"), "the rules' reason shows on the rejected fixture");
    await expect(text(page, "Caught lately"), "calibration numbers show");
    await expect(text(page, "each decision, by the publisher key"), "the last batch's decisions are signed");
    const { verifyStampedJson } = await import(pathToFileURL(path.join(clone, "brain/src/orangecheck.ts")).href);
    const jsonl = (f: string) =>
      fs.readFileSync(path.join(clone, "var", "evaluator", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const decisions = jsonl("decisions.jsonl");
    const signed = jsonl("signatures.jsonl");
    const none = { attestations: [], delegations: [], revocations: [] };
    check(
      decisions.length > 0 &&
        signed.length === decisions.length &&
        signed.every((g, i) => verifyStampedJson(decisions[i], g.envelope, none).ok) &&
        !verifyStampedJson({ ...decisions[0], outcome: "publish", why: "changed" }, signed[0].envelope, none).ok,
      "every decision's signature checks against its line, and an edited line fails",
    );
    await page.screenshot({ path: path.join(out as string, "evaluator-desk-light.png"), fullPage: true });

    // Type once the daemon's settings filled the form, then sit through more than one poll: the
    // field must keep what the owner typed.
    const threshold = page.getByLabel("Threshold (%)");
    await page.waitForFunction(
      () => [...document.querySelectorAll("label")].some((l) => l.textContent?.includes("Threshold") && l.querySelector("input")?.value),
      null,
      { timeout: 60_000 },
    );
    await threshold.fill("95");
    await page.waitForTimeout(7000);
    check((await threshold.inputValue()) === "95", "the threshold field keeps what the owner typed across polls");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(text(page, "publishing needs 95%"), "threshold set to 95%");

    await page.getByRole("button", { name: "Evaluate a batch now" }).click();
    await expect(text(page, "waiting for the subscription token: "), "a batch without the token says it waits");

    await page.getByRole("button", { name: "Hold for me", exact: true }).click();
    await expect(text(page, "Waiting for you (1)"), "hold for the owner: the queue shows the held claim");
    await page.getByLabel(`Select ${ID.held}`).check();
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(text(page, "published 1 claim(s); not shipped: the checkout is on"), "the owner approves by hand; ship refuses off main");
    check(fs.existsSync(claimFile(ID.held)), "the approved claim is in the clone's knowledge/");
    await page.goto(`${base}/admin/evaluator`);
    await page.getByRole("button", { name: "The evaluator", exact: true }).click();
    await expect(
      page.waitForFunction(() => !(document.body.textContent ?? "").includes("Waiting for you ("), null, { timeout: 90_000 }),
      "the evaluator decides again",
    );

    const row = page.getByRole("listitem").filter({ hasText: ID.letter }).filter({ has: page.getByRole("button", { name: "Withdraw" }) });
    await row.getByRole("button", { name: "Withdraw" }).click();
    await page.getByLabel(`Why withdraw ${ID.letter}`).fill("The letter was signed by several people; attribute it to all of them.");
    await page.getByRole("button", { name: "Withdraw it" }).click();
    await expect(text(page, `withdrew ${ID.letter}`), "withdrawn from its row");
    check(status(ID.letter) === "withdrawn", "the clone's claim file says withdrawn");

    const other = fs.readdirSync(path.join(clone, "knowledge", "claims", "taproot")).sort()[0]?.replace(/\.yaml$/, "") as string;
    await page.getByLabel("Claim id").fill(other);
    await page.getByRole("button", { name: "Look up" }).click();
    await page.getByLabel(`Why withdraw ${other}`).fill("A fixture withdrawal from the evaluator check.");
    await page.getByRole("button", { name: "Withdraw it" }).click();
    await expect(text(page, `withdrew ${other}`), "withdrawn by id");
    check(status(other) === "withdrawn", "the second claim file says withdrawn");

    await page.goto(`${base}/admin/lessons`);
    await expect(text(page, "From a withdrawal"), "each withdrawal is a lesson for research");
    await page.goto(`${base}/admin/evaluator`);
    for (const scheme of ["light", "dark"] as const)
      for (const size of [{ name: "desk", width: 1280, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(out as string, `evaluator-after-${size.name}-${scheme}.png`), fullPage: true });
      }
    await page.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);

    // The public side: compile the clone's store into its own bundle; the dev site reloads it.
    execFileSync(process.execPath, ["core/cli.ts", "bundle"], { cwd: clone, stdio: "inherit" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    const deadline = Date.now() + 120_000;
    let card = "";
    while (Date.now() < deadline && !card.includes("A fixture withdrawal")) {
      card = await (await fetch(`${base}/verify/evaluator`)).text();
      if (!card.includes("A fixture withdrawal")) await new Promise((r) => setTimeout(r, 3000));
    }
    check(card.includes("Withdrawn by the owner") && card.includes("A fixture withdrawal"), "/verify/evaluator lists the withdrawals");
    check(card.includes("Test claims caught lately"), "/verify/evaluator shows the catch rate");
    await page.goto(`${base}/verify/evaluator`);
    await page.screenshot({ path: path.join(out as string, "scorecard-desk-light.png"), fullPage: true });
    await page.goto(`${base}/claims/${ID.letter}`);
    await expect(text(page, "Withdrawn on"), "the withdrawn claim's page says when and why");
    await page.screenshot({ path: path.join(out as string, "withdrawn-claim-desk-light.png"), fullPage: true });
    await page.goto(`${base}/claims/${ID.what}`);
    await expect(text(page, "Published by the evaluator on"), "a published claim says how it was evaluated");
    await page.screenshot({ path: path.join(out as string, "evaluated-claim-desk-light.png"), fullPage: true });
    const api = (await (await fetch(`${base}/api/v1/claims/${other}`)).json()) as { claim?: { status: string } };
    check(api.claim?.status === "withdrawn", "/api/v1/claims returns the withdrawn claim with its status");
    const topic = await (await fetch(`${base}/api/v1/topics/taproot`)).text();
    check(!topic.includes(`"${other}"`), "the topic no longer lists it");
    const words = (parse(fs.readFileSync(claimFile(other), "utf8")) as { statement: string }).statement
      .split(" ")
      .slice(0, 10)
      .join(" ")
      .replace(/[^A-Za-z0-9 ]/g, "");
    const search = await (
      await fetch(`${base}/api/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: words, limit: 50 }),
      })
    ).text();
    check(search.includes('"results"') && !search.includes(`"id":"${other}"`), "search for its own words leaves it out");
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}
