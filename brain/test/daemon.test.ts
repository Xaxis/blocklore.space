import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  type Command,
  candidateHash,
  DEFAULT_SETTINGS,
  migrateSettings,
  type Settings,
  signCommand,
} from "@blocklore/core/control";
import { parse as parseYaml } from "yaml";
import { condense, limitsFor, parseResult, roleCredential, usageLimit } from "../src/agent.ts";
import { controlStore } from "../src/control.ts";
import {
  afterJob,
  type DispatchDeps,
  dispatch,
  jobMessage,
  researchDecision,
  slotFor,
} from "../src/daemon.ts";
import { editAgenda, formatYaml } from "../src/jobs.ts";
import { ownerNotes } from "../src/plan.ts";
import { choose } from "../src/review.ts";
import { lastTick, nextFromTimers } from "../src/state.ts";
import type { Pending } from "../src/store.ts";
import { tickSkip } from "../src/tick.ts";

const KEY = "c".repeat(64);
const NOW = new Date("2026-11-21T12:00:00.000Z");
let n = 0;
const envelope = (cmd: Command, at = "2026-11-21T11:59:30.000Z") =>
  signCommand(KEY, {
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    at,
    by: "owner@example.com",
    cmd,
  });

const pendingItem = (id: string, statement: string): Pending =>
  ({
    candidate: { id, statement, topics: ["covenants"] },
    reasons: ["contested topic"],
    run: "2026-11-20-seed-covenants",
    proposed: { time: "2026-11-20T18:00:00Z", height: 976700 },
    verdict: { id, verdict: "accept", reason: "the quotes support it" },
    method: "quotes found",
    updates: false,
  }) as unknown as Pending;

function setup(pending: Pending[] = []) {
  const control = controlStore(mkdtempSync(path.join(tmpdir(), "bl-control-")));
  const stopped: string[] = [];
  const deps: DispatchDeps = {
    control,
    key: KEY,
    now: () => NOW,
    pending: () => pending,
    stopSession: () => {
      stopped.push("stop");
      return { ok: true, message: "stopping" };
    },
    host: "devbox",
    head: () => "abc123",
  };
  return { control, deps, stopped };
}

test("a forged, expired or replayed command does nothing", () => {
  const { control, deps } = setup();
  const good = envelope({ type: "settings", patch: { paused: true } });
  const forged = { ...good, cmd: { type: "settings", patch: { paused: false } } };
  assert.deepEqual(dispatch(forged, deps), []);
  assert.equal(control.settings().paused, false);
  assert.deepEqual(dispatch({ id: "x", hello: 1 }, deps), []);

  const old = envelope({ type: "ping" }, "2026-11-21T11:30:00.000Z");
  const [expired] = dispatch(old, deps);
  assert.equal(expired?.ok, false);
  assert.match(expired?.message ?? "", /expired/);

  const [first] = dispatch(good, deps);
  assert.equal(first?.phase, "done");
  assert.equal(control.settings().paused, true);
  assert.deepEqual(dispatch(good, deps), [], "a replay writes no result");
});

test("settings and lessons persist, and a patch outside the schema is never applied", () => {
  const { control, deps } = setup();
  const [r] = dispatch(
    envelope({
      type: "settings",
      patch: { research: { mode: "continuous" }, usage: { sessionMinutes: 40 } },
    }),
    deps,
  );
  assert.equal(r?.ok, true);
  const s = controlStore(control.dir).settings();
  assert.equal(s.research.mode, "continuous");
  assert.equal(s.usage.sessionMinutes, 40);
  assert.equal(s.research.model, DEFAULT_SETTINGS.research.model);
  dispatch(
    envelope({ type: "lesson.add", text: "Cite BIP text, not blog posts, for consensus rules." }),
    deps,
  );
  const lessons = control.settings().lessons;
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0]?.from, "owner");
  dispatch(envelope({ type: "lesson.remove", id: lessons[0]?.id as string }), deps);
  assert.equal(control.settings().lessons.length, 0);
  const bad = dispatch(
    envelope({ type: "settings", patch: { usage: { sessionMinutes: 5000 } } }),
    deps,
  );
  assert.equal(bad.length, 0, "a patch outside the schema is malformed and never applied");
  assert.equal(control.settings().usage.sessionMinutes, 40);
  const api = dispatch(
    envelope({ type: "settings", patch: { budget: { dailyUsd: 25 } } as never }),
    deps,
  );
  assert.equal(api.length, 0, "the old dollar budget is no longer a setting");
});

