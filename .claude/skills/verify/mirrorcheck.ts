// Checks what a production mirror leaves out (MIRROR.md, "What a mirror serves, and what it leaves
// out"): every route that needs the owner's services answers closed, with the status MIRROR.md
// gives, and a reader sees a plain sentence rather than an error. Run it against a mirror built
// and started with no environment (features/mirror.md), never against blocklore.space: it posts
// to the admin, the queue and the reports.
//
//   node .claude/skills/verify/mirrorcheck.ts BASE_URL [OUT_DIR]
//
// One `ok` or `FAIL` line per check; exit 1 on any FAIL. With OUT_DIR it saves the claim's reports
// block, the Brain view's live block and the suggestion box after sending (desk, light).
import path from "node:path";
import { chromium } from "playwright-core";

const [arg, out] = process.argv.slice(2);
if (!arg) {
  console.error("usage: node .claude/skills/verify/mirrorcheck.ts BASE_URL [OUT_DIR]");
  process.exit(2);
}
const base: string = arg;
const CLAIM = "taproot.activation-height";
let failed = 0;
const say = (good: boolean, what: string) => {
  if (!good) failed++;
  console.log(`${good ? "ok  " : "FAIL"}  ${what}`);
};
const H = { "X-Blocklore-Check": "1" };

async function get(p: string, want: number, to?: string) {
  const r = await fetch(`${base}${p}`, { headers: H, redirect: "manual" });
  const where = r.headers.get("location") ?? "";
  const good = r.status === want && (!to || new URL(where, base).pathname === to);
  say(good, `GET  ${p}: ${r.status}${where ? ` to ${new URL(where, base).pathname}` : ""}`);
  return r;
}

async function post(p: string, body: unknown, want: number, text?: string) {
  const r = await fetch(`${base}${p}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(body),
  });
  const got = (await r.text()).replace(/\s+/g, " ").trim();
  say(r.status === want && (!text || got.includes(text)), `POST ${p}: ${r.status} ${got}`);
}

await get("/admin", 307, "/admin/login");
await get("/admin/review", 307, "/admin/login");
await get("/admin/login", 200);
await get("/api/admin/poll", 401);
const brain = await (await get("/api/v1/brain", 200)).text();
say(brain.trim() === '{"online":false,"feed":null}', `/api/v1/brain says ${brain.trim()}`);
await get("/api/v1/queue", 503);
await get("/api/v1/reports", 503);
await get(`/api/v1/claims/${CLAIM}/reports`, 503);
await get("/api/v1/queue/pull", 401);
await get("/api/v1/reports/pull", 401);
await get("/progress/2026-11", 200);
await post("/api/admin/login", { email: "owner@example.org" }, 403);
await post("/api/admin/auth", { t: "A".repeat(43) }, 403);
await post("/api/admin/command", { cmd: { type: "pause" } }, 401);
await post("/api/control/sync", {}, 401);
await post("/api/control/link", {}, 401);
await post("/api/v1/queue/status", {}, 401);
await post("/api/v1/reports/status", {}, 401);
await post(
  "/api/v1/queue",
  { q: "How do statechains move bitcoin between owners?" },
  503,
  "Suggestions are not available right now.",
);
await post(
  `/api/v1/claims/${CLAIM}/reports`,
  { kind: "unclear" },
  503,
  "Reports are not available right now.",
);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // The box is shared: under load a software-rendered page can take minutes.
  page.setDefaultTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (sel: string, name: string) => {
    if (out)
      await page
        .locator(sel)
        .first()
        .screenshot({ path: path.join(out, name) });
  };

  await page.goto(`${base}/claims/${CLAIM}`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const t = document.querySelector("#reports")?.textContent ?? "";
    return t !== "" && !t.includes("Reading the record.");
  });
  const reports = ((await page.locator("#reports").textContent()) ?? "").trim();
  const buttons = await page.getByRole("button", { name: "Report a problem" }).count();
  say(
    reports.endsWith("The reports on this claim are not available right now.") && buttons === 0,
    `the claim's reports block: "${reports}", ${buttons} report buttons`,
  );
  await shot("#reports", "claim-reports.png");

  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      !(document.querySelector(".brain-now")?.textContent ?? "Connecting").includes("Connecting"),
  );
  const now = ((await page.locator(".brain-now").first().textContent()) ?? "").trim();
  say(now.startsWith("Not reporting yet"), `the Brain view: "${now}"`);
  await shot(".brain-now", "brain-now.png");

  await page.goto(`${base}/gaps`, { waitUntil: "load" });
  await page.locator("#suggest").fill("How do statechains move bitcoin between owners?");
  await page.getByRole("button", { name: "Suggest" }).click();
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await alert.waitFor();
  const said = ((await alert.textContent()) ?? "").trim();
  say(said === "Suggestions are not available right now.", `the suggestion box: "${said}"`);
  await shot("div.stack:has(> form.suggest)", "gaps-suggest.png");
  say(errors.length === 0, `page errors: ${errors.length ? errors.join("; ") : "none"}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} checks failed` : "mirror leaves out what it should, quietly");
process.exit(failed ? 1 : 0);
