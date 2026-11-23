// What the daemon tells the admin (ADMIN.md): the review queue as ReviewItems, spend, the ticks,
// the research runs and the agenda, each read from the files the brain already keeps.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Check } from "@blocklore/core";
import {
  type AgendaStatus,
  candidateHash,
  type DaemonState,
  type ReviewItem,
  type RunSummary,
  type Settings,
  type TickStatus,
} from "@blocklore/core/control";
import { loadStore } from "@blocklore/core/node";
import { parse } from "yaml";
import type { z } from "zod";
import { usageLedger } from "./agent.ts";
import type { ControlStore } from "./control.ts";
import { REVIEW, ROOT, VAR } from "./env.ts";
import { currentGaps, planResearch, skippedTopics, UNSTARTED } from "./plan.ts";
import { agenda } from "./research.ts";
import { runCounts, runMinutes } from "./session.ts";
import { type Pending, readPending } from "./store.ts";

type TickRow = z.infer<typeof TickStatus>;
type Tick = TickRow["tick"];
type Agenda = z.infer<typeof AgendaStatus>;

const iso = (t: number | string | Date) => new Date(t).toISOString();

/** A readable line for a machine check, as the admin lists it. */
export function checkLine(k: Check): string {
  switch (k.type) {
    case "chain.block-hash":
      return `block ${k.height} has hash ${k.expect}`;
    case "chain.subsidy":
      return `the subsidy at block ${k.height} is ${k.expect_sats} sats`;
    case "chain.header":
      return `block ${k.height} header ${k.field} is ${k.expect}`;
    case "code.contains":
      return `${k.repo} at ${k.ref.slice(0, 12)}: ${k.path} contains "${k.text}"`;
    default:
      return JSON.stringify(k);
  }
}

export function reviewItem(p: Pending, published: string | null, held: string | null): ReviewItem {
  const c = p.candidate;
  return {
    id: c.id,
    hash: candidateHash(c),
    topic: c.topics[0] as string,
    statement: c.statement,
    kind: c.kind,
    depth: c.depth,
    status: c.status,
    confidence: c.confidence,
    reasons: p.reasons,
    run: p.run,
    method: p.method,
    before: p.updates ? published : null,
    attributed: (c.attributed_to ?? []).map((a) => ({ name: a.name, url: a.url ?? null })),
    verdict: { verdict: p.verdict.verdict, reason: p.verdict.reason },
    sources: c.sources.map((s) => ({
      tier: s.tier,
      kind: s.kind,
      title: s.title,
      url: s.url ?? null,
      locator: s.locator,
      quote: s.quote ?? null,
    })),
    checks: (c.checks ?? []).map(checkLine),
    held,
  };
}

/** A cheap fingerprint of the review folder, so the queue is rebuilt only when it changed. */
export function reviewSignature(): string {
  const dir = path.join(REVIEW, "claims");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => `${f}:${statSync(path.join(dir, f)).mtimeMs}`)
    .join("|");
}

export function reviewItems(): ReviewItem[] {
  const dir = path.join(REVIEW, "claims");
  const pending = readPending();
  if (!pending.length) return [];
  const claims = new Map(loadStore().store.claims.map((c) => [c.id, c.statement]));
  return pending.map((p) => {
    const f = path.join(dir, `${p.candidate.id}.yaml`);
    const held = existsSync(f) ? iso(statSync(f).mtimeMs) : null;
    return reviewItem(p, claims.get(p.candidate.id) ?? null, held);
  });
}

/** Model sessions today and over the last 14 days, from the runner's usage ledger. */
export function usage(now: Date): DaemonState["usage"] {
  const lines = usageLedger();
  const days: DaemonState["usage"]["days"] = [];
  for (let i = 13; i >= 0; i--) {
    const day = iso(now.getTime() - i * 86_400_000).slice(0, 10);
    const on = lines.filter((l) => l.day === day);
    days.push({
      day,
      sessions: on.length,
      minutes: on.reduce((n, l) => n + (l.minutes ?? 0), 0),
    });
  }
  const today = lines.filter((l) => l.day === days[days.length - 1]?.day);
  return {
    today: {
      sessions: today.length,
      minutes: today.reduce((n, l) => n + (l.minutes ?? 0), 0),
      turns: today.reduce((n, l) => n + (l.turns ?? 0), 0),
    },
    days,
  };
}

interface LoopLine {
  at: string;
  tick: string;
  step: string;
  ok: boolean;
  ms: number;
  note: string;
}

const FIRST_STEP: Record<Tick, string> = { hourly: "ingest", daily: "recheck", weekly: "bench" };

