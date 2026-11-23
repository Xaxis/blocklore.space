// Where the brain's machinery finds its paths and secrets. Secrets come from the process
// environment (loaded from .env by `node --env-file-if-exists`), never from a model's context.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REACH_SKIP_HEADER } from "@blocklore/core/reach";

export const ROOT = path.resolve(import.meta.dirname, "../..");
/** The store; tests point it at a copy. */
export const KNOWLEDGE = process.env.BLOCKLORE_KNOWLEDGE || path.join(ROOT, "knowledge");
export const VAR = path.join(ROOT, "var");
export const CACHE = path.join(VAR, "cache");
export const INBOX = path.join(VAR, "inbox");
/**
 * Where model roles work: outside the repository, so a role never discovers a CLAUDE.md in a parent
 * folder, and with its own HOME, so it never reads the owner's memory or login (SECURITY.md, T3).
 */
export const AGENT_ROOT = process.env.BLOCKLORE_AGENT_ROOT || "/var/tmp/blocklore";
export const STAGING = path.join(AGENT_ROOT, "staging");
export const AGENT_HOME = path.join(AGENT_ROOT, "home");
export const REVIEW = process.env.BLOCKLORE_REVIEW_DIR || path.join(VAR, "review");
/** The evaluator's private records (decisions, canaries, batches); EDITORIAL.md, "The evaluator". */
export const EVALUATOR_DIR = process.env.BLOCKLORE_EVALUATOR_DIR || path.join(VAR, "evaluator");
export const CHAIN_DIR = path.join(VAR, "chain");
/** The daemon's and the admin's state on the devbox (ADMIN.md): settings, jobs, results, live. */
export const CONTROL_DIR = process.env.BLOCKLORE_CONTROL_DIR || path.join(VAR, "control");
/** The one lock every tick, publish, review and ship takes, so git work never overlaps. */
export const TICK_LOCK = path.join(VAR, "loop", "tick.lock");
/** The live site the loop ships to and the daemon syncs with. */
export const SITE = process.env.BLOCKLORE_SITE || "https://blocklore.vercel.app";

export const USER_AGENT = "BlockloreBot/0.1 (+https://blocklore.space/about#bot)";

/**
 * Headers on every call the brain makes to its own site. The brain polls the site all day, so it
 * says it is a check, and the public reach counts (core/src/reach.ts) never count it as use.
 */
export const SITE_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": USER_AGENT,
  [REACH_SKIP_HEADER]: "1",
};

/**
 * A GitHub token for API calls, only when GITHUB_TOKEN is set. The gh CLI's token is deliberately
 * not used: its 5,000 requests an hour are shared by every tool on the devbox. Without a token the
 * brain prefers paths with no API quota (git ls-remote, Atom feeds, raw files) and falls back to
 * HTML pages when the API refuses.
 */
export function githubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

/** The commit a branch (default HEAD) of a GitHub repository points at, via git, no API quota. */
export function remoteHead(repo: string, ref = "HEAD"): { sha: string; branch: string } {
  const out = execFileSync("git", ["ls-remote", "--symref", `https://github.com/${repo}`, ref], {
    encoding: "utf8",
    timeout: 30000,
  });
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(out)?.[1] ?? ref;
  const sha = /^([0-9a-f]{40})\s/m.exec(out)?.[1];
  if (!sha) throw new Error(`git ls-remote found no ${ref} in ${repo}`);
  return { sha, branch };
}
