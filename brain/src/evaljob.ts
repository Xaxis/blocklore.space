// One evaluator session as the daemon runs it (`evaluator.run`, from the research schedule or the
// owner's button; ADMIN.md): batch after batch, each one's model steps without the tick lock and
// its apply under it, then one ship, as a research session does. Also the `pnpm brain evaluate`
// command.
//
// A session used to be one batch. Research drafts 20 to 40 claims a session on a topic the gate
// marks, the evaluator took 8 a session and the two shared the day's slots, so the queue only grew:
// 157 claims waited on 2026-11-26 while the brain sat idle 21 hours of the day. A session now keeps
// going while claims are due and the next batch fits in the minutes the owner gives one session
// (usage.sessionMinutes), so the queue drains inside the owner's own limits, with no setting to
// change. It stops early on anything another batch would only repeat: a verifier that could not
// run, publishing paused by the calibration, a batch that did not apply, the owner pausing.
//
//   pnpm brain evaluate               the evaluator's state, calibration and recent decisions
//   pnpm brain evaluate run           one session now (runs the verifier models)
//   pnpm brain evaluate apply <batch> publish what a batch passed (the job runs it under the lock)

import type { Settings } from "@blocklore/core/control";
import { chainSource } from "./chain.ts";
import { checkClaim } from "./check.ts";
import { type Current, controlStore, readSettings } from "./control.ts";
import {
  applyBatch,
  type BatchOutcome,
  defaultDeps,
  type EvaluatorDeps,
  evaluateBatch,
  evaluatorFiles,
  evaluatorView,
  publishDecisions,
  WAITING,
} from "./evaluator.ts";
import { feedDone, feedNow } from "./feed.ts";
import { runMinutes, underLock } from "./session.ts";
import { nowStamp } from "./store.ts";

const last = (out: string) =>
  out
    .trim()
    .split("\n")
    .pop()
    ?.replace(/^RESULT: /, "") ?? "";

/**
 * Why a session stops after the batch it just ran, or null to run another. `elapsed` is the
 * session's minutes so far and `longest` its longest batch, so the next one is expected to finish
 * inside the owner's minutes for a session.
 */
export function stopAfter(i: {
  settings: Settings;
  outcome: BatchOutcome;
  applied: boolean;
  elapsed: number;
  longest: number;
}): string | null {
  const o = i.outcome;
  if (!o.batch) return o.message;
  if (!i.applied) return "the batch did not apply";
  if (o.trouble) return o.trouble;
  if (!o.publishing) return "publishing is paused, so another batch would only hold claims";
  if (i.settings.paused) return "the owner paused the brain";
  if (i.settings.evaluator.decides !== "evaluator") return "the owner now decides gated claims";
  const cap = i.settings.usage.sessionMinutes;
  if (i.elapsed + i.longest > cap)
    return `another batch would not finish inside the ${cap} minutes a session may take`;
  return null;
}

/** What a session runs on: the evaluator's own dependencies, the tick lock, Nostr. */
export interface JobDeps {
  evaluator: (say: (text: string) => void) => EvaluatorDeps;
  /** Runs a brain command under the tick lock (session.ts's underLock). */
  lock: (args: string[]) => { code: number; out: string };
  decisions: () => Promise<string | undefined>;
}

function jobDeps(): JobDeps {
  const chain = chainSource();
  return {
    evaluator: (say) =>
      defaultDeps(
        (c) => checkClaim(c, chain),
        () => nowStamp(chain),
        readSettings,
        say,
      ),
    lock: underLock,
    decisions: () => publishDecisions(),
  };
}