test("a review decision must name each claim as the owner saw it", () => {
  const a = pendingItem("covenants.ctv", "CTV is BIP 119.");
  const b = pendingItem("covenants.apo", "APO is BIP 118.");
  const { control, deps } = setup([a, b]);
  const items = [
    { id: a.candidate.id, hash: candidateHash(a.candidate) },
    { id: b.candidate.id, hash: candidateHash({ ...b.candidate, statement: "APO is BIP 118!" }) },
  ];
  const [r] = dispatch(envelope({ type: "review.approve", items }), deps);
  assert.equal(r?.ok, false);
  assert.match(r?.message ?? "", /changed since you looked: covenants\.apo/);
  assert.deepEqual(control.jobs(), [], "nothing is queued");

  const gone = choose([a], [{ id: "covenants.apo", hash: candidateHash(b.candidate) }]);
  assert.equal(gone.ok, false);
  assert.match((gone as { error: string }).error, /no longer waiting/);

  const fresh = items.map((i, k) => (k === 1 ? { ...i, hash: candidateHash(b.candidate) } : i));
  const [ok] = dispatch(
    envelope({ type: "review.reject", items: fresh, reason: "Too speculative.", lesson: true }),
    deps,
  );
  assert.equal(ok?.phase, "received");
  const [job] = control.jobs();
  assert.equal(job?.type, "review.reject");
  const cmd = control.readJobCommand(job?.id as string);
  assert.equal(cmd.type === "review.reject" && cmd.lesson, true);
  // once the job succeeded, the daemon keeps the reason as a lesson
  assert.match(afterJob(control, cmd, NOW.toISOString()), /now a lesson/);
  assert.deepEqual(
    control.settings().lessons.map((l) => [l.from, l.text]),
    [["review", "Too speculative."]],
  );
  assert.equal(afterJob(control, { type: "ship" }, NOW.toISOString()), "");
});

test("stopping a session is quick; long commands queue as jobs", () => {
  const { control, deps, stopped } = setup();
  const [s] = dispatch(envelope({ type: "research.stop" }), deps);
  assert.equal(s?.phase, "done");
  assert.deepEqual(stopped, ["stop"]);
  dispatch(envelope({ type: "research.start", topic: "lightning", focus: "splicing" }), deps);
  const [t] = dispatch(envelope({ type: "tick", tick: "daily" }), deps);
  assert.match(t?.message ?? "", /queued behind 1/);
  assert.deepEqual(
    control.jobs().map((j) => j.type),
    ["research.start", "tick"],
  );
  const results = readFileSync(path.join(control.dir, "results.jsonl"), "utf8");
  assert.equal(results.trim().split("\n").length, 3);
});

const settings = (patch: Partial<Settings["research"]> = {}, paused = false): Settings => ({
  ...DEFAULT_SETTINGS,
  paused,
  research: { ...DEFAULT_SETTINGS.research, ...patch },
});
const base = {
  now: NOW,
  runsToday: 0,
  lastFinished: null,
  token: true,
  busy: false,
  memory: { lastDailyDay: null, backoffUntil: null, backoffWhy: null },
};

test("the schedule follows the owner: paused, off, daily at an hour, continuous with rest and limits", () => {
  assert.equal(
    researchDecision({ ...base, settings: settings({ mode: "continuous" }, true) }).start,
    false,
  );
  assert.match(
    researchDecision({ ...base, settings: settings({ mode: "off" }) }).why,
    /research is off/,
  );

  const daily = settings({ mode: "daily", dailyAt: 14 });
  const early = researchDecision({ ...base, settings: daily });
  assert.deepEqual([early.start, early.at], [false, "2026-11-21T14:00:00.000Z"]);
  assert.equal(
    researchDecision({ ...base, settings: settings({ mode: "daily", dailyAt: 6 }) }).start,
    true,
  );
  const ran = researchDecision({
    ...base,
    settings: settings({ mode: "daily", dailyAt: 6 }),
    memory: { ...base.memory, lastDailyDay: "2026-11-21" },
  });
  assert.deepEqual([ran.start, ran.at], [false, "2026-11-22T06:00:00.000Z"]);

  const cont = settings({ mode: "continuous", restMinutes: 30, maxRunsPerDay: 4 });
  assert.equal(researchDecision({ ...base, settings: cont }).start, true);
  const resting = researchDecision({
    ...base,
    settings: cont,
    lastFinished: "2026-11-21T11:45:00.000Z",
  });
  assert.deepEqual([resting.start, resting.at], [false, "2026-11-21T12:15:00.000Z"]);
  assert.equal(
    researchDecision({ ...base, settings: cont, lastFinished: "2026-11-21T11:00:00.000Z" }).start,
    true,
  );
  const maxed = researchDecision({ ...base, settings: cont, runsToday: 4 });
  assert.deepEqual([maxed.start, maxed.at], [false, "2026-11-22T00:00:00.000Z"]);
  const tokenless = researchDecision({ ...base, settings: cont, token: false });
  assert.equal(tokenless.start, false, "no session starts without the subscription token");
  assert.match(tokenless.why, /subscription token/);
  assert.equal(researchDecision({ ...base, settings: cont, busy: true }).start, false);
  const backoff = researchDecision({
    ...base,
    settings: cont,
    memory: {
      ...base.memory,
      backoffUntil: "2026-11-21T12:30:00.000Z",
      backoffWhy: "nothing to research",
    },
  });
  assert.deepEqual([backoff.start, backoff.why], [false, "nothing to research"]);
});

