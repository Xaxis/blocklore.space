// AgentRunner (ARCHITECTURE.md, Interfaces): runs a model role as Claude Code in headless mode,
// boxed in by the CLI itself rather than by instructions (SECURITY.md, T3):
//
//   --restricted               no shell or code tools, no user, project or local settings, file
//                              tools confined to the run's own folder
//   a folder and HOME outside  the run folder sits under AGENT_ROOT, outside the repository, and
//   the repository             HOME is a role-only folder: no CLAUDE.md, memory or login is found
//   --tools / --allowedTools   read, write and search inside that folder, fetch and search the web
//   --permission-mode dontAsk  anything not allowed is refused, never asked about
//   --max-turns, a wall-clock timeout
//   a scrubbed environment     only PATH, HOME, LANG and the owner's Claude subscription token
//                              (CLAUDE_CODE_OAUTH_TOKEN). There is no API key: every session runs
//                              on the subscription, never billed per token
//
// The role sees only what the runner copies into the run folder: its task, the editorial rules,
// the claim format, and the published claims it builds on.
//
// The model, the per-session limits and the daily session count are the owner's settings
// (var/control/settings.json, set from the admin; ADMIN.md). The role streams its turns as JSON
// lines: the whole stream goes to <role>.log.jsonl in the run folder, and one condensed line per
// tool call and message goes to the live feed the admin shows (var/control/live.jsonl).
import { spawn } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { LiveEvent, Settings } from "@blocklore/core/control";
import { controlStore, readSettings } from "./control.ts";
import { AGENT_HOME, ROOT, VAR } from "./env.ts";

export type Role = "research" | "verifier";

export interface RoleLimits {
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

/** A role's limits under the owner's settings: their model, turns and minutes per session. */
export function limitsFor(_role: Role, s: Settings): RoleLimits {
  return {
    model: s.research.model,
    maxTurns: s.usage.sessionTurns,
    timeoutMs: s.usage.sessionMinutes * 60_000,
  };
}

export const NO_TOKEN =
  "the devbox has no Claude subscription token yet: run tools/subscription.sh there (it runs `claude setup-token` and saves the token to .env)";

/**
 * The one credential a role's CLI gets: the owner's Claude subscription token, from
 * `claude setup-token`. An API key is never passed, even when one is in the environment, so no
 * session can fall back to per-token billing.
 */
export function roleCredential(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const t = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!t) throw new Error(NO_TOKEN);
  return { CLAUDE_CODE_OAUTH_TOKEN: t };
}

/**
 * When a session ended because the subscription's usage limit was reached, until when model work
 * should wait: the reset time when the CLI gave one as epoch seconds, otherwise an hour, after
 * which the brain tries again. Null for any other ending.
 */
export function usageLimit(r: RunResult, now: Date): { until: string; why: string } | null {
  if (r.ok) return null;
  const text = r.result;
  if (!/usage limit|limit reached|hit your limit|rate.?limit/i.test(text)) return null;
  const epoch = /\|(\d{10})\b/.exec(text)?.[1];
  const at = epoch ? Number(epoch) * 1000 : Number.NaN;
  const until =
    Number.isFinite(at) && at > now.getTime() && at - now.getTime() < 8 * 86_400_000
      ? at
      : now.getTime() + 3_600_000;
  const why = text
    .replace(/\|\d{10}\b/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return { until: new Date(until).toISOString(), why: why || "the subscription's usage limit" };
}

export interface RunResult {
  ok: boolean;
  result: string;
  turns: number;
  denials: number;
  subtype: string;
}

/** Copies the shared rules into a run folder so a confined role can read them. */
export function prepareContext(dir: string) {
  const ctx = path.join(dir, "context");
  mkdirSync(ctx, { recursive: true });
  for (const f of ["EDITORIAL.md", "CLAIMS.md", "SOURCES.md"])
    copyFileSync(path.join(ROOT, f), path.join(ctx, f));
  copyFileSync(
    path.join(ROOT, "brain", "prompts", "example-claim.yaml"),
    path.join(ctx, "example-claim.yaml"),
  );
}

/** One line per model session: the runner's usage ledger. */
export const USAGE_LOG = path.join(VAR, "budget", "runs.jsonl");

export interface UsageLine {
  day: string;
  role: string;
  turns?: number;
  minutes?: number;
  dir?: string;
}

/** Every line of the runner's usage ledger. */
export function usageLedger(): UsageLine[] {
  if (!existsSync(USAGE_LOG)) return [];
  return readFileSync(USAGE_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as UsageLine];
      } catch {
        return [];
      }
    });
}

/** The main argument of a tool call, for one line of the live feed. */
function toolLine(name: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const arg =
    pick("url") ??
    pick("query") ??
    pick("file_path") ??
    pick("pattern") ??
    pick("path") ??
    Object.values(input).find((v): v is string => typeof v === "string") ??
    "";
  return `${name} ${arg}`.trim();
}

