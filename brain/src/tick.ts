// The loop (ARCHITECTURE.md, brain processes): one entry point the devbox timers call, so the
// schedule lives in systemd and what each tick does lives here. Every step runs even when an
// earlier one fails, and each leaves one JSON line in var/loop/<day>.jsonl. The units hold one lock
// (flock), so ticks never overlap.
//
//   hourly    ingest, the BIP index, snapshot proof upgrades, the OrangeCheck records to Nostr, new
//             queued questions, reader reports (each reported claim rechecked, the outcome sent
//             back), the security watches that are due, the Nostr channel's notes (only while the
//             owner has posting on); then ship
//   daily     recheck the stalest claims, snapshot when claims changed; then ship
//   weekly    the retrieval bench (free), published to knowledge/bench.json; the security lab
//             (Bitcoin Core's own tests in regtest, under heavy); then ship
//   research  one research run on the agenda topic with the most open gaps (brain/src/plan.ts;
//             paid). No timer: the daemon schedules research sessions as the owner set in the
//             admin (ADMIN.md); this tick stays for a run by hand.
//
// Each tick reads the owner's settings first and skips (one "skip" line) when the owner paused
// the brain or turned that tick off; `--force` (a tick the owner starts from the admin) runs anyway.
//
// Ship: commit the wire, push what the steps committed, and deploy when the live site is behind:
// at once when claims, topics or snapshots changed, otherwise at most every 6 hours.
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Settings } from "@blocklore/core/control";
import type { Activity } from "@blocklore/core/feed";
import { bench } from "./bench.ts";
import { refreshBips } from "./bips.ts";
import { readSettings } from "./control.ts";
import { KNOWLEDGE, ROOT, SITE, SITE_HEADERS, VAR } from "./env.ts";
import { feedDone, feedEvent, feedNow } from "./feed.ts";
import { commitAsOwner, takeInOrigin } from "./git.ts";
import { ingest } from "./ingest.ts";
import { nostrChannelStep } from "./nostr.ts";
import { nostrStep } from "./orangecheck.ts";
import {
  currentGaps,
  pendingClaims,
  planResearch,
  researchTargets,
  skippedTopics,
} from "./plan.ts";
import { queue } from "./queue.ts";
import { recheck } from "./recheck.ts";
import { markResearched, runReports } from "./reports.ts";
import { agenda, researchRun } from "./research.ts";
import { lab } from "./security/lab.ts";
import { watch } from "./security/watches.ts";
import { publishedIds } from "./session.ts";
import { snapshot } from "./snapshot.ts";

const LOOP = path.join(VAR, "loop");
const STATE = path.join(LOOP, "state.json");
const DEPLOY_EVERY_HOURS = 6;
/** Paths whose change sends a deploy at once rather than on the 6-hour cadence. */
const URGENT = [
  "knowledge/claims",
  "knowledge/topics",
  "knowledge/snapshots",
  "knowledge/rechecks.json",
  // The Nostr channel's switch: NIP-05 and the Follow link should follow the owner at once.
  "knowledge/nostr.json",
];

export const TICKS = ["hourly", "daily", "weekly", "research"] as const;
export type Tick = (typeof TICKS)[number];

interface State {
  deployedAt?: string;
}