test("the evaluator and research take turns while both have work, so a backlog never starves research", () => {
  // Four slots a day with 65 claims waiting used to be four evaluator runs a day and no research.
  const both = { evaluatorDue: true, researchNext: "transactions" };
  const kinds: string[] = [];
  let last: string | null = "evaluate";
  for (let i = 0; i < 4; i++) {
    const slot = slotFor({ ...both, lastKind: last });
    kinds.push(slot);
    last = slot === "evaluate" ? "evaluate" : "daily";
  }
  assert.deepEqual(kinds, ["research", "evaluate", "research", "evaluate"]);
  // With nothing due for the evaluator, every slot is research; with no topic, every slot evaluates.
  assert.equal(slotFor({ evaluatorDue: false, researchNext: null, lastKind: "daily" }), "research");
  assert.equal(
    slotFor({ evaluatorDue: true, researchNext: null, lastKind: "evaluate" }),
    "evaluate",
  );
  // A fresh daemon with no sessions yet starts with the backlog.
  assert.equal(slotFor({ ...both, lastKind: null }), "evaluate");
});

test("the live feed condenses a real stream: a line per tool call, message and result", () => {
  const stream = readFileSync(path.join(import.meta.dirname, "data", "stream.jsonl"), "utf8");
  const events = stream
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => condense(l, "2026-11-21-daily-probe", "research", NOW.toISOString()));
  assert.deepEqual(
    events.map((e) => [e.kind, e.text]),
    [
      ["tool", "Read /var/tmp/blocklore/staging/2026-11-21-daily-probe/note.txt"],
      ["text", "satoshi"],
      ["result", "research success: 2 turns"],
    ],
  );
  const r = parseResult(stream);
  assert.deepEqual([r.ok, r.result, r.turns, r.subtype], [true, "satoshi", 2, "success"]);
  assert.equal(parseResult("not json\n").subtype, "unparseable");
  const long = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "WebFetch", input: { url: `https://x.org/${"a".repeat(900)}` } },
      ],
    },
  });
  assert.equal(condense(long, "r", "research", NOW.toISOString())[0]?.text.length, 600);
});

