// Drives the Nostr channel end to end in a scratch copy (features/nostr.md): a dev site, a dev
// daemon whose BLOCKLORE_NOSTR_RELAYS are two relay stubs on this machine (brain/test/relay.ts),
// never a public relay. Three phases. Between them, restart `next dev`, as a deploy would: a
// running dev server keeps the old bundle on routes it compiled before (loop.md, gotchas).
//
//   on       sign in, read the switch and the preview, check that no relay heard a thing while it
//            is off, turn it on, wait for the brain's job, check every event each stub got (id,
//            schnorr signature, the key knowledge/nostr.json names), the admin's "Sent lately";
//            then rebundle
//   readers  /.well-known/nostr.json names that key, the Follow link on /connect and /about, then
//            turn it off in the admin and check that nothing more was sent; then rebundle
//   off      /connect has no Follow link and the key still resolves
//
//   node .claude/skills/verify/nostrcheck.ts <on|readers|off> OUT_DIR BASE_URL RELAY_LOG_A RELAY_LOG_B
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { npub } from "../../../core/src/nostr.ts";

const [phase, out, base, logA, logB] = process.argv.slice(2);
if (!phase || !["on", "readers", "off"].includes(phase) || !out || !base || !logA || !logB) {
  console.error(
    "usage: node .claude/skills/verify/nostrcheck.ts <on|readers|off> OUT_DIR BASE_URL RELAY_LOG_A RELAY_LOG_B",
  );
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, "../../..");

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const NOSTR = 'section[aria-labelledby="nostr-h"]';
/** Waits until the page (or a part of it) reads `s`; false on timeout. */
const waitText = (p: Page, s: string | RegExp, timeout = 60_000, scope = "body") =>
  p
    .waitForFunction(
      ([src, flags, sel]) =>
        new RegExp(src, flags).test(
          (document.querySelector(sel) as HTMLElement | null)?.innerText ?? "",
        ),
      [
        typeof s === "string" ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : s.source,
        typeof s === "string" ? "" : s.flags,
        scope,
      ] as const,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );
/**
 * A page torn down under the driver: `next dev` aborting a load to recompile, or React rendering
 * the root again when hydration meets the caret style Playwright adds for a screenshot.
 */
const RACE = /ERR_ABORTED|not attached|Cannot find context|Execution context was destroyed/;
/** Until the page has hydrated and its first requests are done. */
const settle = async (p: Page) => {
  await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await p.waitForTimeout(600);
};
/** The page's text as a reader sees it, read again if a reload tore the page down meanwhile. */
const body = async (p: Page): Promise<string> => {
  for (let i = 0; ; i++) {
    try {
      return await p.evaluate(() => document.body.innerText);
    } catch (e) {
      if (i >= 4 || !RACE.test(String(e))) throw e;
      await settle(p);
    }
  }
};
/** page.goto, again when the load was torn down, then settled. */
const go = async (p: Page, url: string) => {
  for (let i = 0; ; i++) {
    try {
      const r = await p.goto(url);
      await settle(p);
      return r;
    } catch (e) {
      if (i >= 4 || !RACE.test(String(e))) throw e;
      await p.waitForTimeout(1500);
    }
  }
};

const lines = (f: string) =>
  fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
const ids = (f: string) => lines(f).map((l) => (JSON.parse(l) as { id: string }).id);
const record = () => {
  const f = path.join(root, "knowledge/nostr.json");
  return fs.existsSync(f)
    ? (JSON.parse(fs.readFileSync(f, "utf8")) as { pubkey: string; records: string; posting: boolean })
    : null;
};
const rebundle = () =>
  execFileSync(process.execPath, ["core/cli.ts", "bundle"], { cwd: root, stdio: "ignore" });
