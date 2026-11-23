// The brain daemon (ADMIN.md): the devbox's one long-running process. Each cycle it syncs with the
// site (state up, the owner's commands down), applies what came back, and starts work when the
// owner's schedule says so. It never exits on a bad sync; systemd restarts it if it dies.
//
//   pnpm brain daemon [--cycles N]
//
// Quick commands (ping, settings, lessons, stopping a session) apply in this process. Long ones run
// one at a time as `brain job <id>` children, so the sync and the live feed keep going during an
// hour-long research session.
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { EvaluatorView, type NostrView, sha256Hex } from "@blocklore/core";
import {
  applyPatch,
  type Command,
  type CommandResult,
  DaemonState,
  type Envelope,
  LIVE_KEEP,
  type ReviewItem,
  type Settings,
  SyncRequest,
  SyncResponse,
  verifyEnvelope,
} from "@blocklore/core/control";
import { NO_TOKEN } from "./agent.ts";
import {
  addLesson,
  type ControlStore,
  controlStore,
  type DaemonMemory,
  isoNow,
  type Job,
  newId,
  removeLesson,
} from "./control.ts";
import { ROOT, SITE, TICK_LOCK } from "./env.ts";
import { evaluatorSignature, evaluatorView, evaluatorWanted } from "./evaluator.ts";
import { buildFeed } from "./feed.ts";
import { LONG, needsLock } from "./jobs.ts";
import { channelLogStamp, channelState, nostrView } from "./nostr.ts";
import { publisherState } from "./orangecheck.ts";
import { choose } from "./review.ts";
import { embargoView, listEmbargo } from "./security/embargo.ts";
import { NOTHING_TO_RESEARCH } from "./session.ts";
import {
  agendaStatus,
  nextTimer,
  reviewItems,
  reviewSignature,
  runs,
  ticks,
  usage,
} from "./state.ts";
import { type Pending, readPending } from "./store.ts";
import { readEnvToken } from "./subscription.ts";

// --- the research schedule (pure) -----------------------------------------------------------------

export interface ScheduleInput {
  settings: Settings;
  now: Date;
  /** Research sessions started today (UTC), by anyone. */
  runsToday: number;
  /** When the last session ended. */
  lastFinished: string | null;
  /** The devbox has the owner's Claude subscription token. */
  token: boolean;
  /** A session is running or queued. */
  busy: boolean;
  memory: DaemonMemory;
}