export async function evaluateJob(
  j: JobDeps = jobDeps(),
): Promise<{ code: number; message: string }> {
  const settings = readSettings();
  if (settings.evaluator.decides === "owner")
    return { code: 0, message: "the owner decides gated claims; nothing was evaluated" };
  const control = controlStore();
  const started = new Date().toISOString();
  const run = `evaluator-${started.slice(0, 19).replace(/[^0-9]/g, "")}`;
  const say = (text: string) =>
    control.addLive({ at: new Date().toISOString(), run, role: "evaluator", kind: "phase", text });
  const deps = j.evaluator(say);
  if (!deps.modelReady()) return { code: 0, message: WAITING };
  control.resetLive();
  const current: Current = {
    run,
    topic: "the evaluator",
    started,
    phase: "verify",
    pid: process.pid,
  };
  control.saveCurrent(current);
  const notes: string[] = [];
  const batches: string[] = [];
  let applied = 0;
  let code = 0;
  let stop = "";
  feedNow(
    "evaluate",
    "The evaluator is checking waiting claims: sources again, the rules, two verifiers",
  );
  try {
    let longest = 0;
    for (;;) {
      const t0 = Date.now();
      control.saveCurrent({ ...current, phase: "verify" });
      const r = await evaluateBatch(deps);
      say(r.message);
      let ok = false;
      if (r.batch) {
        batches.push(r.batch);
        control.saveCurrent({ ...current, phase: "publishing" });
        say("applying the batch under the lock: deterministic code publishes what passed");
        const a = j.lock(["evaluate", "apply", r.batch]);
        ok = a.code === 0;
        if (ok) applied++;
        else {
          code = a.code;
          notes.push(`${r.batch} apply failed: ${last(a.out)}`);
        }
      }
      longest = Math.max(longest, (Date.now() - t0) / 60_000);
      const why = stopAfter({
        settings: readSettings(),
        outcome: r,
        applied: ok,
        elapsed: (Date.now() - Date.parse(started)) / 60_000,
        longest,
      });
      if (why) {
        stop = why;
        break;
      }
      say(`another batch: claims are still due and one fits in this session's minutes`);
    }
    if (applied > 0) {
      control.saveCurrent({ ...current, phase: "publishing" });
      const shipped = j.lock(["ship"]);
      notes.push(last(shipped.out));
      const nostr = await j
        .decisions()
        .catch((e) => `decisions not on Nostr: ${e instanceof Error ? e.message : String(e)}`);
      if (nostr) notes.push(nostr);
    }
  } catch (e) {
    code = 1;
    stop = `the evaluator failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  feedDone();
  control.saveCurrent({ ...current, phase: code === 0 ? "done" : "failed" });
  const files = evaluatorFiles();
  const items = batches.flatMap((b) => files.readBatch(b).items);
  const count = (o: string) => items.filter((i) => i.outcome === o).length;
  const note = batches.length
    ? [
        `${batches.length} ${batches.length === 1 ? "batch" : "batches"} (${batches.join(", ")}): ${count("publish")} to publish, ${count("hold")} held, ${count("reject")} rejected`,
        `stopped: ${stop}`,
        ...notes,
      ].join("; ")
    : stop;
  say(note);
  const first = batches[0];
  if (first)
    control.addSession({
      id: first,
      kind: "evaluate",
      topic: "the evaluator",
      started,
      finished: new Date().toISOString(),
      status: code === 0 ? "done" : "failed",
      minutes:
        Math.round(
          batches.reduce((m, b) => m + runMinutes(`${b}-a`) + runMinutes(`${b}-b`), 0) * 10,
        ) / 10,
      published: count("publish"),
      gated: count("hold"),
      rejected: count("reject"),
      note: note.slice(0, 500),
    });
  return { code, message: note };
}

export async function evaluateCli(args: string[]): Promise<number> {
  const [sub, id] = args;
  if (sub === "apply") {
    if (!id) throw new Error("usage: brain evaluate apply <batch>");
    const r = applyBatch(
      id,
      await nowStamp(chainSource()),
      { commit: true, push: false },
      readSettings(),
    );
    console.log(`RESULT: ${r.message}`);
    return r.code;
  }
  if (sub === "run") {
    const r = await evaluateJob();
    console.log(`RESULT: ${r.message}`);
    return r.code;
  }
  const v = evaluatorView(readSettings(), new Date().toISOString());
  console.log(`${v.state}: ${v.why}`);
  console.log(`${v.backlog} waiting, ${v.due} due now`);
  const c = v.calibration;
  console.log(
    `canaries: ${c.recentCaught} of ${c.recent} recent caught (threshold ${Math.round(c.threshold * 100)} percent), ${c.caught} of ${c.total} in all`,
  );
  for (const d of v.decisions.slice(0, 20))
    console.log(`${d.at}  ${d.outcome.padEnd(7)} ${d.canary ? "[canary] " : ""}${d.id}  ${d.why}`);
  return 0;
}