const shots = async (p: Page, name: string, locator: string) => {
  for (const scheme of ["light", "dark"] as const)
    for (const size of [
      { name: "desk", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await p.setViewportSize({ width: size.width, height: size.height });
      await p.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      // The app shell lays itself out again for a new width; shoot once it has settled.
      for (let i = 0; ; i++) {
        await settle(p);
        try {
          await p
            .locator(locator)
            .first()
            .screenshot({ path: path.join(out, `${name}-${size.name}-${scheme}.png`) });
          break;
        } catch (e) {
          if (i >= 3 || !RACE.test(String(e))) throw e;
        }
      }
    }
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
};
/** Every event a stub logged, checked by brain/test/relay.ts (node's sha256, noble's schnorr). */
const eventsCheck = (key: string) => {
  for (const f of [logA, logB]) {
    let said = "";
    let code = 0;
    try {
      said = execFileSync(process.execPath, ["brain/test/relay.ts", "check", f, key], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (e) {
      code = 1;
      said = String((e as { stdout?: string }).stdout ?? e);
    }
    console.log(said.trim().replace(/^/gm, "     "));
    check(code === 0, `every event ${path.basename(f)} got has the right id and signature, from ${key.slice(0, 12)}...`);
  }
};

async function signIn(browser: Browser): Promise<Page> {
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await go(page, link);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 30_000 });
  // The daemon sends the channel's view on its next sync; reload until it is there.
  let shown = false;
  for (let i = 0; i < 20 && !shown; i++) {
    await go(page, `${base}/admin/settings`);
    shown = await waitText(page, "The next notes", 5000);
  }
  check(shown, "the channel's preview reached the admin");
  await page.waitForFunction(
    (sel) => !(document.querySelector(`${sel} input[type=checkbox]`) as HTMLInputElement)?.disabled,
    NOSTR,
    { timeout: 60_000 },
  );
  return page;
}

async function phaseOn(browser: Browser) {
  const page = await signIn(browser);
  const toggle = page.getByRole("checkbox", { name: /Post to Nostr/ });
  check(!(await toggle.isChecked()), "the switch is off by default");
  const off = await body(page);
  check(off.includes("Not posting"), "it says Not posting");
  check(/Channel key\s+npub1/.test(off), "it shows the channel's npub");
  check(
    off.includes("Profile 0") && off.includes("Relay list 10002"),
    "the preview starts with the profile and the relay list",
  );
  const kinds = [...off.matchAll(/(Profile 0|Relay list 10002|Article 30023|Note 1)\b/g)].map((m) => m[1]);
  console.log(`     the preview lists: ${kinds.join(", ")}`);
  if (kinds.includes("Article 30023"))
    check(off.includes("Every line links to its evidence."), "the article in the preview reads as it would go out");
  check(lines(logA).length + lines(logB).length === 0, "while it is off no relay has heard a thing");
  await shots(page, "settings-off", NOSTR);

  await toggle.check();
  check(await waitText(page, "Waiting for the brain", 5000, NOSTR), "the switch holds the choice while the brain applies it");
  const done = await waitText(page, /now on two relays|nothing new to post|failed/i, 240_000, NOSTR);
  const said = await page.locator(NOSTR).innerText();
  console.log(`     the brain said: ${/(recorded [^\n]+)/.exec(said)?.[1] ?? said.slice(0, 300)}`);
  check(done && /now on two relays/.test(said) && !/ship failed/.test(said), "the brain turned it on, recorded it and posted");
  check(await waitText(page, /\bPosting\b/, 30_000, NOSTR), "it says Posting");

  const rec = record();
  check(!!rec?.posting && rec.pubkey !== rec.records, "knowledge/nostr.json records posting on, with two different keys");
  if (rec) eventsCheck(rec.pubkey);
  const a = ids(logA);
  check(a.length >= 2 && a.every((id) => ids(logB).includes(id)), `both relays got the same ${a.length} events`);

  let recent = false;
  for (let i = 0; i < 20 && !recent; i++) {
    await go(page, `${base}/admin/settings`);
    recent = await waitText(page, "Sent lately", 5000, NOSTR);
  }
  check(recent, "the admin lists what went out");
  await shots(page, "settings-on", NOSTR);
  rebundle();
}

async function phaseReaders(browser: Browser) {
  const rec = record();
  const r = await fetch(`${base}/.well-known/nostr.json`);
  check(
    r.headers.get("access-control-allow-origin") === "*" &&
      (r.headers.get("content-type") ?? "").startsWith("application/json"),
    "nostr.json is JSON any origin may read",
  );
  const doc = (await r.json()) as { names: Record<string, string>; relays?: Record<string, string[]> };
  console.log(`     /.well-known/nostr.json: ${JSON.stringify(doc)}`);
  const key = doc.names._ ?? "";
  check(/^[0-9a-f]{64}$/.test(key) && doc.names.blocklore === key && key === rec?.pubkey, "NIP-05 names the channel key for _ and blocklore");
  check(!!doc.names.records && doc.names.records !== key, "and a different key for the records");
  check((doc.relays?.[key]?.length ?? 0) === 2, "with the channel's relays");
  eventsCheck(key);

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pub = npub(key);
  for (const [route, what] of [
    ["/connect", "Follow on Nostr"],
    ["/about", "Follow it on Nostr"],
  ] as const) {
    let shown = false;
    let href: string | null = null;
    for (let i = 0; i < 3 && !(shown && href); i++) {
      await go(page, `${base}${route}`);
      shown = await waitText(page, what, 20_000);
      href = await page
        .locator(`a[href="nostr:${pub}"]`)
        .first()
        .getAttribute("href", { timeout: 10_000 })
        .catch(() => null);
    }
    check(shown, `${route} shows "${what}"`);
    check(href === `nostr:${pub}`, `${route} links to nostr:${pub.slice(0, 16)}...`);
  }
  await go(page, `${base}/connect`);
  await waitText(page, "Follow on Nostr");
  await shots(page, "connect-follow", "#nostr");
  await go(page, `${base}/about`);
  await waitText(page, "Follow it on Nostr");
  await page.locator("#nostr").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "about-nostr-desk-light.png") });
  await page.close();

  const admin = await signIn(browser);
  const sent = ids(logA).length;
  await admin.getByRole("checkbox", { name: /Post to Nostr/ }).uncheck();
  check(await waitText(admin, /posting is off, so nothing was sent/, 240_000, NOSTR), "turned off, the brain recorded it and sent nothing");
  check(await waitText(admin, "Not posting", 30_000, NOSTR), "it says Not posting");
  await admin.waitForTimeout(5000);
  check(ids(logA).length === sent && ids(logB).length === sent, "no relay heard anything more");
  check(record()?.posting === false, "knowledge/nostr.json records posting off");
  await admin.evaluate(async () => (await fetch("/api/admin/logout", { method: "POST" })).status);
  rebundle();
}

async function phaseOff(browser: Browser) {
  const page = await browser.newPage();
  for (const [route, rendered, gone] of [
    ["/connect", "Connect your model", "Follow on Nostr"],
    ["/about", "How to check Blocklore yourself", "Follow it on Nostr"],
  ] as const) {
    let text = "";
    for (let i = 0; i < 3 && !text.includes(rendered); i++) {
      await go(page, `${base}${route}`);
      await waitText(page, rendered, 20_000);
      text = await body(page);
    }
    check(text.includes(rendered) && !text.includes(gone), `${route} no longer shows "${gone}"`);
  }
  const doc = (await (await fetch(`${base}/.well-known/nostr.json`)).json()) as { names: Record<string, string> };
  check(!!doc.names._ && doc.names._ === record()?.pubkey, "the key still resolves, so what it posted stays checkable");
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
try {
  if (phase === "on") await phaseOn(browser);
  else if (phase === "readers") await phaseReaders(browser);
  else await phaseOff(browser);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
