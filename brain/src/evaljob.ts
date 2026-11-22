// One evaluation batch as the daemon runs it (`evaluator.run`, from the research schedule or the
// owner's button; ADMIN.md): the model steps without the tick lock, then apply and ship under it,
// as a research session does. Also the `pnpm brain evaluate` command.
//
//   pnpm brain evaluate               the evaluator's state, calibration and recent decisions
//   pnpm brain evaluate run           one batch now (runs the verifier models)
//   pnpm brain evaluate apply <batch> publish what a batch passed (the job runs it under the lock)
import { chainSource } from "./chain.ts";
import { checkClaim } from "./check.ts";
import { type Current, controlStore, readSettings } from "./control.ts";
import {
  applyBatch,
  defaultDeps,
  evaluateBatch,
  evaluatorFiles,
  evaluatorView,
  modelReady,
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

export async function evaluateJob(): Promise<{ code: number; message: string }> {
  const settings = readSettings();
  if (settings.evaluator.decides === "owner")
    return { code: 0, message: "the owner decides gated claims; nothing was evaluated" };
  if (!modelReady()) return { code: 0, message: WAITING };
  const control = controlStore();
  const chain = chainSource();
  const started = new Date().toISOString();
  const run = `evaluator-${started.slice(0, 19).replace(/[^0-9]/g, "")}`;
  control.resetLive();
  const current: Current = {
    run,
    topic: "the evaluator",
    started,
    phase: "verify",
    pid: process.pid,
  };
  control.saveCurrent(current);
  const say = (text: string) =>
    control.addLive({ at: new Date().toISOString(), run, role: "evaluator", kind: "phase", text });
  let note = "";
  let code = 0;
  let batch: string | null = null;
  feedNow(
    "evaluate",
    "The evaluator is checking waiting claims: sources again, the rules, two verifiers",
  );
  try {
    const r = await evaluateBatch(
      defaultDeps(
        (c) => checkClaim(c, chain),
        () => nowStamp(chain),
        readSettings,
        say,
      ),
    );
    batch = r.batch;
    note = r.message;
    say(r.message);
    if (batch) {
      control.saveCurrent({ ...current, phase: "publishing" });
      say("applying the batch under the lock: deterministic code publishes what passed");
      const applied = underLock(["evaluate", "apply", batch]);
      code = applied.code;
      const shipped = code === 0 ? underLock(["ship"]) : null;
      note = `${note}; ${code === 0 ? last(applied.out) : `apply failed: ${last(applied.out)}`}${shipped ? `; ${last(shipped.out)}` : ""}`;
      say(note);
    }
  } catch (e) {
    code = 1;
    note = `the evaluator failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  feedDone();
  control.saveCurrent({ ...current, phase: code === 0 ? "done" : "failed" });
  if (batch) {
    const b = evaluatorFiles().readBatch(batch);
    control.addSession({
      id: batch,
      kind: "evaluate",
      topic: "the evaluator",
      started,
      finished: new Date().toISOString(),
      status: code === 0 ? "done" : "failed",
      minutes: Math.round((runMinutes(`${batch}-a`) + runMinutes(`${batch}-b`)) * 10) / 10,
      published: b.items.filter((i) => i.outcome === "publish").length,
      gated: b.items.filter((i) => i.outcome === "hold").length,
      rejected: b.items.filter((i) => i.outcome === "reject").length,
      note: note.slice(0, 500),
    });
  }
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