export interface ScheduleDecision {
  start: boolean;
  at: string | null;
  why: string;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const midnightAfter = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();

/** Whether the schedule starts a research session now, and if not, when and why not. */
export function researchDecision(i: ScheduleInput): ScheduleDecision {
  const s = i.settings;
  const no = (at: string | null, why: string): ScheduleDecision => ({ start: false, at, why });
  if (s.paused) return no(null, "the owner paused the brain");
  if (s.research.mode === "off")
    return no(null, "research is off: sessions run only when the owner starts one");
  if (i.busy) return no(null, "a session is running");
  if (!i.token) return no(null, NO_TOKEN);
  if (i.runsToday >= s.research.maxRunsPerDay)
    return no(
      midnightAfter(i.now),
      `${i.runsToday} sessions today, the most the owner allows a day`,
    );
  if (i.memory.backoffUntil && Date.parse(i.memory.backoffUntil) > i.now.getTime())
    return no(i.memory.backoffUntil, i.memory.backoffWhy ?? "backing off");
  if (s.research.mode === "daily") {
    const today = dayOf(i.now);
    const at = new Date(
      Date.UTC(i.now.getUTCFullYear(), i.now.getUTCMonth(), i.now.getUTCDate(), s.research.dailyAt),
    );
    if (i.memory.lastDailyDay === today)
      return no(
        new Date(at.getTime() + 86_400_000).toISOString(),
        `today's session ran; daily at ${String(s.research.dailyAt).padStart(2, "0")}:00 UTC`,
      );
    if (i.now.getTime() < at.getTime())
      return no(at.toISOString(), `daily at ${String(s.research.dailyAt).padStart(2, "0")}:00 UTC`);
    return { start: true, at: i.now.toISOString(), why: "the daily session" };
  }
  if (i.lastFinished) {
    const ready = Date.parse(i.lastFinished) + s.research.restMinutes * 60_000;
    if (ready > i.now.getTime())
      return no(
        new Date(ready).toISOString(),
        `resting ${s.research.restMinutes} minutes between sessions`,
      );
  }
  return { start: true, at: i.now.toISOString(), why: "continuous research" };
}

/** The subscription as the admin shows it: the token, and a usage limit still in force. */
function subscriptionState(control: ControlStore, now: Date): DaemonState["subscription"] {
  const m = control.memory();
  const limited = !!m.limited && !!m.backoffUntil && Date.parse(m.backoffUntil) > now.getTime();
  return {
    token: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
    limitedUntil: limited ? m.backoffUntil : null,
    limitedWhy: limited ? m.backoffWhy : null,
  };
}

// --- commands --------------------------------------------------------------------------------------

export interface DispatchDeps {
  control: ControlStore;
  key: string;
  now: () => Date;
  /** The review queue as it is now, to refuse a stale decision before it is queued. */
  pending: () => Pending[];
  /** Stops the running research session; the message for the owner. */
  stopSession: () => { ok: boolean; message: string };
  host: string;
  head: () => string;
}

const result = (
  e: Pick<Envelope, "id"> & { cmd: { type: string } },
  ok: boolean,
  phase: CommandResult["phase"],
  message: string,
  now: Date,
): CommandResult => ({
  id: e.id,
  type: e.cmd.type,
  ok,
  phase,
  at: now.toISOString(),
  message: message.slice(0, 4000),
});

function describePatch(cmd: Extract<Command, { type: "settings" }>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cmd.patch))
    parts.push(
      typeof v === "object" && v !== null
        ? `${k}: ${Object.entries(v)
            .map(([a, b]) => `${a} ${JSON.stringify(b)}`)
            .join(", ")}`
        : `${k} ${JSON.stringify(v).slice(0, 80)}`,
    );
  return parts.join("; ") || "nothing";
}

/**
 * Verifies one command from the site and applies or queues it. Returns the results to send; a
 * command with a bad signature or a replay gets none (its id is the sender's to choose, so no
 * result is written under it), only a line in the daemon's log.
 */