const oneLine = (t: string, max: number) => {
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

/** The live-feed lines one stream-json line stands for (none for most lines). */
export function condense(line: string, run: string, role: string, at: string): LiveEvent[] {
  let m: {
    type?: string;
    message?: { content?: unknown };
    subtype?: string;
    num_turns?: number;
  };
  try {
    m = JSON.parse(line);
  } catch {
    return [];
  }
  const ev = (kind: LiveEvent["kind"], text: string): LiveEvent => ({
    at,
    run,
    role,
    kind,
    text: oneLine(text, 600),
  });
  if (m.type === "assistant" && Array.isArray(m.message?.content)) {
    const out: LiveEvent[] = [];
    for (const b of m.message.content as Array<Record<string, unknown>>) {
      if (b.type === "tool_use" && typeof b.name === "string")
        out.push(ev("tool", toolLine(b.name, (b.input as Record<string, unknown>) ?? {})));
      else if (b.type === "text" && typeof b.text === "string" && b.text.trim())
        out.push(ev("text", oneLine(b.text, 300)));
    }
    return out;
  }
  if (m.type === "result")
    return [ev("result", `${role} ${m.subtype ?? "ended"}: ${m.num_turns ?? 0} turns`)];
  return [];
}

/** The run's outcome, from the stream's final result line. */
export function parseResult(stream: string): RunResult {
  type ResultLine = {
    type?: string;
    result?: string;
    num_turns?: number;
    permission_denials?: unknown[];
    subtype?: string;
    is_error?: boolean;
  };
  let last: ResultLine | undefined;
  for (const l of stream.split("\n")) {
    if (!l.trim()) continue;
    try {
      const m = JSON.parse(l) as ResultLine;
      if (m.type === "result") last = m;
    } catch {
      // not a JSON line (stderr, or a truncated tail)
    }
  }
  const parsed: ResultLine = last ?? {
    result: stream.slice(-2000),
    is_error: true,
    subtype: "unparseable",
  };
  return {
    ok: !parsed.is_error && parsed.subtype === "success",
    result: parsed.result ?? "",
    turns: parsed.num_turns ?? 0,
    denials: parsed.permission_denials?.length ?? 0,
    subtype: parsed.subtype ?? "unknown",
  };
}

/** The CLI arguments for one role session (exported for the stream probe and the tests). */
export function roleArgs(opts: {
  task: string;
  prompt: string;
  tools: string;
  allowed: string;
  limits: RoleLimits;
}): string[] {
  return [
    "-p",
    opts.task,
    "--restricted",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--tools",
    opts.tools,
    "--allowedTools",
    opts.allowed,
    "--permission-mode",
    "dontAsk",
    "--append-system-prompt",
    opts.prompt,
    "--model",
    opts.limits.model,
    "--max-turns",
    String(opts.limits.maxTurns),
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
  ];
}

/**
 * Runs `claude` in a folder with a scrubbed environment, streaming: every stdout chunk goes to the
 * log file, and each complete line is condensed into live events.
 */
export function streamClaude(opts: {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  logFile: string;
  timeoutMs: number;
  onLine: (line: string) => void;
}): Promise<string> {
  writeFileSync(opts.logFile, "");
  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let partial = "";
    child.stdout.on("data", (d) => {
      const text = String(d);
      stdout += text;
      appendFileSync(opts.logFile, text);
      partial += text;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) opts.onLine(l);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      if (partial) opts.onLine(partial);
      if (!stdout) writeFileSync(opts.logFile, stderr);
      resolve(stdout || stderr);
    });
    child.on("error", reject);
  });
}

export async function runRole(
  role: Role,
  dir: string,
  task: string,
  limits: Partial<RoleLimits> = {},
): Promise<RunResult> {
  const settings = readSettings();
  const lim = { ...limitsFor(role, settings), ...limits };
  const control = controlStore();
  const mem = control.memory();
  if (mem.backoffUntil && Date.parse(mem.backoffUntil) > Date.now() && mem.limited)
    throw new Error(`the subscription's usage limit: model work waits until ${mem.backoffUntil}`);
  const credential = roleCredential();

  const prompt = readFileSync(path.join(ROOT, "brain", "prompts", `${role}.md`), "utf8");
  const tools = "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch";
  const allowed =
    role === "research"
      ? "Read,Glob,Grep,WebFetch,WebSearch,Write(./claims/**),Edit(./claims/**),Write(./topics/**),Edit(./topics/**),Write(./run.yaml),Edit(./run.yaml)"
      : "Read,Glob,Grep,WebFetch,WebSearch,Write(./verdicts/**),Edit(./verdicts/**)";
  const env = {
    PATH: `/usr/bin:/bin:${process.env.HOME}/.local/bin`,
    HOME: AGENT_HOME,
    LANG: "C.UTF-8",
    ...credential,
  };
  mkdirSync(AGENT_HOME, { recursive: true });
  const run = path.basename(dir);
  const started = Date.now();
  const out = await streamClaude({
    args: roleArgs({ task, prompt, tools, allowed, limits: lim }),
    cwd: dir,
    env,
    logFile: path.join(dir, `${role}.log.jsonl`),
    timeoutMs: lim.timeoutMs,
    onLine: (l) => {
      for (const e of condense(l, run, role, new Date().toISOString())) control.addLive(e);
    },
  });
  const r = parseResult(out);
  mkdirSync(path.dirname(USAGE_LOG), { recursive: true });
  appendFileSync(
    USAGE_LOG,
    `${JSON.stringify({ day: new Date().toISOString().slice(0, 10), role, dir: path.relative(ROOT, dir), turns: r.turns, minutes: Math.round((Date.now() - started) / 60000), subtype: r.subtype })}\n`,
  );
  const limit = usageLimit(r, new Date());
  if (limit)
    control.saveMemory({
      ...control.memory(),
      backoffUntil: limit.until,
      backoffWhy: `the subscription's usage limit was reached (${limit.why}); research resumes after it resets`,
      limited: true,
    });
  return r;
}
