// The loop (ARCHITECTURE.md, brain processes): one entry point the devbox timers call, so the
// schedule lives in systemd and what each tick does lives here. Every step runs even when an
// earlier one fails, and each leaves one JSON line in var/loop/<day>.jsonl. The units hold one lock
// (flock), so ticks never overlap.
//
//   hourly    ingest, the BIP index, snapshot proof upgrades, new queued questions; then ship
//   daily     recheck the stalest claims, snapshot when claims changed; then ship
//   weekly    the retrieval bench (free), published to the scorecard; then ship
//   research  one research run on the agenda topic with the most open gaps (brain/src/plan.ts;
//             paid; its timer is off by default)
//
// Ship: commit the wire, push what the steps committed, and deploy when the live site is behind:
// at once when claims, topics or snapshots changed, otherwise at most every 6 hours.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bench } from "./bench.ts";
import { refreshBips } from "./bips.ts";
import { ROOT, VAR } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { ingest } from "./ingest.ts";
import { currentGaps, pendingTopics, planResearch } from "./plan.ts";
import { queue } from "./queue.ts";
import { recheck } from "./recheck.ts";
import { agenda, research } from "./research.ts";
import { snapshot } from "./snapshot.ts";

const LOOP = path.join(VAR, "loop");
const STATE = path.join(LOOP, "state.json");
const SITE = process.env.BLOCKLORE_SITE || "https://blocklore.vercel.app";
const DEPLOY_EVERY_HOURS = 6;
/** Paths whose change sends a deploy at once rather than on the 6-hour cadence. */
const URGENT = [
  "knowledge/claims",
  "knowledge/topics",
  "knowledge/snapshots",
  "knowledge/rechecks.json",
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
  const res = await fetch(`${SITE}/api/v1`, { signal: AbortSignal.timeout(20_000) });
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

async function ship(): Promise<string> {
  commitAsOwner(
    ["knowledge/wire.json"],
    "Refresh the wire, so the Pulse shows what the brain's feeds saw upstream since the last deploy.",
    false,
  );
  git("fetch", "-q", "origin", "main");
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
        [
          "queue pull",
          async () => (process.env.QUEUE_PULL_TOKEN ? quiet(await queue(["pull"])) : "no token"),
        ],
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
        ["bench", async () => quiet(await bench({ ask: false, publish: true, commit: true }))],
        ["ship", ship],
      ];
    case "research":
      return [
        [
          "research",
          async () => {
            const plan = planResearch(currentGaps(), agenda(), pendingTopics());
            if (!plan) return "every agenda topic has claims waiting for the owner";
            const r = await research(plan.slug, {
              kind: "daily",
              task: plan.task,
              verify: true,
              publish: true,
            });
            return `${plan.slug} (gap score ${plan.score}): ${quiet(r) ?? "done"}`;
          },
        ],
        ["ship", ship],
      ];
  }
}

export async function tick(kind: string | undefined): Promise<number> {
  if (!TICKS.includes(kind as Tick)) throw new Error(`usage: brain tick <${TICKS.join(" | ")}>`);
  const t = kind as Tick;
  // The steps commit and push main. A checkout on another branch (a session at work) is left alone.
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") {
    record(t, "skip", true, 0, `the checkout is on ${branch}, not main`);
    return 0;
  }
  let failed = 0;
  for (const [name, run] of steps(t)) {
    const started = Date.now();
    try {
      const note = await run();
      record(t, name, true, Date.now() - started, typeof note === "string" ? note : "");
    } catch (e) {
      failed++;
      record(t, name, false, Date.now() - started, e instanceof Error ? e.message : String(e));
    }
  }
  return failed ? 1 : 0;
}
