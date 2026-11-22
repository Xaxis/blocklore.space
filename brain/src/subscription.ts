import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Sealed, SUBSCRIPTION_TOKEN } from "@blocklore/core/control";
import { open } from "@blocklore/core/node/seal";
import { roleEnv } from "./agent.ts";
import { ROOT } from "./env.ts";

// Connects the brain to the owner's Claude subscription from the admin: the site seals the token
// under CONTROL_KEY, this opens it, checks it with a one-turn session, and only then writes it to
// .env (mode 600). The token never reaches a log, a result message or a command line.

const KEY = "CLAUDE_CODE_OAUTH_TOKEN";
const envFile = () => process.env.BLOCKLORE_ENV_FILE || path.join(ROOT, ".env");

/** The token .env holds now, or null. */
export function readEnvToken(file = envFile()): string | null {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${KEY}=`));
  const v = line?.slice(KEY.length + 1).trim();
  return v ? v : null;
}

/** Puts the token in .env (or takes it out, for null), keeping every other line, atomically. */
export function writeEnvToken(token: string | null, file = envFile()): void {
  const lines = existsSync(file)
    ? readFileSync(file, "utf8")
        .replace(/\n+$/, "")
        .split("\n")
        .filter((l) => !l.startsWith(`${KEY}=`))
    : [];
  if (lines.length === 1 && lines[0] === "") lines.pop();
  if (token) lines.push(`${KEY}=${token}`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
  renameSync(tmp, file);
  if ((statSync(file).mode & 0o777) !== 0o600) throw new Error(".env is not mode 600");
}

/** Text with every copy of the secret replaced, for anything that may be shown or logged. */
export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[token]") : text;
}

export interface Check {
  ok: boolean;
  message: string;
}

/** One turn on the cheapest model, with nothing but the token, in a throwaway HOME. */
export function runCheck(token: string): Promise<Check> {
  const home = mkdtempSync(path.join(tmpdir(), "blocklore-sub-"));
  return new Promise<Check>((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "Reply with the single word ok.",
        "--model",
        "haiku",
        "--max-turns",
        "1",
        "--output-format",
        "text",
      ],
      {
        env: { ...roleEnv({ [KEY]: token }), HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      },
    );
    let out = "";
    const take = (d: Buffer) => {
      out = (out + String(d)).slice(-4000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const done = (ok: boolean, why: string) => {
      rmSync(home, { recursive: true, force: true });
      resolve({ ok, message: redact(why, token).trim().slice(0, 300) });
    };
    child.on("error", (e) => done(false, `could not run claude: ${e.message}`));
    child.on("close", (code) =>
      /\bok\b/i.test(out) && code === 0
        ? done(true, "a one-turn session answered")
        : done(false, out || `claude exited with ${code}`),
    );
  });
}

export interface ConnectDeps {
  key: string;
  check: (token: string) => Promise<Check>;
  write: (token: string | null) => void;
}

/** Opens, checks and saves a sealed token. Nothing is saved unless a session ran on it. */
export async function connect(
  sealed: Sealed,
  deps: ConnectDeps = {
    key: process.env.CONTROL_KEY ?? "",
    check: runCheck,
    write: (t) => writeEnvToken(t),
  },
): Promise<{ code: number; message: string }> {
  let token: string;
  try {
    token = open(deps.key, sealed).trim();
  } catch {
    return {
      code: 1,
      message:
        "the token could not be opened here; CONTROL_KEY differs between the site and the devbox",
    };
  }
  if (!SUBSCRIPTION_TOKEN.test(token))
    return {
      code: 1,
      message: "that is not a Claude subscription token (sk-ant-oat...); nothing was saved",
    };
  const c = await deps.check(token);
  if (!c.ok)
    return {
      code: 1,
      message: `the token did not start a session, so nothing was saved: ${redact(c.message, token)}`,
    };
  deps.write(token);
  return {
    code: 0,
    message:
      "connected: a one-turn session ran on your Claude plan, and research uses it from now on",
  };
}

export function disconnect(write: (t: string | null) => void = (t) => writeEnvToken(t)) {
  write(null);
  return { code: 0, message: "disconnected: no model session starts until a token is connected" };
}