test("the owner's notes are labeled as the owner's, lessons first, and absent when empty", () => {
  assert.deepEqual(ownerNotes([], "  "), []);
  const lines = ownerNotes(
    [
      {
        id: "a1b2c3d4",
        text: "Prefer BIP text over blogs.",
        at: NOW.toISOString(),
        from: "review",
      },
    ],
    "Lightning splicing",
    "BOLT 2 changes",
  );
  assert.equal(lines[0], "## Notes from the owner");
  assert.match(lines.join("\n"), /owner's own words/);
  const text = lines.join("\n");
  assert.ok(text.indexOf("Prefer BIP text") < text.indexOf("Lightning splicing"));
  assert.ok(text.includes("- BOLT 2 changes"));
});

test("sessions run only on the subscription token, never on an API key", () => {
  assert.deepEqual(roleCredential({ CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" }), {
    CLAUDE_CODE_OAUTH_TOKEN: "t",
  });
  assert.throws(() => roleCredential({ ANTHROPIC_API_KEY: "k" }), /subscription token/);
  const lim = limitsFor("research", {
    ...settings(),
    usage: { sessionMinutes: 30, sessionTurns: 60 },
  });
  assert.deepEqual([lim.maxTurns, lim.timeoutMs], [60, 30 * 60_000]);
});

test("a session stopped by the plan's usage limit backs model work off until the reset", () => {
  const ended = (result: string) => ({
    ok: false,
    result,
    turns: 3,
    denials: 0,
    subtype: "error_during_execution",
  });
  const reset = Math.floor(NOW.getTime() / 1000) + 7200;
  assert.deepEqual(usageLimit(ended(`Claude AI usage limit reached|${reset}`), NOW), {
    until: new Date(reset * 1000).toISOString(),
    why: "Claude AI usage limit reached",
  });
  const plain = usageLimit(ended("5-hour limit reached, resets 3pm"), NOW);
  assert.equal(plain?.until, new Date(NOW.getTime() + 3_600_000).toISOString());
  assert.equal(usageLimit(ended("the verifier wrote no verdicts"), NOW), null);
  assert.equal(usageLimit({ ...ended("usage limit reached"), ok: true }, NOW), null);
});

test("saved settings from before the subscription switch keep the owner's choices", () => {
  const old = {
    ...DEFAULT_SETTINGS,
    paused: true,
    research: { ...DEFAULT_SETTINGS.research, mode: "daily", credential: "api" },
    budget: { dailyUsd: 25, perRunUsd: 6 },
  };
  const s = migrateSettings(old);
  assert.equal(s?.paused, true);
  assert.equal(s?.research.mode, "daily");
  assert.equal("credential" in (s?.research ?? {}), false);
  assert.deepEqual(s?.usage, DEFAULT_SETTINGS.usage);
  assert.equal(migrateSettings({ research: { mode: "sometimes" } }), null);
  assert.equal(migrateSettings("nope"), null);
});

test("ticks skip when the owner paused the brain or turned one off, unless forced", () => {
  const off = { ...settings(), ticks: { hourly: false, daily: true, weekly: true } };
  assert.match(tickSkip("hourly", off, false) ?? "", /turned the hourly tick off/);
  assert.equal(tickSkip("daily", off, false), null);
  assert.match(tickSkip("daily", settings({}, true), false) ?? "", /paused/);
  assert.equal(tickSkip("hourly", { ...off, paused: true }, true), null);
});

test("agenda edits keep the file's comments and order", () => {
  const text =
    "# the owner's file\ntopics:\n  - slug: a\n    title: A topic\n    group: g\n    scope: >-\n      Scope of a.\n  - slug: b\n    title: B\n    group: g\n    scope: Scope of b.\n";
  const scope = "What the topic covers, in more than twenty characters.";
  const added = editAgenda(text, { save: { slug: "c", title: "C topic", group: "g", scope } });
  assert.match(added.text, /^# the owner's file/);
  assert.match(added.message, /Add C topic/);
  assert.ok(added.text.indexOf("slug: b") < added.text.indexOf("slug: c"));
  const changed = editAgenda(added.text, {
    save: { slug: "a", title: "A topic", group: "g", scope },
  });
  assert.match(changed.message, /Change/);
  assert.ok(changed.text.indexOf("slug: a") < changed.text.indexOf("slug: b"));
  const removed = editAgenda(changed.text, { remove: "b" });
  assert.ok(!removed.text.includes("slug: b"));
  assert.throws(() => editAgenda(text, { remove: "zz" }), /not on the agenda/);
});

test("an agenda edit lands the file exactly as lint formats it", () => {
  // The real agenda, its last topic taken off and put back the way the admin's job does both.
  const file = path.join(import.meta.dirname, "..", "agenda", "seed.yaml");
  const seed = readFileSync(file, "utf8");
  const doc = parseYaml(seed) as {
    topics: { slug: string; title: string; group: string; scope: string }[];
  };
  const last = doc.topics.at(-1);
  assert.ok(last && last.scope.length > 100, "the last topic has a scope long enough to wrap");
  const removed = formatYaml(editAgenda(seed, { remove: last.slug }).text, file);
  const back = formatYaml(editAgenda(removed, { save: last }).text, file);
  assert.equal(back, seed);
  // Without the formatter the yaml library wraps long scopes its own way, which lint rejects.
  assert.notEqual(editAgenda(removed, { save: last }).text, seed);
});

test("a tick's last run starts at its first step; a job's message is its RESULT line", () => {
  const line = (at: string, step: string, ok = true) => ({
    at,
    tick: "hourly",
    step,
    ok,
    ms: 5,
    note: "",
  });
  const last = lastTick(
    [
      line("2026-11-21T10:00:00Z", "ingest"),
      line("2026-11-21T10:01:00Z", "ship", false),
      line("2026-11-21T11:00:00Z", "ingest"),
      line("2026-11-21T11:02:00Z", "ship"),
    ],
    "hourly",
  );
  assert.deepEqual([last?.at, last?.ok, last?.steps.length], ["2026-11-21T11:02:00Z", true, 2]);
  assert.equal(lastTick([], "daily"), null);
  assert.equal(jobMessage("noise\nRESULT: published 2 claim(s)\nmore", 0), "published 2 claim(s)");
  assert.equal(jobMessage("a\nb\nboom", 1), "a\nb\nboom");
});

test("the next tick comes from systemd's JSON in UTC, whatever the machine's time zone", () => {
  const json = JSON.stringify([
    { next: 1795298409289472, unit: "blocklore-tick-hourly.timer" },
    { next: 0, unit: "blocklore-tick-weekly.timer" },
  ]);
  assert.equal(nextFromTimers(json, "blocklore-tick-hourly.timer"), "2026-11-21T22:00:09.289Z");
  assert.equal(nextFromTimers(json, "blocklore-tick-weekly.timer"), null);
  assert.equal(nextFromTimers(json, "blocklore-tick-daily.timer"), null);
  assert.equal(nextFromTimers("Failed to connect to bus", "blocklore-tick-hourly.timer"), null);
});
