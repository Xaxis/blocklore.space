// The devbox's half of the control plane (ADMIN.md): what the owner set from the admin, and the
// daemon's own bookkeeping, all under var/control/ (or BLOCKLORE_CONTROL_DIR):
//
//   settings.json   Settings (core/src/control.ts); every tick, research run and budget check reads it
//   seen.json       ids of commands already applied, kept a day, so a replay does nothing
//   results.jsonl   every CommandResult the daemon produced, newest last
//   jobs.json       verified long commands waiting to run, and the one running
//   jobs/<id>.json  a job's command, read by `brain job <id>` in its own process
//   live.jsonl      LiveEvents of the current research session
//   current.json    the current research session: run id, phase, pid
//   sessions.jsonl  one line per research session the daemon ran
//   daemon.json     the scheduler's memory: the last daily run, back-off
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type Command,
  type CommandResult,
  DEFAULT_SETTINGS,
  type Lesson,
  type LiveEvent,
  type RunSummary,
  Settings,
} from "@blocklore/core/control";
import { CONTROL_DIR } from "./env.ts";

const SEEN_KEEP_MS = 24 * 3600 * 1000;

export const isoNow = () => new Date().toISOString();

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Writes through a temporary file and a rename, so a reader never sees half a file. */
export function writeJsonAtomic(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

function appendLine(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export interface Job {
  id: string;
  type: Command["type"];
  /** Queued by the owner's command, or by the research schedule. */
  by: "owner" | "schedule";
  queued: string;
  started: string | null;
  pid: number | null;
}

export interface Current {
  run: string;
  topic: string;
  started: string;
  phase: "research" | "repair" | "verify" | "publishing" | "done" | "failed" | "stopped";
  pid: number;
}

export interface DaemonMemory {
  /** The UTC day of the last scheduled daily session. */
  lastDailyDay: string | null;
  backoffUntil: string | null;
  backoffWhy: string | null;
}

/** The control folder's files, in one place, so tests can point it at a temporary folder. */
export function controlStore(dir = CONTROL_DIR) {
  const f = (name: string) => path.join(dir, name);
  return {
    dir,
    paths: {
      live: f("live.jsonl"),
      current: f("current.json"),
      jobs: f("jobs"),
    },

    /** The owner's settings; the defaults until the owner changes one. */
    settings(): Settings {
      const file = f("settings.json");
      if (!existsSync(file)) return DEFAULT_SETTINGS;
      const parsed = Settings.safeParse(readJson(file, null));
      if (parsed.success) return parsed.data;
      console.error(`control: ${file} does not match Settings; using the defaults`);
      return DEFAULT_SETTINGS;
    },
    hasSettings: () => existsSync(f("settings.json")),
    saveSettings(s: Settings) {
      writeJsonAtomic(f("settings.json"), Settings.parse(s));
    },

    seen(id: string): boolean {
      return id in readJson<Record<string, string>>(f("seen.json"), {});
    },
    markSeen(id: string, now: Date) {
      const seen = readJson<Record<string, string>>(f("seen.json"), {});
      const kept = Object.fromEntries(
        Object.entries(seen).filter(([, at]) => now.getTime() - Date.parse(at) < SEEN_KEEP_MS),
      );
      kept[id] = now.toISOString();
      writeJsonAtomic(f("seen.json"), kept);
    },

    addResult(r: CommandResult) {
      appendLine(f("results.jsonl"), r);
    },
    /** The latest result of each command, newest first. */
    results(limit = 30): CommandResult[] {
      const latest = new Map<string, CommandResult>();
      for (const r of readLines<CommandResult>(f("results.jsonl"))) {
        latest.delete(r.id);
        latest.set(r.id, r);
      }
      return [...latest.values()].reverse().slice(0, limit);
    },

    jobs: (): Job[] => readJson<Job[]>(f("jobs.json"), []),
    saveJobs: (jobs: Job[]) => writeJsonAtomic(f("jobs.json"), jobs),
    writeJobCommand(id: string, cmd: Command) {
      writeJsonAtomic(path.join(dir, "jobs", `${id}.json`), cmd);
    },
    readJobCommand(id: string): Command {
      if (!/^[0-9a-z-]{8,64}$/.test(id)) throw new Error(`not a job id: ${id}`);
      const file = path.join(dir, "jobs", `${id}.json`);
      if (!existsSync(file)) throw new Error(`no job ${id}`);
      return JSON.parse(readFileSync(file, "utf8")) as Command;
    },

    current: (): Current | null => readJson<Current | null>(f("current.json"), null),
    saveCurrent: (c: Current) => writeJsonAtomic(f("current.json"), c),

    /** Starts a new session's live feed: the old events go. */
    resetLive() {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(f("live.jsonl"), "", { mode: 0o600 });
    },
    addLive(e: LiveEvent) {
      appendLine(f("live.jsonl"), e);
    },
    /** Live events from a byte offset; the offset resets when the file was started over. */
    liveSince(offset: number): { events: LiveEvent[]; offset: number; reset: boolean } {
      const file = f("live.jsonl");
      if (!existsSync(file)) return { events: [], offset: 0, reset: offset > 0 };
      const size = statSync(file).size;
      const reset = size < offset;
      const from = reset ? 0 : offset;
      if (size === from) return { events: [], offset: from, reset };
      const text = readFileSync(file).subarray(from, size).toString("utf8");
      const end = text.lastIndexOf("\n") + 1;
      const events = text
        .slice(0, end)
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as LiveEvent];
          } catch {
            return [];
          }
        });
      return { events, offset: from + Buffer.byteLength(text.slice(0, end)), reset };
    },

    addSession: (s: RunSummary) => appendLine(f("sessions.jsonl"), s),
    sessions: (): RunSummary[] => readLines<RunSummary>(f("sessions.jsonl")),

    memory: (): DaemonMemory =>
      readJson<DaemonMemory>(f("daemon.json"), {
        lastDailyDay: null,
        backoffUntil: null,
        backoffWhy: null,
      }),
    saveMemory: (m: DaemonMemory) => writeJsonAtomic(f("daemon.json"), m),
  };
}
export type ControlStore = ReturnType<typeof controlStore>;

export const newId = (bytes = 8) => randomBytes(bytes).toString("hex");

export function addLesson(s: Settings, text: string, from: Lesson["from"], at: string): Settings {
  if (s.lessons.length >= 100)
    throw new Error("100 lessons is the most the brain keeps; remove one first");
  return Settings.parse({ ...s, lessons: [...s.lessons, { id: newId(), text, at, from }] });
}

export function removeLesson(s: Settings, id: string): Settings {
  if (!s.lessons.some((l) => l.id === id)) throw new Error(`no lesson ${id}`);
  return { ...s, lessons: s.lessons.filter((l) => l.id !== id) };
}

/** The owner's settings as the brain's processes read them (the default control folder). */
export function readSettings(): Settings {
  return controlStore().settings();
}