export function dispatch(raw: unknown, d: DispatchDeps): CommandResult[] {
  const now = d.now();
  const v = verifyEnvelope(d.key, raw, now, (id) => d.control.seen(id));
  if (!v.ok) {
    console.error(`daemon: refused a command${v.id ? ` (${v.id})` : ""}: ${v.why}`);
    if (v.id && (v.why === "expired" || v.why === "dated in the future")) {
      const r = result(
        { id: v.id, cmd: { type: "unknown" } },
        false,
        "failed",
        `refused: ${v.why}`,
        now,
      );
      d.control.addResult(r);
      return [r];
    }
    return [];
  }
  const e = v.envelope;
  const cmd = e.cmd;
  d.control.markSeen(e.id, now);
  const done = (ok: boolean, message: string) => {
    const r = result(e, ok, ok ? "done" : "failed", message, now);
    d.control.addResult(r);
    return [r];
  };
  try {
    switch (cmd.type) {
      case "ping":
        return done(true, `pong from ${d.host} at ${d.head()}`);
      case "settings": {
        const next = applyPatch(d.control.settings(), cmd.patch);
        d.control.saveSettings(next);
        const extra =
          cmd.patch.paused === true ? " A running session finishes unless you stop it." : "";
        return done(true, `saved: ${describePatch(cmd)}.${extra}`);
      }
      case "lesson.add":
        d.control.saveSettings(
          addLesson(d.control.settings(), cmd.text, "owner", now.toISOString()),
        );
        return done(true, "lesson kept; every research session from now on reads it");
      case "lesson.remove":
        d.control.saveSettings(removeLesson(d.control.settings(), cmd.id));
        return done(true, "lesson removed");
      case "research.stop": {
        const s = d.stopSession();
        return done(s.ok, s.message);
      }
      case "nostr.post": {
        // The switch holds from this moment: a tick that starts now already reads it. The job
        // queued below brings the public record along and sends what waits.
        const s = d.control.settings();
        if (s.nostr.post !== cmd.on)
          d.control.saveSettings({
            ...s,
            nostr: { post: cmd.on, changed: now.toISOString().replace(/\.\d{3}Z$/, "Z") },
          });
        break;
      }
      default:
        break;
    }
    if (!LONG.has(cmd.type)) return done(false, `${cmd.type} is not something the daemon does`);
    if (cmd.type === "review.approve" || cmd.type === "review.reject") {
      const c = choose(d.pending(), cmd.items);
      if (!c.ok) return done(false, c.error);
    }
    const job: Job = {
      id: e.id,
      type: cmd.type,
      by: "owner",
      queued: now.toISOString(),
      started: null,
      pid: null,
    };
    d.control.writeJobCommand(job.id, cmd);
    d.control.saveJobs([...d.control.jobs(), job]);
    const ahead = d.control.jobs().filter((j) => j.id !== job.id).length;
    const r = result(
      e,
      true,
      "received",
      ahead ? `queued behind ${ahead} job(s)` : "received; starting",
      now,
    );
    d.control.addResult(r);
    return [r];
  } catch (err) {
    return done(false, err instanceof Error ? err.message : String(err));
  }
}

// --- the loop --------------------------------------------------------------------------------------

