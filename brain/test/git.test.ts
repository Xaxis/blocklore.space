import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { takeInOrigin } from "../src/git.ts";

const ID = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8" }).trim();

/** A bare origin, the brain's checkout and a second clone standing in for GitHub's side. */
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "blocklore-git-"));
  const origin = path.join(dir, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const brain = path.join(dir, "brain");
  const other = path.join(dir, "other");
  execFileSync("git", ["clone", "-q", origin, brain]);
  run(brain, "checkout", "-q", "-b", "main");
  writeFileSync(path.join(brain, "wire.json"), "1\n");
  writeFileSync(path.join(brain, "prompt.md"), "rule 9\n");
  run(brain, "add", ".");
  run(brain, "commit", "-q", "-m", "first");
  run(brain, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", origin, other]);
  return { dir, brain, other };
}

test("a commit that reached GitHub from elsewhere is merged in, and the brain's own keeps its hash", () => {
  const { dir, brain, other } = setup();
  try {
    writeFileSync(path.join(other, "prompt.md"), "rule 9, with links\n");
    run(other, "commit", "-q", "-am", "the owner merged a prompt PR");
    run(other, "push", "-q", "origin", "main");
    writeFileSync(path.join(brain, "wire.json"), "2\n");
    run(brain, "commit", "-q", "-am", "the brain refreshed the wire");
    const mine = run(brain, "rev-parse", "HEAD");
    run(brain, "fetch", "-q", "origin", "main");
    assert.deepEqual(takeInOrigin(brain), { behind: 1, error: null });
    assert.equal(readFileSync(path.join(brain, "prompt.md"), "utf8"), "rule 9, with links\n");
    assert.equal(run(brain, "merge-base", "--is-ancestor", mine, "HEAD"), "");
    // The push that used to be rejected is now a fast-forward.
    run(brain, "push", "-q", "origin", "HEAD:main");
    assert.equal(run(brain, "rev-list", "--count", "origin/main..HEAD"), "0");
    // Nothing new: nothing to do.
    assert.deepEqual(takeInOrigin(brain), { behind: 0, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a conflict leaves the brain's checkout exactly as it was and says why", () => {
  const { dir, brain, other } = setup();
  try {
    writeFileSync(path.join(other, "wire.json"), "elsewhere\n");
    run(other, "commit", "-q", "-am", "elsewhere");
    run(other, "push", "-q", "origin", "main");
    writeFileSync(path.join(brain, "wire.json"), "here\n");
    run(brain, "commit", "-q", "-am", "here");
    const before = run(brain, "rev-parse", "HEAD");
    run(brain, "fetch", "-q", "origin", "main");
    const r = takeInOrigin(brain);
    assert.equal(r.behind, 1);
    assert.match(r.error ?? "", /conflict/i);
    assert.equal(run(brain, "rev-parse", "HEAD"), before);
    assert.equal(run(brain, "status", "--porcelain"), "");
    assert.equal(readFileSync(path.join(brain, "wire.json"), "utf8"), "here\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
