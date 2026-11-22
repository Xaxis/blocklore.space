// AgentRunner (ARCHITECTURE.md, Interfaces): runs a model role as Claude Code in headless mode,
// boxed in by the CLI itself rather than by instructions (SECURITY.md, T3):
//
//   --restricted               no shell or code tools, no user, project or local settings, file
//                              tools confined to the run's own folder
//   a folder and HOME outside  the run folder sits under AGENT_ROOT, outside the repository, and
//   the repository             HOME is a role-only folder: no CLAUDE.md, memory or login is found
//   --tools / --allowedTools   read, write and search inside that folder, fetch and search the web
//   --permission-mode dontAsk  anything not allowed is refused, never asked about
//   --max-turns, --max-budget-usd, a wall-clock timeout
//   a scrubbed environment     only PATH, HOME, LANG and the one credential the CLI needs: the API
//                              key, or the owner's Claude plan token when the owner chose it
//
// The role sees only what the runner copies into the run folder: its task, the editorial rules,
// the claim format, and the published claims it builds on.
//
// The model, the per-session ceiling, the daily budget and the credential are the owner's settings
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
  maxBudgetUsd: number;
  timeoutMs: number;
}

const TURNS: Record<Role, Pick<RoleLimits, "maxTurns" | "timeoutMs">> = {
  research: { maxTurns: 120, timeoutMs: 75 * 60 * 1000 },
  verifier: { maxTurns: 90, timeoutMs: 60 * 60 * 1000 },
};

/** A role's limits under the owner's settings: their model and their per-session ceiling. */
export function limitsFor(role: Role, s: Settings): RoleLimits {
  return { model: s.research.model, maxBudgetUsd: s.budget.perRunUsd, ...TURNS[role] };
}

/**
 * The one credential a role's CLI gets: the API key, or the owner's Claude plan token
 * (`claude setup-token`) when the owner chose the plan. Never both.
 */
export function roleCredential(
  s: Settings,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (s.research.credential === "plan") {
    const t = env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!t)
      throw new Error(
        "the owner chose the Claude plan for research, but CLAUDE_CODE_OAUTH_TOKEN is not in .env (make one with `claude setup-token`)",
      );
    return { CLAUDE_CODE_OAUTH_TOKEN: t };
  }
  const k = env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("ANTHROPIC_API_KEY is not set (.env)");
  return { ANTHROPIC_API_KEY: k };
}

/**
 * A role's whole environment: a path, its own HOME, a locale and the one credential. Nothing else
 * from .env reaches a model: not the publisher key, the control key or any token (SECURITY.md, T3).
 */
export function roleEnv(credential: Record<string, string>): Record<string, string> {
  return {
    PATH: `/usr/bin:/bin:${process.env.HOME}/.local/bin`,
    HOME: AGENT_HOME,
    LANG: "C.UTF-8",
    ...credential,
  };
}

export interface RunResult {
  ok: boolean;
  result: string;
  costUsd: number;
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

export const BUDGET_LOG = path.join(VAR, "budget", "runs.jsonl");

export interface SpendLine {
  day: string;
  role: string;
  cost: number;
  dir?: string;
}

/** Every line of the runner's spend ledger. */
export function spendLedger(): SpendLine[] {
  if (!existsSync(BUDGET_LOG)) return [];
  return readFileSync(BUDGET_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as SpendLine];
      } catch {
        return [];
      }
    });
}

/** Dollars the model roles spent today (UTC), from the runner's own ledger. */
export function spentToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  return spendLedger()
    .filter((e) => e.day === today)
    .reduce((n, e) => n + e.cost, 0);
}

/**
 * Model dollars the brain may spend today: the owner's setting, or BRAIN_DAILY_BUDGET_USD on a
 * devbox where the owner never saved settings.
 */
export function dailyBudgetUsd(): number {
  const control = controlStore();
  if (!control.hasSettings() && process.env.BRAIN_DAILY_BUDGET_USD)
    return Number(process.env.BRAIN_DAILY_BUDGET_USD);
  return control.settings().budget.dailyUsd;
}

/** Appends spend that did not come from a role run (the bench's API calls) to the same ledger. */
export function recordSpend(role: string, cost: number): void {
  mkdirSync(path.dirname(BUDGET_LOG), { recursive: true });
  appendFileSync(
    BUDGET_LOG,
    `${JSON.stringify({ day: new Date().toISOString().slice(0, 10), role, cost })}\n`,
  );
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
    total_cost_usd?: number;
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
    return [
      ev(
        "result",
        `${role} ${m.subtype ?? "ended"}: ${m.num_turns ?? 0} turns, ${(m.total_cost_usd ?? 0).toFixed(2)} USD`,
      ),
    ];
  return [];
}

/** The run's outcome, from the stream's final result line. */
export function parseResult(stream: string): RunResult {
  type ResultLine = {
    type?: string;
    result?: string;
    total_cost_usd?: number;
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
    costUsd: parsed.total_cost_usd ?? 0,
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
    "--max-budget-usd",
    String(opts.limits.maxBudgetUsd),
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
  const spent = spentToday();
  const budget = dailyBudgetUsd();
  if (spent + lim.maxBudgetUsd > budget)
    throw new Error(
      `budget: ${spent.toFixed(2)} of ${budget} USD spent today; a ${role} run may cost ${lim.maxBudgetUsd}`,
    );
  const credential = roleCredential(settings);

  const prompt = readFileSync(path.join(ROOT, "brain", "prompts", `${role}.md`), "utf8");
  const tools = "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch";
  const allowed =
    role === "research"
      ? "Read,Glob,Grep,WebFetch,WebSearch,Write(./claims/**),Edit(./claims/**),Write(./topics/**),Edit(./topics/**),Write(./run.yaml),Edit(./run.yaml)"
      : "Read,Glob,Grep,WebFetch,WebSearch,Write(./verdicts/**),Edit(./verdicts/**)";
  const env = roleEnv(credential);
  mkdirSync(AGENT_HOME, { recursive: true });
  const run = path.basename(dir);
  const control = controlStore();
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
  mkdirSync(path.dirname(BUDGET_LOG), { recursive: true });
  appendFileSync(
    BUDGET_LOG,
    `${JSON.stringify({ day: new Date().toISOString().slice(0, 10), role, dir: path.relative(ROOT, dir), cost: r.costUsd, turns: r.turns, minutes: Math.round((Date.now() - started) / 60000), subtype: r.subtype, credential: settings.research.credential })}\n`,
  );
  return r;
}