/** The last run of a tick: its lines from the step that starts it (or a skip) to the end. */
export function lastTick(lines: LoopLine[], t: Tick): TickRow["last"] {
  const mine = lines.filter((l) => l.tick === t);
  let start = -1;
  for (let i = mine.length - 1; i >= 0; i--) {
    const step = mine[i]?.step;
    if (step === FIRST_STEP[t] || step === "skip") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const run = mine.slice(start);
  return {
    at: (run[run.length - 1] as LoopLine).at,
    ok: run.every((l) => l.ok),
    steps: run.map((l) => ({ step: l.step, ok: l.ok, ms: l.ms, note: l.note })),
  };
}

function loopLines(now: Date): LoopLine[] {
  const dir = path.join(VAR, "loop");
  const out: LoopLine[] = [];
  for (let i = 8; i >= 0; i--) {
    const f = path.join(dir, `${iso(now.getTime() - i * 86_400_000).slice(0, 10)}.jsonl`);
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, "utf8").split("\n"))
      if (l.trim())
        try {
          out.push(JSON.parse(l) as LoopLine);
        } catch {
          // a torn line
        }
  }
  return out;
}

/**
 * When systemd next fires a tick's timer; null without systemd or the unit. Read as JSON, whose
 * `next` is microseconds since the epoch: `systemctl show` prints local time and ignores
 * --timestamp=utc, so parsing its text broke on any machine not set to UTC.
 */
export function nextTimer(t: Tick): string | null {
  const unit = `blocklore-tick-${t}.timer`;
  const r = spawnSync("systemctl", ["--user", "list-timers", "--all", "--output=json", unit], {
    encoding: "utf8",
    timeout: 5000,
  });
  return nextFromTimers(r.stdout ?? "", unit);
}

/** The `next` of one unit in `systemctl list-timers --output=json`, as an ISO time; else null. */
export function nextFromTimers(json: string, unit: string): string | null {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const row = rows.find((x) => (x as { unit?: unknown })?.unit === unit) as
    | { next?: unknown }
    | undefined;
  const us = row?.next;
  return typeof us === "number" && us > 0 ? new Date(Math.floor(us / 1000)).toISOString() : null;
}

export function ticks(s: Settings, now: Date, next: (t: Tick) => string | null): TickRow[] {
  const lines = loopLines(now);
  return (["hourly", "daily", "weekly"] as const).map((t) => ({
    tick: t,
    enabled: s.ticks[t] && !s.paused,
    last: lastTick(lines, t),
    next: s.ticks[t] && !s.paused ? next(t) : null,
  }));
}

const RESEARCH_KINDS = new Set(["seed", "daily", "queue"]);

/** Research runs, newest first: the daemon's sessions, then the published run logs before them. */
export function runs(control: ControlStore, limit = 30): RunSummary[] {
  const byId = new Map<string, RunSummary>();
  const dir = path.join(ROOT, "knowledge", "runs");
  if (existsSync(dir))
    for (const year of readdirSync(dir))
      for (const f of readdirSync(path.join(dir, year)).filter((x) => x.endsWith(".yaml"))) {
        const log = parse(readFileSync(path.join(dir, year, f), "utf8")) as {
          id?: string;
          kind?: string;
          started?: { time?: string };
          finished?: { time?: string };
          summary?: string;
        };
        if (!log.id || !RESEARCH_KINDS.has(log.kind ?? "")) continue;
        const topic = log.id
          .replace(/^\d{4}-\d{2}-\d{2}-(seed|daily|queue)-/, "")
          .replace(/-\d+$/, "");
        byId.set(log.id, {
          id: log.id,
          kind: log.kind as string,
          topic,
          started: iso(log.started?.time ?? 0),
          finished: log.finished?.time ? iso(log.finished.time) : null,
          status: "done",
          minutes: runMinutes(log.id),
          ...runCounts(log.id),
          note: (log.summary ?? "").slice(0, 300),
        });
      }
  for (const s of control.sessions()) if (s.id) byId.set(s.id, s);
  const cur = control.current();
  if (cur && !["done", "failed", "stopped"].includes(cur.phase) && !byId.has(cur.run))
    byId.set(cur.run, {
      id: cur.run,
      kind: "daily",
      topic: cur.topic,
      started: cur.started,
      finished: null,
      status: "running",
      minutes: runMinutes(cur.run),
      published: 0,
      gated: 0,
      rejected: 0,
      note: `phase: ${cur.phase}`,
    });
  return [...byId.values()].sort((a, b) => b.started.localeCompare(a.started)).slice(0, limit);
}

/** The agenda with each topic's gap score and counts, and the topic research would take next. */
export function agendaStatus(s: Settings): { agenda: Agenda[]; next: string | null } {
  const gaps = currentGaps();
  const pending = new Map<string, number>();
  for (const p of readPending()) {
    const t = p.candidate.topics[0] as string;
    pending.set(t, (pending.get(t) ?? 0) + 1);
  }
  const topics = agenda();
  const list = topics.map((t) => {
    const g = gaps.topics.find((x) => x.slug === t.slug);
    return {
      slug: t.slug,
      title: t.title,
      group: t.group,
      scope: t.scope,
      claims: g?.claims ?? 0,
      pending: pending.get(t.slug) ?? 0,
      score: g?.score ?? UNSTARTED,
    };
  });
  return { agenda: list, next: planResearch(gaps, topics, skippedTopics(s))?.slug ?? null };
}
