// One research session as the daemon runs it (ADMIN.md): pick the topic (the owner's, or the gap
// planner's), run the research and verifier roles without the tick lock, then publish what
// survived and ship under the lock, so an hour of model work never blocks the hourly tick.
//
//   pnpm brain session [--topic <slug>] [--focus "..."]
//
// Exit 0 when the session ran, 1 when it failed, 3 when there was nothing to research (every
// agenda topic waits for review); the daemon backs off an hour on 3.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RunSummary } from "@blocklore/core/control";
import { parse } from "yaml";
import { usageLedger } from "./agent.ts";
import { controlStore, readSettings } from "./control.ts";
import { ROOT, TICK_LOCK } from "./env.ts";
import { feedDone, feedEvent, feedNow, publicTopic } from "./feed.ts";
import { currentGaps, planResearch, researchTask, skippedTopics } from "./plan.ts";
import { agenda, researchRun } from "./research.ts";

export const NOTHING_TO_RESEARCH = 3;

/** Runs a brain command under the tick lock, waiting up to an hour for it, as the timers do. */
export function underLock(args: string[]): { code: number; out: string } {
  const r = spawnSync(
    "flock",
    [
      "-w",
      "3600",
      TICK_LOCK,
      process.execPath,
      "--env-file-if-exists=.env",
      "brain/cli.ts",
      ...args,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 2 * 3600_000, env: process.env },
  );
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** The ids of the claims a published run log says it published or revised. */
export function publishedIds(runId: string): string[] {
  const file = path.join(ROOT, "knowledge", "runs", runId.slice(0, 4), `${runId}.yaml`);
  if (!existsSync(file)) return [];
  const log = parse(readFileSync(file, "utf8")) as {
    published?: Array<{ id?: string } | string>;
    revised?: Array<{ id?: string } | string>;
  };
  return [...(log.published ?? []), ...(log.revised ?? [])].flatMap((x) =>
    typeof x === "string" ? [x] : x?.id ? [x.id] : [],
  );
}

/** What a published run log says it did, for the run list. */
export function runCounts(runId: string): { published: number; gated: number; rejected: number } {
  const file = path.join(ROOT, "knowledge", "runs", runId.slice(0, 4), `${runId}.yaml`);
  if (!existsSync(file)) return { published: 0, gated: 0, rejected: 0 };
  const log = parse(readFileSync(file, "utf8")) as {
    published?: unknown[];
    revised?: unknown[];
    gated?: Array<{ count?: number }>;
    rejected?: unknown[];
  };
  return {
    published: (log.published?.length ?? 0) + (log.revised?.length ?? 0),
    gated: (log.gated ?? []).reduce((n, g) => n + (g.count ?? 0), 0),
    rejected: log.rejected?.length ?? 0,
  };
}

/** Minutes a run's model sessions took, from the runner's usage ledger. */
export function runMinutes(runId: string): number {
  return usageLedger()
    .filter((l) => l.dir?.endsWith(`/${runId}`) || l.dir === runId)
    .reduce((n, l) => n + (l.minutes ?? 0), 0);
}

export async function session(opts: { topic: string | null; focus?: string }): Promise<number> {
  const control = controlStore();
  const settings = readSettings();
  const topics = agenda();
  const gaps = currentGaps();
  let slug = opts.topic;
  let task: string | undefined;
  if (slug) {
    const entry = topics.find((t) => t.slug === slug);
    if (!entry) throw new Error(`${slug} is not on the research agenda`);
    task = researchTask(
      entry.scope,
      gaps.topics.find((t) => t.slug === slug),
    );
  } else {
    const plan = planResearch(gaps, topics, skippedTopics(settings));
    if (!plan) {
      console.log(
        "RESULT: nothing to research: every agenda topic has claims waiting for review (approve or reject them, or let research work on them in settings)",
      );
      return NOTHING_TO_RESEARCH;
    }
    slug = plan.slug;
    task = plan.task;
  }

  const started = new Date().toISOString();
  let runId = "";
  const topic = publicTopic(slug);
  const about = topic ? `on ${topic.replace(/-/g, " ")}` : "on a new topic";
  feedNow("research", `Researching ${about}: reading primary sources, drafting facts`, topic);
  feedEvent({ kind: "research", text: `Started a research session ${about}`, topic });
  const summary = (status: RunSummary["status"], note: string): RunSummary => ({
    id: runId,
    kind: "daily",
    topic: slug as string,
    started,
    finished: new Date().toISOString(),
    status,
    minutes: runMinutes(runId),
    ...runCounts(runId),
    note: note.slice(0, 500),
  });
  try {
    const r = await researchRun(slug, {
      kind: "daily",
      task,
      focus: opts.focus,
      verify: true,
      publish: false,
    });
    runId = r.runId;
    feedEvent({
      kind: "verify",
      text: `Code checked every quote; the verifier tried to falsify what survived: ${r.passing} left`,
      topic,
      n: r.passing,
    });
    if (r.code !== 0 || r.passing === 0) {
      feedEvent({
        kind: "research",
        text: `Finished the session ${about}: nothing passed the checks, so nothing publishes`,
        topic,
        outcome: "failed",
      });
      feedDone();
      control.addSession(summary("failed", "no candidate passed the checks"));
      console.log(`RESULT: ${runId}: no candidate passed the checks; nothing to publish`);
      return 1;
    }
    const current = control.current();
    if (current) control.saveCurrent({ ...current, phase: "publishing" });
    control.addLive({
      at: new Date().toISOString(),
      run: runId,
      role: "pipeline",
      kind: "phase",
      text: "waiting for the lock, then publishing what survived; the gate holds what needs the owner",
    });
    const pub = underLock(["publish", runId]);
    const shipped = pub.code === 0 ? underLock(["ship"]) : { code: 1, out: "" };
    const counts = runCounts(runId);
    const note =
      pub.code !== 0
        ? `publish failed: ${pub.out.split("\n").slice(-3).join(" | ")}`
        : `${counts.published} published, ${counts.gated} held for review, ${counts.rejected} rejected; ${shipped.code === 0 ? shipped.out.split("\n").pop() : "ship failed"}`;
    control.addLive({
      at: new Date().toISOString(),
      run: runId,
      role: "pipeline",
      kind: "phase",
      text: note,
    });
    if (current) control.saveCurrent({ ...current, phase: pub.code === 0 ? "done" : "failed" });
    const ids = publishedIds(runId);
    if (ids.length)
      feedEvent({
        kind: "publish",
        text: `Published ${ids.length} new or revised fact${ids.length === 1 ? "" : "s"} ${about}`,
        topic,
        n: ids.length,
        claims: ids.slice(0, 40),
        outcome: "ok",
      });
    feedEvent({
      kind: "research",
      text: `Finished the session ${about}: ${counts.published} published, ${counts.gated} held for evaluation, ${counts.rejected} rejected`,
      topic,
      outcome: pub.code === 0 ? "ok" : "failed",
    });
    feedDone();
    control.addSession(summary(pub.code === 0 ? "done" : "failed", note));
    console.log(`RESULT: ${runId}: ${note}`);
    return pub.code === 0 ? 0 : 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cur = control.current();
    if (!runId && cur && cur.started >= started) runId = cur.run;
    if (runId) control.addSession(summary("failed", msg));
    feedDone();
    console.log(`RESULT: ${runId || slug}: ${msg}`);
    return 1;
  }
}
