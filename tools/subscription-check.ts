// Drives the admin's subscription form without a browser, against a dev site and a dev daemon with
// their own BLOCKLORE_CONTROL_DIR and BLOCKLORE_ENV_FILE (.claude/skills/verify/features/admin.md):
// signs in with a devbox link, checks that an API key and an unsealed connect command are refused,
// sends a well-formed token no account has, and waits for the daemon to check it with a one-turn
// session, refuse it and save nothing. It never prints a token.
//
//   node tools/subscription-check.ts [BASE_URL]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3721";
const root = path.resolve(import.meta.dirname, "..");
const env: NodeJS.ProcessEnv = { ...process.env, BLOCKLORE_SITE: base };
const devEnv = path.join(root, "web/.env.development.local");
if (base.startsWith("http://localhost") && fs.existsSync(devEnv))
  for (const line of fs.readFileSync(devEnv, "utf8").split("\n")) {
    const m = /^(CONTROL_KEY)=(.+)$/.exec(line);
    if (m?.[1] && m[2]) env[m[1]] = m[2];
  }

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};

const said = execFileSync(
  process.execPath,
  ["--env-file-if-exists=.env", "brain/cli.ts", "admin-link"],
  { cwd: root, env, encoding: "utf8" },
);
const t = /#t=([A-Za-z0-9_-]+)/.exec(said)?.[1];
if (!t) throw new Error("admin-link printed no link");

const json = { "Content-Type": "application/json", Origin: base };
const signin = await fetch(`${base}/api/admin/auth`, {
  method: "POST",
  headers: json,
  body: JSON.stringify({ t }),
});
const cookie = (signin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
check(signin.ok && cookie.includes("bl_admin"), "signed in with a devbox link");
const as = { ...json, Cookie: cookie };

const post = (route: string, body: unknown) =>
  fetch(`${base}${route}`, { method: "POST", headers: as, body: JSON.stringify(body) });

const api = await post("/api/admin/subscription", { token: `sk-ant-api03-${"x".repeat(60)}` });
check(api.status === 400, `an API key is refused (${api.status})`);

const raw = await post("/api/admin/command", {
  cmd: {
    type: "subscription.connect",
    sealed: { v: 1, iv: "0".repeat(24), tag: "0".repeat(32), data: "AAAA" },
  },
});
check(raw.status === 400, `an unsealed connect command is refused (${raw.status})`);

const fake = `sk-ant-oat01-${"Zz9_".repeat(20)}`;
const sent = await post("/api/admin/subscription", { token: fake });
const { id } = (await sent.json()) as { id?: string };
check(sent.ok && !!id, `a well-formed token is sealed and queued (${sent.status})`);

let message = "";
const until = Date.now() + 240_000;
while (id && Date.now() < until) {
  const poll = await fetch(`${base}/api/admin/poll?results=${id}`, { headers: as });
  const body = (await poll.json()) as {
    results: Record<string, { phase: string; message: string }>;
  };
  const r = body.results[id];
  if (r && (r.phase === "done" || r.phase === "failed")) {
    message = r.message;
    check(r.phase === "failed", `the daemon refused it: ${r.message}`);
    break;
  }
  await new Promise((ok) => setTimeout(ok, 3000));
}
check(message.includes("did not start a session, so nothing was saved"), "nothing was saved");
check(!message.includes(fake) && !message.includes("Zz9_"), "the token never comes back");

await post("/api/admin/logout", {});
process.exit(failed ? 1 : 0);
