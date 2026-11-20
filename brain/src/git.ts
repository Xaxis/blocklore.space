// GitHub history without the web pages robots.txt closes to bots (/*.atom, /*/*/commits/) and
// without the shared API quota: treeless bare mirrors (commits and tags, no trees or files) kept in
// var/git and updated with `git fetch`. bitcoin/bitcoin is about 40 MB this way.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT, VAR } from "./env.ts";

export const GIT_DIR = path.join(VAR, "git");

const git = (args: string[], timeout = 15 * 60_000) =>
  execFileSync("git", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

export interface Commit {
  sha: string;
  author: string;
  /** Committer date, ISO: when it landed on the branch. */
  date: string;
  subject: string;
}

/** Brings the mirror of `repo`'s `branch` and its tags up to date, cloning it the first time. */
export function syncMirror(repo: string, branch: string): string {
  const dir = path.join(GIT_DIR, `${repo.replace("/", "__")}.git`);
  if (!existsSync(dir)) {
    mkdirSync(GIT_DIR, { recursive: true });
    git([
      "clone",
      "-q",
      "--bare",
      "--filter=tree:0",
      "--single-branch",
      "--branch",
      branch,
      `https://github.com/${repo}.git`,
      dir,
    ]);
  }
  git([
    "-C",
    dir,
    "fetch",
    "-q",
    "--filter=tree:0",
    "--tags",
    "--force",
    "origin",
    `+refs/heads/${branch}:refs/heads/${branch}`,
  ]);
  return dir;
}

/** Commits on `branch` that landed after `since` (all of the newest `max` when there is no cursor). */
export function commitsSince(
  dir: string,
  branch: string,
  since: string | null,
  max = 30,
): Commit[] {
  const out = git([
    "-C",
    dir,
    "log",
    `--max-count=${max}`,
    "--format=%H%x1f%an%x1f%cI%x1f%s",
    `refs/heads/${branch}`,
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, author, date, subject] = l.split("\x1f") as [string, string, string, string];
      return { sha, author, date: new Date(date).toISOString(), subject };
    })
    .filter((c) => !since || c.date > since);
}

/** Tags created after `since`, newest first (tagger date for annotated tags). */
export function tagsSince(
  dir: string,
  since: string | null,
  max = 10,
): { tag: string; date: string }[] {
  const out = git([
    "-C",
    dir,
    "for-each-ref",
    "--sort=-creatordate",
    `--count=${max}`,
    "--format=%(refname:short)%1f%(creatordate:iso-strict)",
    "refs/tags",
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [tag, date] = l.split("\x1f") as [string, string];
      return { tag, date: new Date(date).toISOString() };
    })
    .filter((t) => !since || t.date > since);
}

/**
 * Stages exactly `paths` (relative to the repo) and commits them as the owner, the only author this
 * repo takes. Returns false when they hold no change.
 */
export function commitAsOwner(paths: string[], message: string, push: boolean): boolean {
  execFileSync("git", ["add", "--", ...paths], { cwd: ROOT });
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--", ...paths], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (!staged) return false;
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Xaxis",
      "-c",
      "user.email=william.neeley@gmail.com",
      "commit",
      "-q",
      "-m",
      message,
      "--",
      ...paths,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (push) execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: ROOT, stdio: "inherit" });
  return true;
}