const tail = (s: string, lines = 12) => s.trim().split("\n").slice(-lines).join("\n");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the daemon does itself once a job succeeded (settings are the daemon's to write, never a
 * job's): a rejection's reason becomes a lesson when the owner asked. Returns words to append.
 */
export function afterJob(control: ControlStore, cmd: Command, at: string): string {
  const lesson =
    cmd.type === "claim.revoke"
      ? {
          text: `The owner revoked ${cmd.id}: ${cmd.reason}`.slice(0, 600),
          from: "revoke" as const,
        }
      : cmd.type === "review.reject" && cmd.lesson
        ? { text: cmd.reason, from: "review" as const }
        : null;
  if (!lesson) return "";
  try {
    control.saveSettings(addLesson(control.settings(), lesson.text, lesson.from, at));
    return "; the reason is now a lesson for future research";
  } catch (err) {
    return `; could not keep the lesson: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** The message a finished job leaves: its last RESULT line, else the tail of its output. */
export function jobMessage(out: string, code: number | null): string {
  const lines = out.trim().split("\n");
  const r = [...lines].reverse().find((l) => l.startsWith("RESULT: "));
  if (r) return r.slice("RESULT: ".length);
  return code === 0 ? tail(out, 3) || "done" : tail(out) || `exited ${code}`;
}

interface Running {
  job: Job;
  child: ChildProcess;
  out: string;
  stopped: boolean;
}

export async function daemon(opts: { cycles?: number } = {}): Promise<number> {
  const key = process.env.CONTROL_KEY ?? "";
  const token = process.env.BRAIN_SYNC_TOKEN ?? "";
  if (key.length < 32) throw new Error("CONTROL_KEY is not in .env (tools/env.sh makes it)");
  if (!token) throw new Error("BRAIN_SYNC_TOKEN is not in .env (tools/env.sh makes it)");
  // flock opens the lock file but not its folder; a fresh checkout has no var/loop yet.
  mkdirSync(path.dirname(TICK_LOCK), { recursive: true });
  const control = controlStore();
  const host = hostname();
  const started = isoNow();
  const head = () => {
    try {
      return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
    } catch {
      return "unknown";
    }
  };

  let running: Running | null = null;
  const outbox: CommandResult[] = [];
  let liveOffset = 0;
  let liveReset = true;
  let liveRun: string | null = control.current()?.run ?? null;
  let reviewSig: string | null = null;
  let reviewCache: ReviewItem[] = [];
  let reviewSent: string | null = null;
  let evaluatorSig: string | null = null;
  let evaluatorCache: EvaluatorView | null = null;
  let evaluatorSent: string | null = null;
  let embargoSent: string | null = null;
  let nostrCache: { at: number; key: string; value: NostrView | null } | null = null;
  let nostrSent: string | null = null;
  let agendaCache: { at: number; key: string; value: ReturnType<typeof agendaStatus> } | null =
    null;
  let liveBuild: { at: number; value: string | null } = { at: 0, value: null };
  const timerCache = new Map<string, { at: number; value: string | null }>();
  let watch = false;
  let failures = 0;

  // Jobs a previous daemon left running died with it (systemd stops the whole unit).
  const leftover = control.jobs();
  for (const j of leftover.filter((x) => x.started)) {
    const r: CommandResult = {
      id: j.id,
      type: j.type,
      ok: false,
      phase: "failed",
      at: isoNow(),
      message:
        "the daemon restarted while this ran; it did not finish. Start it again if it is still wanted.",
    };
    control.addResult(r);
    if (j.by === "owner") outbox.push(r);
    rmSync(path.join(control.paths.jobs, `${j.id}.json`), { force: true });
  }
  control.saveJobs(leftover.filter((x) => !x.started));
  const cur0 = control.current();
  if (cur0 && !["done", "failed", "stopped"].includes(cur0.phase) && !alive(cur0.pid))
    control.saveCurrent({ ...cur0, phase: "stopped" });

  const send = (r: CommandResult, owner: boolean) => {
    control.addResult(r);
    if (owner) outbox.push(r);
  };

  const stopSession = (): { ok: boolean; message: string } => {
    if (running?.job.type !== "research.start" && running?.job.type !== "evaluator.run")
      return { ok: true, message: "no research session was running" };
    const cur = control.current();
    if (cur?.phase === "publishing")
      return {
        ok: false,
        message:
          "the session is publishing what it verified; stopping now could leave half a commit, so it finishes in a moment",
      };
    running.stopped = true;
    const pid = running.child.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // already gone
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // gone
        }
      }, 15_000).unref();
    }
    return {
      ok: true,
      message: `stopping ${cur?.run ?? "the session"}; nothing it staged publishes`,
    };
  };

  const startNext = () => {
    if (running) return;
    const jobs = control.jobs();
    const job = jobs.find((j) => !j.started);
    if (!job) return;
    const node = [process.execPath, "--env-file-if-exists=.env", "brain/cli.ts", "job", job.id];
    const [cmd, ...args] = needsLock(job.type) ? ["flock", "-w", "3600", TICK_LOCK, ...node] : node;
    const child = spawn(cmd as string, args, {
      cwd: ROOT,
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const r: Running = {
      job: { ...job, started: isoNow(), pid: child.pid ?? null },
      child,
      out: "",
      stopped: false,
    };
    running = r;
    control.saveJobs(jobs.map((j) => (j.id === job.id ? r.job : j)));
    const take = (d: Buffer) => {
      r.out = (r.out + String(d)).slice(-20_000);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    send(
      { id: job.id, type: job.type, ok: true, phase: "running", at: isoNow(), message: "running" },
      job.by === "owner",
    );
    child.on("close", (code) => {
      running = null;
      control.saveJobs(control.jobs().filter((j) => j.id !== job.id));
      let cmdFile: Command | null = null;
      try {
        cmdFile = control.readJobCommand(job.id);
      } catch {
        cmdFile = null;
      }
      rmSync(path.join(control.paths.jobs, `${job.id}.json`), { force: true });
      let message = jobMessage(r.out, code);
      let ok = code === 0;
      // A connect or disconnect job rewrote .env; the daemon and the jobs it starts use it at once.
      if (job.type === "subscription.connect" || job.type === "subscription.disconnect") {
        const token = readEnvToken();
        if (token) process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
        else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      }
      if (job.type === "research.start") {
        const mem = control.memory();
        if (code === NOTHING_TO_RESEARCH) {
          ok = true;
          control.saveMemory({
            ...mem,
            backoffUntil: new Date(Date.now() + 3600_000).toISOString(),
            backoffWhy: message,
          });
        }
        const cur = control.current();
        if (r.stopped) {
          ok = true;
          message = `stopped by the owner${cur ? ` (${cur.run})` : ""}; nothing it staged was published`;
          if (cur) {
            control.saveCurrent({ ...cur, phase: "stopped" });
            control.addLive({
              at: isoNow(),
              run: cur.run,
              role: "pipeline",
              kind: "phase",
              text: message,
            });
          }
        }
        if (
          cur &&
          !control.sessions().some((s) => s.id === cur.run) &&
          cur.started >= (r.job.started ?? "")
        )
          control.addSession({
            id: cur.run,
            kind: "daily",
            topic: cur.topic,
            started: cur.started,
            finished: isoNow(),
            status: r.stopped ? "stopped" : ok ? "done" : "failed",
            minutes: 0,
            published: 0,
            gated: 0,
            rejected: 0,
            note: message.slice(0, 500),
          });
      }
      if (ok && cmdFile) message += afterJob(control, cmdFile, isoNow());
      send(
        {
          id: job.id,
          type: job.type,
          ok,
          phase: ok ? "done" : "failed",
          at: isoNow(),
          message: message.slice(0, 4000),
        },
        job.by === "owner",
      );
      startNext();
    });
  };

  const schedule = () => {
    const settings = control.settings();
    const now = new Date();
    const today = dayOf(now);
    const sessions = control.sessions();
    const cur = control.current();
    const session = (t: string) => t === "research.start" || t === "evaluator.run";
    const busy =
      session(running?.job.type ?? "") ||
      control.jobs().some((j) => session(j.type)) ||
      // a session someone started by hand (`pnpm brain research`)
      (!!cur && !["done", "failed", "stopped"].includes(cur.phase) && alive(cur.pid));
    const lastFinished =
      sessions
        .map((s) => s.finished)
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null;
    const runsToday = sessions.filter((s) => s.started.slice(0, 10) === today).length;
    const memory = control.memory();
    const d = researchDecision({
      settings,
      now,
      runsToday,
      lastFinished,
      token: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
      busy,
      memory,
    });
    if (d.start) {
      const id = `sched-${newId(8)}`;
      // A session slot evaluates the waiting claims first, when the evaluator decides and has work.
      const cmd: Command = evaluatorWanted(settings)
        ? { type: "evaluator.run" }
        : { type: "research.start", topic: null };
      control.writeJobCommand(id, cmd);
      control.saveJobs([
        ...control.jobs(),
        { id, type: cmd.type, by: "schedule", queued: isoNow(), started: null, pid: null },
      ]);
      if (settings.research.mode === "daily")
        control.saveMemory({ ...memory, lastDailyDay: today });
    }
    return { decision: d, runsToday };
  };

  const lockHeld = () =>
    spawnSync("flock", ["-n", "-E", "75", TICK_LOCK, "true"], { timeout: 3000 }).status === 75;

  const buildState = (sched: {
    decision: { at: string | null; why: string };
    runsToday: number;
  }) => {
    const settings = control.settings();
    const now = new Date();
    const h = head();
    const akey = `${h}|${reviewSig}|${settings.research.skipPending}`;
    if (!agendaCache || agendaCache.key !== akey || now.getTime() - agendaCache.at > 600_000)
      agendaCache = { at: now.getTime(), key: akey, value: agendaStatus(settings) };
    const cur = control.current();
    let activity: DaemonState["activity"] = {
      kind: settings.paused ? "paused" : "idle",
      label: settings.paused ? "paused by the owner" : "waiting",
      since: started,
      run: null,
    };
    if (running) {
      const t = running.job.type;
      const kind =
        t === "research.start"
          ? "research"
          : t === "evaluator.run"
            ? "evaluate"
            : t.startsWith("review") || t === "claim.revoke"
              ? "review"
              : t === "tick"
                ? "tick"
                : t === "ship"
                  ? "ship"
                  : "agenda";
      const label =
        kind === "research" && cur
          ? `research session on ${cur.topic}: ${cur.phase}`
          : kind === "evaluate"
            ? `evaluating the waiting claims${cur ? `: ${cur.phase}` : ""}`
            : `${t}${running.job.by === "schedule" ? " (scheduled)" : ""}`;
      activity = {
        kind,
        label,
        since: running.job.started ?? started,
        run: kind === "research" ? (cur?.run ?? null) : null,
      };
    } else if (lockHeld())
      activity = {
        kind: "tick",
        label: "a scheduled tick is running",
        since: now.toISOString(),
        run: null,
      };
    const timer = (t: "hourly" | "daily" | "weekly") => {
      const c = timerCache.get(t);
      if (c && now.getTime() - c.at < 300_000) return c.value;
      const value = nextTimer(t);
      timerCache.set(t, { at: now.getTime(), value });
      return value;
    };
    const state: DaemonState = {
      at: now.toISOString(),
      started,
      host,
      head: h,
      live: liveBuild.value,
      activity,
      settings,
      usage: usage(now),
      ticks: ticks(settings, now, timer),
      research: {
        runsToday: sched.runsToday,
        next: {
          at: sched.decision.at,
          topic: agendaCache.value.next,
          why: sched.decision.why,
        },
      },
      runs: runs(control),
      agenda: agendaCache.value.agenda,
      review: {
        count: reviewCache.length,
        topics: [
          ...reviewCache.reduce(
            (m, r) => m.set(r.topic, (m.get(r.topic) ?? 0) + 1),
            new Map<string, number>(),
          ),
        ].map(([topic, count]) => ({ topic, count })),
      },
      subscription: subscriptionState(control, now),
      orangecheck: publisherState(),
      results: control.results(30),
    };
    return state;
  };

  const refreshLiveBuild = async () => {
    if (Date.now() - liveBuild.at < 300_000) return;
    liveBuild = { at: Date.now(), value: liveBuild.value };
    try {
      const res = await fetch(`${SITE}/api/v1`, { signal: AbortSignal.timeout(10_000) });
      const body = (await res.json()) as { edition?: { build?: string } };
      liveBuild.value = res.ok ? (body.edition?.build ?? null) : null;
    } catch {
      // keep the last value
    }
  };

  const deps: DispatchDeps = {
    control,
    key,
    now: () => new Date(),
    pending: readPending,
    stopSession,
    host,
    head,
  };

  // flock needs the lock file's folder; a fresh checkout has none until a tick has run.
  mkdirSync(path.dirname(TICK_LOCK), { recursive: true });
  console.log(`daemon: syncing with ${SITE} (pid ${process.pid})`);
  for (let cycle = 0; opts.cycles === undefined || cycle < opts.cycles; cycle++) {
    let wait = watch ? 3000 : 20_000;
    try {
      const sched = schedule();
      startNext();
      await refreshLiveBuild();
      const sig = reviewSignature();
      if (sig !== reviewSig) {
        reviewCache = reviewItems();
        reviewSig = sig;
      }
      const reviewHash = sha256Hex(JSON.stringify(reviewCache));
      // Findings the disclosure gate keeps private: only the owner's admin ever sees them.
      const embargo = listEmbargo().map(embargoView);
      const embargoHash = sha256Hex(JSON.stringify(embargo));
      const cur = control.current();
      if (cur && cur.run !== liveRun) {
        liveRun = cur.run;
        liveReset = true;
        liveOffset = 0;
      }
      const live = control.liveSince(liveReset ? 0 : liveOffset);
      const state = buildState(sched);
      // Rebuilt when its files, the queue or HEAD change, and every 10 minutes (claims come due).
      const esig = `${evaluatorSignature(state.settings)}|${reviewSig}|${head()}`;
      if (esig !== evaluatorSig) {
        try {
          const v = EvaluatorView.safeParse(evaluatorView(state.settings, isoNow()));
          if (v.success) evaluatorCache = v.data;
          else
            console.error(
              `daemon: the evaluator's view is malformed: ${v.error.message.slice(0, 300)}`,
            );
        } catch (err) {
          console.error(`daemon: the evaluator's view failed: ${String(err).slice(0, 300)}`);
        }
        evaluatorSig = esig;
      }
      const evaluatorHash = sha256Hex(JSON.stringify({ ...evaluatorCache, at: null }));
      // The channel's preview: compiled from the store again when HEAD, the switch, the log or the
      // embargo change, and every 10 minutes (a day ends, a digest comes due).
      const nkey = `${head()}|${JSON.stringify(state.settings.nostr)}|${channelLogStamp()}|${embargoHash}`;
      if (!nostrCache || nostrCache.key !== nkey || Date.now() - nostrCache.at > 600_000) {
        try {
          nostrCache = { at: Date.now(), key: nkey, value: nostrView(channelState()) };
        } catch (err) {
          console.error(`daemon: the Nostr channel's view failed: ${String(err).slice(0, 300)}`);
          nostrCache = { at: Date.now(), key: nkey, value: null };
        }
      }
      const nostrHash = sha256Hex(JSON.stringify({ ...nostrCache.value, at: null }));
      const body = {
        state,
        review: reviewHash !== reviewSent ? reviewCache : null,
        embargo: embargoHash !== embargoSent ? embargo : null,
        live: live.events.slice(-LIVE_KEEP),
        liveReset: liveReset || live.reset,
        results: outbox.slice(0, 100),
        evaluator: evaluatorHash !== evaluatorSent ? evaluatorCache : null,
        feed: buildFeed(state, cur, new Date()),
        nostr: nostrHash !== nostrSent ? nostrCache.value : null,
      };
      const checked = SyncRequest.safeParse(body);
      if (!checked.success) {
        const st = DaemonState.safeParse(state);
        throw new Error(
          `the sync body does not match SyncRequest: ${JSON.stringify((st.success ? checked : st).error.issues.slice(0, 3))}`,
        );
      }
      const res = await fetch(`${SITE}/api/control/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(checked.data),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`sync: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const reply = SyncResponse.parse(await res.json());
      // What the site now holds.
      outbox.splice(0, body.results.length);
      reviewSent = reviewHash;
      evaluatorSent = evaluatorHash;
      embargoSent = embargoHash;
      nostrSent = nostrHash;
      liveOffset = live.offset;
      liveReset = false;
      watch = reply.watch;
      failures = 0;
      for (const raw of reply.commands) outbox.push(...dispatch(raw, deps));
      if (reply.commands.length) startNext();
      wait = reply.commands.length ? 500 : watch ? 3000 : 20_000;
    } catch (err) {
      failures++;
      wait = Math.min(60_000, 5000 * 2 ** Math.min(failures - 1, 4));
      console.error(
        `daemon: ${err instanceof Error ? err.message : String(err)}; retrying in ${wait / 1000} s`,
      );
    }
    if (opts.cycles !== undefined && cycle === opts.cycles - 1) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  // --cycles: let a job that just started report, then stop it with us.
  if (running) (running as Running).child.kill("SIGTERM");
  return 0;
}
