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
//   a scrubbed environment     only PATH, HOME, LANG and the API key the CLI itself needs
//
// The role sees only what the runner copies into the run folder: its task, the editorial rules,
// the claim format, and the published claims it builds on.
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
import { AGENT_HOME, ROOT, VAR } from "./env.ts";

export type Role = "research" | "verifier";

export interface RoleLimits {
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
}

export const LIMITS: Record<Role, RoleLimits> = {
  research: { model: "opus", maxTurns: 120, maxBudgetUsd: 6, timeoutMs: 75 * 60 * 1000 },
  verifier: { model: "opus", maxTurns: 90, maxBudgetUsd: 5, timeoutMs: 60 * 60 * 1000 },
};

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

const BUDGET_LOG = path.join(VAR, "budget", "runs.jsonl");

/** Dollars the model roles spent today (UTC), from the runner's own ledger. */
export function spentToday(): number {
  if (!existsSync(BUDGET_LOG)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return readFileSync(BUDGET_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { day: string; cost: number })
    .filter((e) => e.day === today)
    .reduce((n, e) => n + e.cost, 0);
}

export const DAILY_BUDGET_USD = Number(process.env.BRAIN_DAILY_BUDGET_USD || 60);

export async function runRole(
  role: Role,
  dir: string,
  task: string,
  limits: Partial<RoleLimits> = {},
): Promise<RunResult> {
  const lim = { ...LIMITS[role], ...limits };
  const spent = spentToday();
  if (spent + lim.maxBudgetUsd > DAILY_BUDGET_USD)
    throw new Error(
      `budget: ${spent.toFixed(2)} of ${DAILY_BUDGET_USD} USD spent today; a ${role} run may cost ${lim.maxBudgetUsd}`,
    );
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (.env)");

  const prompt = readFileSync(path.join(ROOT, "brain", "prompts", `${role}.md`), "utf8");
  const tools = "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch";
  const allowed =
    role === "research"
      ? "Read,Glob,Grep,WebFetch,WebSearch,Write(./claims/**),Edit(./claims/**),Write(./topics/**),Edit(./topics/**),Write(./run.yaml),Edit(./run.yaml)"
      : "Read,Glob,Grep,WebFetch,WebSearch,Write(./verdicts/**),Edit(./verdicts/**)";
  const args = [
    "-p",
    task,
    "--restricted",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--tools",
    tools,
    "--allowedTools",
    allowed,
    "--permission-mode",
    "dontAsk",
    "--append-system-prompt",
    prompt,
    "--model",
    lim.model,
    "--max-turns",
    String(lim.maxTurns),
    "--max-budget-usd",
    String(lim.maxBudgetUsd),
    "--output-format",
    "json",
    "--no-session-persistence",
  ];
  const env = {
    PATH: `/usr/bin:/bin:${process.env.HOME}/.local/bin`,
    HOME: AGENT_HOME,
    LANG: "C.UTF-8",
    ANTHROPIC_API_KEY: key,
  };
  mkdirSync(AGENT_HOME, { recursive: true });
  const started = Date.now();
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), lim.timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      writeFileSync(path.join(dir, `${role}.log.json`), stdout || stderr);
      resolve(stdout || stderr);
    });
    child.on("error", reject);
  });
  let parsed: {
    result?: string;
    total_cost_usd?: number;
    num_turns?: number;
    permission_denials?: unknown[];
    subtype?: string;
    is_error?: boolean;
  };
  try {
    parsed = JSON.parse(out);
  } catch {
    parsed = { result: out.slice(0, 2000), is_error: true, subtype: "unparseable" };
  }
  const r: RunResult = {
    ok: !parsed.is_error && parsed.subtype === "success",
    result: parsed.result ?? "",
    costUsd: parsed.total_cost_usd ?? 0,
    turns: parsed.num_turns ?? 0,
    denials: parsed.permission_denials?.length ?? 0,
    subtype: parsed.subtype ?? "unknown",
  };
  mkdirSync(path.dirname(BUDGET_LOG), { recursive: true });
  appendFileSync(
    BUDGET_LOG,
    `${JSON.stringify({ day: new Date().toISOString().slice(0, 10), role, dir: path.relative(ROOT, dir), cost: r.costUsd, turns: r.turns, minutes: Math.round((Date.now() - started) / 60000), subtype: r.subtype })}\n`,
  );
  return r;
}