const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const writeState = (s: State) => {
  mkdirSync(LOOP, { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(s, null, 2)}\n`);
};

function record(tick: Tick, step: string, ok: boolean, ms: number, note = "") {
  mkdirSync(LOOP, { recursive: true });
  const at = new Date().toISOString();
  const line = { at, tick, step, ok, ms, note: note.slice(0, 500) };
  appendFileSync(path.join(LOOP, `${at.slice(0, 10)}.jsonl`), `${JSON.stringify(line)}\n`);
  console.log(`[${tick}] ${ok ? "ok  " : "FAIL"} ${step} (${ms} ms)${note ? `: ${note}` : ""}`);
}

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 120_000 }).trim();

/** The commit the live site was built from, as its API reports it. */
async function liveBuild(): Promise<string> {
  const res = await fetch(`${SITE}/api/v1`, {
    headers: SITE_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as { edition?: { build?: string } };
  const build = body.edition?.build;
  if (!res.ok || !build) throw new Error(`${SITE}/api/v1 did not report a build`);
  return build;
}

/** Whether the deploy should go now, and why; pure so the rule is tested. */
export function deployDecision(opts: {
  head: string;
  live: string;
  urgentChanged: boolean;
  deployedAt?: string;
  now: Date;
}): { deploy: boolean; why: string } {
  if (opts.head.startsWith(opts.live) || opts.live.startsWith(opts.head))
    return { deploy: false, why: `live is ${opts.live}, HEAD` };
  if (opts.urgentChanged) return { deploy: true, why: "claims, topics or snapshots changed" };
  const since = opts.deployedAt
    ? (opts.now.getTime() - Date.parse(opts.deployedAt)) / 3_600_000
    : Number.POSITIVE_INFINITY;
  return since >= DEPLOY_EVERY_HOURS
    ? { deploy: true, why: `${DEPLOY_EVERY_HOURS} hours since the last deploy` }
    : {
        deploy: false,
        why: `only the wire or the index changed, ${since.toFixed(1)} h since the last deploy`,
      };
}

/** Commits the wire, pushes, and deploys when the live site is behind (the `ship` command too). */
export async function ship(): Promise<string> {
  // Ship pushes HEAD to main; from any other branch (a worktree, a session at work) it would push
  // that branch over main, so it refuses, as the ticks do.
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") return `not shipped: the checkout is on ${branch}, not main`;
  commitAsOwner(
    ["knowledge/wire.json"],
    "Refresh the wire, so the Pulse shows what the brain's feeds saw upstream since the last deploy.",
    false,
  );
  git("fetch", "-q", "origin", "main");
  const taken = takeInOrigin();
  if (taken.error)
    return `not shipped: ${taken.behind} commits on GitHub do not merge into this checkout (${taken.error}); a person merges them`;
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (ahead > 0) git("push", "-q", "origin", "HEAD:main");
  const head = git("rev-parse", "HEAD");
  const live = await liveBuild();
  let urgentChanged = true;
  try {
    urgentChanged = git("diff", "--name-only", `${live}..${head}`, "--", ...URGENT) !== "";
  } catch {
    // The live build is not in this history (a fresh clone); treat it as urgent.
  }
  const state = readState();
  const d = deployDecision({
    head,
    live,
    urgentChanged,
    deployedAt: state.deployedAt,
    now: new Date(),
  });
  if (!d.deploy) return `pushed ${ahead}; no deploy (${d.why})`;
  const r = spawnSync(path.join(ROOT, "tools", "deploy.sh"), [], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20 * 60_000,
  });
  if (r.status !== 0)
    throw new Error(
      `deploy failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`,
    );
  writeState({ ...state, deployedAt: new Date().toISOString() });
  return `pushed ${ahead}; deployed ${head.slice(0, 7)} (${d.why})`;
}

type Step = [name: string, run: () => Promise<number | string | undefined>];

/** What each step looks like on the public feed while it runs (brain/src/feed.ts). */
const STEP_FEED: Record<string, { kind: Activity; now: string }> = {
  ingest: { kind: "ingest", now: "Reading the upstream feeds: code, mailing lists, forums, BIPs" },
  bips: { kind: "ingest", now: "Reading the BIP index for status changes" },
  "snapshot upgrade": {
    kind: "snapshot",
    now: "Completing the Bitcoin timestamps of past editions",
  },
  "queue pull": { kind: "ingest", now: "Collecting the questions readers suggested" },
  reports: { kind: "recheck", now: "Rechecking the claims readers reported against their sources" },
  recheck: {
    kind: "recheck",
    now: "Checking the least recently verified facts against their sources",
  },
  snapshot: { kind: "snapshot", now: "Sealing this edition of the store in a Bitcoin block" },
  bench: { kind: "recheck", now: "Measuring how well search finds what the store knows" },
  research: { kind: "research", now: "Researching the topic with the most open gaps" },
  watch: {
    kind: "watch",
    now: "Reading the security watches: pools, block times, difficulty, reorgs",
  },
  lab: { kind: "lab", now: "Replaying known attacks against the newest Bitcoin Core in regtest" },
  ship: { kind: "publish", now: "Publishing the new edition" },
};

/** The newest snapshot's number and block, to tell when a step sealed a new edition. */
function latestSnapshot(): { n: number; height: number } | null {
  try {
    const dir = path.join(KNOWLEDGE, "snapshots");
    const n = Math.max(
      0,
      ...readdirSync(dir)
        .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
        .filter((x): x is string => !!x)
        .map(Number),
    );
    if (!n) return null;
    const j = JSON.parse(readFileSync(path.join(dir, `${n}.json`), "utf8")) as {
      at?: { height?: number };
    };
    return { n, height: j.at?.height ?? 0 };
  } catch {
    return null;
  }
}

/** Feed events for the steps that do not record their own (ingest and recheck do). */
function stepEvent(name: string, note: string, before: { n: number } | null) {
  if (name === "snapshot") {
    const after = latestSnapshot();
    if (after && after.n !== before?.n)
      feedEvent({
        kind: "snapshot",
        text: `Sealed edition ${after.n} of the store in Bitcoin block ${after.height}`,
        outcome: "ok",
      });
  } else if (name === "ship" && note.includes("deployed")) {
    feedEvent({ kind: "publish", text: "Published a new edition of the site", outcome: "ok" });
  } else if (name === "bench") {
    feedEvent({
      kind: "recheck",
      text: "Measured how well search finds the facts behind 200 known questions",
      outcome: "ok",
    });
  }
}

function steps(tick: Tick): Step[] {
  const quiet = (n: number) => (n === 0 ? undefined : `exit ${n}`);
  switch (tick) {
    case "hourly":
      return [
        ["ingest", async () => quiet(await ingest({ force: false }))],
        ["bips", async () => quiet(await refreshBips({ commit: true, push: false }))],
        [
          "snapshot upgrade",
          async () => quiet(await snapshot({ commit: true, push: false, upgrade: true })),
        ],
        ["nostr", nostrStep],
        [
          "queue pull",
          async () => (process.env.QUEUE_PULL_TOKEN ? quiet(await queue(["pull"])) : "no token"),
        ],
        [
          "reports",
          async () =>
            process.env.QUEUE_PULL_TOKEN
              ? await runReports({ limit: 10, commit: true, push: false })
              : "no token",
        ],
        ["watch", async () => quiet(await watch({ force: false, commit: true, push: false }))],
        ["nostr channel", nostrChannelStep],
        ["ship", ship],
      ];
    case "daily":
      return [
        [
          "recheck",
          async () => {
            const n = await recheck({ limit: 30, commit: true, push: false });
            return n
              ? "some claims no longer hold as cited (see knowledge/rechecks.json)"
              : undefined;
          },
        ],
        [
          "snapshot",
          async () => quiet(await snapshot({ commit: true, push: false, upgrade: false })),
        ],
        ["ship", ship],
      ];
    case "weekly":
      return [
        ["bench", async () => quiet(await bench({ publish: true, commit: true }))],
        ["lab", async () => quiet(await lab({ publish: true, commit: true, push: false }))],
        ["ship", ship],
      ];
    case "research":
      return [
        [
          "research",
          async () => {
            const plan = planResearch(currentGaps(), agenda(), skippedTopics(), researchTargets());
            if (!plan) return "every agenda topic has claims waiting for the owner";
            const r = await researchRun(plan.slug, {
              kind: "daily",
              task: plan.task,
              verify: true,
              publish: true,
            });
            const said = plan.targets.length
              ? `; ${await markResearched(plan.targets, {
                  id: r.runId,
                  published: r.code === 0 && r.passing > 0,
                  changed: new Set(publishedIds(r.runId)),
                  pending: pendingClaims(),
                })}`
              : "";
            return `${plan.slug} (gap score ${plan.score}): ${quiet(r.code) ?? "done"}${said}`;
          },
        ],
        ["ship", ship],
      ];
  }
}

/**
 * Why a tick should not run under the owner's settings, or null when it should. A tick the owner
 * starts from the admin (force) runs even when its timer is off or the brain is paused.
 */
export function tickSkip(t: Tick, s: Settings, force: boolean): string | null {
  if (force) return null;
  if (s.paused) return "the owner paused the brain";
  if (t !== "research" && !s.ticks[t]) return `the owner turned the ${t} tick off`;
  return null;
}

export async function tick(kind: string | undefined, force = false): Promise<number> {
  if (!TICKS.includes(kind as Tick)) throw new Error(`usage: brain tick <${TICKS.join(" | ")}>`);
  const t = kind as Tick;
  const skip = tickSkip(t, readSettings(), force);
  if (skip) {
    record(t, "skip", true, 0, skip);
    return 0;
  }
  // The steps commit and push main. A checkout on another branch (a session at work) is left alone.
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") {
    record(t, "skip", true, 0, `the checkout is on ${branch}, not main`);
    return 0;
  }
  let failed = 0;
  for (const [name, run] of steps(t)) {
    const started = Date.now();
    const step = STEP_FEED[name];
    if (step) feedNow(step.kind, step.now);
    const before = latestSnapshot();
    try {
      const note = await run();
      record(t, name, true, Date.now() - started, typeof note === "string" ? note : "");
      stepEvent(name, typeof note === "string" ? note : "", before);
    } catch (e) {
      failed++;
      record(t, name, false, Date.now() - started, e instanceof Error ? e.message : String(e));
    }
  }
  feedDone();
  return failed ? 1 : 0;
}
