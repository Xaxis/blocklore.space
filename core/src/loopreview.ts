// The weekly review of the loop (BACKLOG 31): what the brain did in one week, counted from its own
// records, and what in it the owner should look at. On 2026-11-23 the owner found that no research
// had run for three days while every session went to the evaluator, and nothing had said so. This
// is the code that says so.
//
// Each finding is a fixed code, its numbers and the ids of its evidence. One the owner can act on
// carries a proposal: one of the admin's existing commands (core/src/control.ts), with a label built
// by code. The admin shows it as a button and never sends it by itself; a finding no command fits
// has no proposal. Thresholds are the named constants below.
//
// The weekly tick compiles the week that just ended (brain/src/loopreview.ts) into
// var/loop/reviews/<week>.json, and the daemon carries the latest one to the admin. Private: it
// holds evaluator detail, so it never enters the bundle or any public route.
//
// Pure: the week, the moment it is compiled and every record come in as arguments.
import { z } from "zod";
import type { Command, RunSummary, Settings } from "./control.ts";
import {
  brokenRules,
  type Decision,
  EVALUATOR_RULES,
  type EvaluatorRule,
  heldBack,
  RULE_TEXT,
} from "./evaluate.ts";
import type { ReportItem } from "./report.ts";
import type { Rechecks, Run } from "./schema.ts";

export const DAY_MS = 86_400_000;
/** No research session for longer than this many days is a finding. */
export const RESEARCH_GAP_DAYS = 2;
/** An agenda topic with no research session in this many days is stale. */
export const STALE_TOPIC_DAYS = 14;
/** A structural rule broken by this many claims in the week is a finding. */
export const RULE_BROKEN_AT = 3;
/** A source whose quote failed this many times in the week (on different claims or days). */
export const QUOTE_FAILED_AT = 2;
/** A reader report still open this many days after it was first filed is a finding. */
export const REPORT_OPEN_DAYS = 7;
/** A gated claim waiting longer than this many days for a decision is a finding. */
export const QUEUE_WAIT_DAYS = 3;
/** Evidence ids kept per finding; its numbers carry the whole count. */
export const EVIDENCE_KEPT = 12;
/** Test claims a proposal adds to each batch after one slipped through. */
export const CANARY_STEP = 2;
/** The most test claims a batch may have (EvaluatorSettings.canaries). */
const MAX_CANARIES = 10;

/** Report statuses that still wait on the brain or the owner (core/src/report.ts). */
const OPEN_REPORTS: ReadonlySet<ReportItem["status"]> = new Set([
  "received",
  "failed",
  "researching",
]);
const RESEARCH_RUNS: ReadonlySet<string> = new Set(["seed", "daily", "queue"]);

export const FINDING_CODES = [
  "research.starved",
  "evaluator.canary-missed",
  "queue.waiting",
  "recheck.failed",
  "reports.open",
  "rule.broken",
  "source.quote-failing",
  "agenda.stale",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

/**
 * How much a finding weighs: its code's base, plus up to 9 for its size, so findings order by kind
 * first and by size within a kind.
 */
const BASE_WEIGHT: Record<FindingCode, number> = {
  "research.starved": 90,
  "evaluator.canary-missed": 80,
  "queue.waiting": 70,
  "recheck.failed": 60,
  "reports.open": 50,
  "rule.broken": 40,
  "source.quote-failing": 30,
  "agenda.stale": 20,
};

/** Why research went without a session, as far as the records say. */
export const STARVED_CAUSES = [
  "paused",
  "no-subscription",
  "research-off",
  "every-topic-waits",
  "evaluator-took-the-slots",
] as const;
export type StarvedCause = (typeof STARVED_CAUSES)[number];

/**
 * What a piece of evidence is, so the admin links it to the page that shows it: a research
 * session (its run id), an evaluator batch, a claim the evaluator decided, an agenda topic, a
 * published claim, a claim waiting for a decision, a reader report, or a source's URL.
 */
export const EVIDENCE_KINDS = [
  "session",
  "batch",
  "decision",
  "topic",
  "claim",
  "pending",
  "report",
  "source",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const count = z.number().int().min(0);

export const Evidence = z.strictObject({
  kind: z.enum(EVIDENCE_KINDS),
  id: z.string().min(1).max(600),
});
export type Evidence = z.infer<typeof Evidence>;

/**
 * An admin command the owner may send, as code built it. Checked here only for its shape; the
 * sync (LoopReviewView in core/src/control.ts) and the command route check it as a `Command`.
 */
export const Proposal = z.strictObject({
  label: z.string().min(3).max(200),
  command: z.custom<Command>(
    (v) =>
      typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string",
  ),
});
export type Proposal = z.infer<typeof Proposal>;

export const Finding = z.strictObject({
  code: z.enum(FINDING_CODES),
  weight: z.number(),
  /** What it is about: the rule for rule.broken, the cause (STARVED_CAUSES) for research.starved. */
  subject: z.string().max(200).nullable(),
  numbers: z.record(z.string(), z.number()),
  evidence: z.array(Evidence).max(EVIDENCE_KEPT),
  proposal: Proposal.nullable(),
});
export type Finding = z.infer<typeof Finding>;

export const TopicCount = z.strictObject({
  topic: z.string().max(200),
  drafted: count,
  published: count,
  rejected: count,
  held: count,
});
export type TopicCount = z.infer<typeof TopicCount>;

export const LoopReview = z.strictObject({
  v: z.literal(1),
  /** The Monday (UTC) the week starts. */
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: iso,
  to: iso,
  /** What it counts up to: the moment it was compiled, or the week's end, whichever came first. */
  asOf: iso,
  at: iso,
  research: z.strictObject({
    sessions: count,
    failed: count,
    /** When the last research session before asOf ended; null when none ever ran. */
    last: iso.nullable(),
    daysSince: z.number().nullable(),
  }),
  evaluator: z.strictObject({
    sessions: count,
    published: count,
    rejected: count,
    held: count,
    /** Test claims the evaluator rejected, as it should, and let through. */
    caught: count,
    missed: count,
  }),
  /**
   * Research drafts (published at once, rejected, or held for the evaluator) and the evaluator's
   * own publishes and rejections, by topic.
   */
  claims: z.strictObject({
    drafted: count,
    published: count,
    rejected: count,
    held: count,
    topics: z.array(TopicCount).max(200),
  }),
  /** The structural rules broken this week, most often first (heldBack). */
  rules: z
    .array(
      z.strictObject({
        rule: z.enum(EVALUATOR_RULES),
        count,
        claim: z.string(),
        detail: z.string().max(1500),
      }),
    )
    .max(EVALUATOR_RULES.length),
  /** Published claims a recheck failed this week, those still open, and those revised this week. */
  rechecks: z.strictObject({ failed: count, open: count, changed: count }),
  /** Sources whose quotes failed QUOTE_FAILED_AT times or more this week. */
  sources: z.strictObject({ failing: count }),
  reports: z.strictObject({ open: count, stale: count }),
  queue: z.strictObject({ waiting: count, oldestDays: z.number().nullable() }),
  agenda: z.strictObject({ topics: count, stale: count }),
  /** Most weight first. */
  findings: z.array(Finding).max(40),
});
export type LoopReview = z.infer<typeof LoopReview>;

// --- inputs ------------------------------------------------------------------------------------

/** A line of the daemon's session log (var/control/sessions.jsonl). */
export type SessionLine = Pick<
  RunSummary,
  "id" | "kind" | "topic" | "started" | "finished" | "status" | "published" | "gated" | "rejected"
>;

/** A public run log (knowledge/runs/<year>/<id>.yaml), as much as the review reads. */
export type RunLine = Pick<Run, "id" | "kind" | "published" | "revised" | "rejected" | "gated"> & {
  started: { time: string };
  finished: { time: string };
  open?: string[];
  read?: { url: string; why?: string }[];
};

export type DecisionLine = Pick<
  Decision,
  "at" | "batch" | "id" | "topic" | "canary" | "stages" | "raw" | "outcome"
>;

export interface LoopReviewInput {
  /** The Monday (UTC) the week starts, YYYY-MM-DD. */
  week: string;
  /** When the review is compiled; it counts up to this moment or the week's end, whichever is first. */
  at: string;
  /** The daemon's sessions: research ("daily") and the evaluator ("evaluate"). */
  sessions: readonly SessionLine[];
  /** Every public run log: research (seed, daily, queue), rechecks (reverify), evaluator batches. */
  runs: readonly RunLine[];
  /** The evaluator's decisions (var/evaluator/decisions.jsonl), oldest first. */
  decisions: readonly DecisionLine[];
  /** Open failed rechecks (knowledge/rechecks.json). */
  rechecks: Rechecks;
  /** Reader reports as the brain keeps them (var/reports/items.json). */
  reports: readonly Pick<ReportItem, "id" | "claim" | "at" | "status">[];
  /** The research agenda (brain/agenda/seed.yaml). */
  agenda: readonly { slug: string; title: string }[];
  /** Each topic's gap score (core/src/gaps.ts), to say which stale topic research needs most. */
  gaps: readonly { slug: string; score: number }[];
  /** Claims waiting for a decision (var/review/claims), with when they joined the queue. */
  pending: readonly { id: string; topic: string; proposed: string; sources: (string | null)[] }[];
  /** Published claims: their topic, source URLs in order, and revision times. */
  claims: readonly {
    id: string;
    topic: string;
    sources: (string | null)[];
    revisions: readonly { at: string; change: string }[];
  }[];
  /** Whether the devbox has the owner's Claude subscription token, which every session needs. */
  subscription: boolean;
  settings: Pick<Settings, "paused" | "lessons"> & {
    research: Pick<Settings["research"], "mode" | "skipPending">;
    evaluator: Pick<Settings["evaluator"], "decides" | "canaries">;
  };
}

// --- helpers -----------------------------------------------------------------------------------

/** The Monday (UTC) of the week a moment falls in, YYYY-MM-DD. */
export function weekOf(at: string): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) throw new Error(`not a time: ${at}`);
  const d = new Date(t);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back))
    .toISOString()
    .slice(0, 10);
}

/** The topic of a research run, from its id (`<day>-<kind>-<topic>[-n]`). */
export function runTopic(id: string): string {
  return id.replace(/^\d{4}-\d{2}-\d{2}-(seed|daily|queue)-/, "").replace(/-\d+$/, "");
}

/** The standing lesson for a rule, built from the rule's own description. */
export function ruleLesson(rule: EvaluatorRule): string {
  return `The evaluator rejects every gated claim that breaks its rule "${rule}": ${RULE_TEXT[rule]}.`;
}

const days = (ms: number) => Math.round((ms / DAY_MS) * 10) / 10;
const weigh = (code: FindingCode, size: number) =>
  BASE_WEIGHT[code] + Math.max(0, Math.min(9, Math.floor(size)));
const evidence = (kind: EvidenceKind, ids: readonly string[]): Evidence[] =>
  [...new Set(ids)].slice(0, EVIDENCE_KEPT).map((id) => ({ kind, id }));

interface Session {
  id: string;
  topic: string;
  start: number;
  end: number;
  failed: boolean;
  counts: { drafted: number; published: number; rejected: number; held: number } | null;
}

const runCounts = (r: RunLine) => {
  const held = r.gated.reduce((n, g) => n + g.count, 0);
  const published = r.published.length + r.revised.length;
  return {
    drafted: published + r.rejected.length + held,
    published,
    rejected: r.rejected.length,
    held,
  };
};

/**
 * Research sessions and evaluator batches, each once: the daemon's log, and the public run logs
 * for sessions run by hand or before the daemon kept one. A run log's counts win.
 */
function sessionsOf(i: LoopReviewInput, research: boolean): Session[] {
  const by = new Map<string, Session>();
  for (const s of i.sessions) {
    if ((s.kind === "evaluate") === research) continue;
    const start = Date.parse(s.started);
    by.set(s.id, {
      id: s.id,
      topic: s.topic,
      start,
      end: s.finished ? Date.parse(s.finished) : start,
      failed: s.status === "failed",
      counts: {
        drafted: s.published + s.gated + s.rejected,
        published: s.published,
        rejected: s.rejected,
        held: s.gated,
      },
    });
  }
  for (const r of i.runs) {
    const mine = research
      ? RESEARCH_RUNS.has(r.kind)
      : r.kind === "review" && /-evaluate-/.test(r.id);
    if (!mine) continue;
    const had = by.get(r.id);
    by.set(r.id, {
      id: r.id,
      topic: research ? runTopic(r.id) : "the evaluator",
      start: Date.parse(r.started.time),
      end: Date.parse(r.finished.time),
      failed: had?.failed ?? false,
      counts: runCounts(r),
    });
  }
  return [...by.values()].filter((s) => !Number.isNaN(s.start));
}

const QUOTE_FAILED = /source (\d+): quote not found/g;

/** The source indexes whose quote a recheck's problem text says was not found, from 0. */
export function quoteFailures(text: string, base: 0 | 1): number[] {
  return [...text.matchAll(QUOTE_FAILED)].map((m) => Number(m[1]) - base);
}

// --- the review --------------------------------------------------------------------------------

export function compileLoopReview(i: LoopReviewInput): LoopReview {
  const from = Date.parse(`${i.week}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.week) || Number.isNaN(from))
    throw new Error(`not a day: ${i.week}`);
  if (new Date(from).getUTCDay() !== 1) throw new Error(`${i.week} is not a Monday`);
  const to = from + 7 * DAY_MS;
  const at = Date.parse(i.at);
  if (Number.isNaN(at)) throw new Error(`not a time: ${i.at}`);
  if (at < from) throw new Error(`the week of ${i.week} has not begun at ${i.at}`);
  const asOf = Math.min(at, to);
  const inWeek = (t: number) => t >= from && t < to && t <= asOf;
  const stamp = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  const findings: Finding[] = [];
  const agendaSlugs = new Set(i.agenda.map((t) => t.slug));
  const titleOf = (slug: string) => i.agenda.find((t) => t.slug === slug)?.title ?? slug;

  // Research: this week's sessions, and the days since the last one.
  const research = sessionsOf(i, true).filter((s) => s.start <= asOf);
  const week = research.filter((s) => inWeek(s.start));
  const evaluatorSessions = sessionsOf(i, false).filter((s) => s.start <= asOf);
  const last = research.reduce<number | null>(
    (m, s) => Math.max(m ?? 0, Math.min(s.end, asOf)),
    null,
  );
  const since = last === null ? null : days(asOf - last);
  if (since === null || since > RESEARCH_GAP_DAYS) {
    const lastSession = [...research].sort((a, b) => b.end - a.end)[0];
    const evaluatorSince = evaluatorSessions.filter(
      (s) => s.start >= (last ?? from) && s.start <= asOf,
    );
    const pendingTopics = new Set(i.pending.map((p) => p.topic));
    const s = i.settings;
    const cause: StarvedCause | null = s.paused
      ? "paused"
      : !i.subscription
        ? "no-subscription"
        : s.research.mode === "off"
          ? "research-off"
          : s.research.skipPending &&
              i.agenda.length > 0 &&
              i.agenda.every((t) => pendingTopics.has(t.slug))
            ? "every-topic-waits"
            : evaluatorSince.length
              ? "evaluator-took-the-slots"
              : null;
    // No token: connecting it takes the sealed form on Research, not a command a button can send.
    const proposal: Proposal | null =
      cause === "no-subscription"
        ? null
        : cause === "paused"
          ? { label: "Resume the brain", command: { type: "settings", patch: { paused: false } } }
          : cause === "every-topic-waits"
            ? {
                label: "Let research take topics that have claims in review",
                command: { type: "settings", patch: { research: { skipPending: false } } },
              }
            : {
                label: "Start a research session now, on the planner's pick",
                command: { type: "research.start", topic: null },
              };
    findings.push({
      code: "research.starved",
      weight: weigh("research.starved", since ?? 9),
      subject: cause,
      numbers: {
        ...(since === null ? { never: 1 } : { days: since }),
        sessions: week.length,
        evaluator: evaluatorSince.length,
      },
      evidence: [
        ...(lastSession ? evidence("session", [lastSession.id]) : []),
        ...evidence(
          "batch",
          evaluatorSince.map((e) => e.id),
        ),
      ].slice(0, EVIDENCE_KEPT),
      proposal,
    });
  }

  // Agenda topics research has not touched in STALE_TOPIC_DAYS.
  const recent = new Set(
    research.filter((s) => s.start >= asOf - STALE_TOPIC_DAYS * DAY_MS).map((s) => s.topic),
  );
  const score = new Map(i.gaps.map((g) => [g.slug, g.score]));
  const stale = i.agenda
    .filter((t) => !recent.has(t.slug))
    .sort(
      (a, b) => (score.get(b.slug) ?? 0) - (score.get(a.slug) ?? 0) || a.slug.localeCompare(b.slug),
    );
  if (stale.length) {
    const top = stale[0] as { slug: string; title: string };
    findings.push({
      code: "agenda.stale",
      weight: weigh("agenda.stale", stale.length),
      subject: null,
      numbers: { topics: stale.length, agenda: i.agenda.length, days: STALE_TOPIC_DAYS },
      evidence: evidence(
        "topic",
        stale.map((t) => t.slug),
      ),
      proposal: {
        label: `Start research on ${top.slug} now, the one of these the gap map ranks first`,
        command: { type: "research.start", topic: top.slug },
      },
    });
  }

  // The evaluator: its decisions this week, real claims and test claims apart.
  const decided = i.decisions.filter((d) => inWeek(Date.parse(d.at)));
  const real = decided.filter((d) => !d.canary);
  const canaries = decided.filter((d) => d.canary);
  const caught = canaries.filter((d) => d.raw === "reject");
  const missed = canaries.filter((d) => d.raw === "publish");
  if (missed.length) {
    const now = i.settings.evaluator.canaries;
    const more = Math.min(MAX_CANARIES, now + CANARY_STEP);
    findings.push({
      code: "evaluator.canary-missed",
      weight: weigh("evaluator.canary-missed", missed.length),
      subject: null,
      numbers: { missed: missed.length, caught: caught.length },
      evidence: evidence(
        "decision",
        missed.map((d) => d.id),
      ),
      proposal:
        more > now
          ? {
              label: `Mix ${more} test claims into each batch instead of ${now}`,
              command: { type: "settings", patch: { evaluator: { canaries: more } } },
            }
          : null,
    });
  }

  // The rules most broken, as research's task already reads them.
  const rules = heldBack(real, real.length).map((r) => ({
    rule: r.rule,
    count: r.count,
    claim: r.claim,
    detail: r.detail.slice(0, 1500),
  }));
  for (const r of rules.filter((x) => x.count >= RULE_BROKEN_AT)) {
    const text = ruleLesson(r.rule);
    const kept = i.settings.lessons.some((l) => l.text === text);
    const broke = real.filter((d) =>
      d.stages.some(
        (s) => s.stage === "rules" && !s.ok && brokenRules(s.detail).some((b) => b.rule === r.rule),
      ),
    );
    findings.push({
      code: "rule.broken",
      weight: weigh("rule.broken", r.count),
      subject: r.rule,
      numbers: { claims: r.count, kept: kept ? 1 : 0 },
      evidence: evidence("decision", broke.map((d) => d.id).reverse()),
      proposal: kept
        ? null
        : {
            label: "Keep this rule as a standing lesson for research",
            command: { type: "lesson.add", text },
          },
    });
  }

  // Rechecks of published claims that failed this week: a daily recheck reports every open failure,
  // so a claim counts for a run only when that run read it again ("recheck of <id>").
  const failedBy = new Map<string, { claim: string; day: string; problems: string }[]>();
  const fail = (claim: string, t: number, problems: string) =>
    failedBy.set(claim, [
      ...(failedBy.get(claim) ?? []),
      { claim, day: stamp(t).slice(0, 10), problems },
    ]);
  for (const r of i.runs) {
    const t = Date.parse(r.started.time);
    if (r.kind !== "reverify" || !inWeek(t)) continue;
    const checked = new Set(
      (r.read ?? []).flatMap((x) => (x.why?.startsWith("recheck of ") ? [x.why.slice(11)] : [])),
    );
    for (const line of r.open ?? []) {
      const cut = line.indexOf(": ");
      const id = cut > 0 ? line.slice(0, cut) : line;
      if (checked.has(id)) fail(id, t, line.slice(cut + 2));
    }
  }
  for (const [id, r] of Object.entries(i.rechecks)) {
    const t = Date.parse(r.at.time);
    if (inWeek(t)) fail(id, t, r.problems.join("; "));
  }
  const failedIds = [...failedBy.keys()].sort();
  const open = failedIds.filter((id) => i.rechecks[id]);
  const claimsById = new Map(i.claims.map((c) => [c.id, c]));
  const changed = failedIds.filter((id) =>
    (claimsById.get(id)?.revisions ?? []).some(
      (v) => v.change !== "reviewed" && inWeek(Date.parse(v.at)),
    ),
  );
  if (failedIds.length) {
    const byTopic = new Map<string, number>();
    for (const id of open) {
      const t = claimsById.get(id)?.topic;
      if (t && agendaSlugs.has(t)) byTopic.set(t, (byTopic.get(t) ?? 0) + 1);
    }
    const top = [...byTopic].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    findings.push({
      code: "recheck.failed",
      weight: weigh("recheck.failed", open.length),
      subject: null,
      numbers: { failed: failedIds.length, open: open.length, changed: changed.length },
      evidence: evidence("claim", [...open, ...failedIds]),
      proposal: top
        ? {
            label: `Research ${titleOf(top[0])} now, where ${top[1]} failed recheck${top[1] === 1 ? "" : "s"} wait for a correction`,
            command: { type: "research.start", topic: top[0] },
          }
        : null,
    });
  }

  // Sources whose quotes failed more than once: in rechecks (source numbers from 1, as
  // brain/src/recheck.ts writes them) and in the evaluator's recheck stage (from 0, as
  // recheckStage in brain/src/evaluator.ts writes them).
  const pendingById = new Map(i.pending.map((p) => [p.id, p]));
  const quoteFails = new Map<string, Set<string>>();
  const quote = (
    urls: (string | null)[] | undefined,
    claim: string,
    day: string,
    idx: number[],
  ) => {
    for (const n of idx) {
      const url = urls?.[n];
      if (!url) continue;
      quoteFails.set(url, (quoteFails.get(url) ?? new Set()).add(`${claim}|${day}`));
    }
  };
  for (const events of failedBy.values())
    for (const e of events)
      quote(claimsById.get(e.claim)?.sources, e.claim, e.day, quoteFailures(e.problems, 1));
  for (const d of real) {
    const stage = d.stages.find((s) => s.stage === "recheck" && s.ok === false);
    if (!stage) continue;
    const urls = pendingById.get(d.id)?.sources ?? claimsById.get(d.id)?.sources;
    quote(urls, d.id, d.at.slice(0, 10), quoteFailures(stage.detail, 0));
  }
  const failing = [...quoteFails]
    .filter(([, keys]) => keys.size >= QUOTE_FAILED_AT)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  if (failing.length)
    findings.push({
      code: "source.quote-failing",
      weight: weigh("source.quote-failing", failing.length),
      subject: null,
      numbers: {
        sources: failing.length,
        failures: failing.reduce((n, [, k]) => n + k.size, 0),
      },
      evidence: evidence(
        "source",
        failing.map(([url]) => url),
      ),
      proposal: null,
    });

  // Reader reports still open a week after they were filed.
  const openReports = i.reports.filter((r) => OPEN_REPORTS.has(r.status));
  const staleReports = openReports
    .filter((r) => Date.parse(r.at) <= asOf - REPORT_OPEN_DAYS * DAY_MS)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (staleReports.length)
    findings.push({
      code: "reports.open",
      weight: weigh("reports.open", staleReports.length),
      subject: null,
      numbers: {
        reports: staleReports.length,
        open: openReports.length,
        oldestDays: days(asOf - Date.parse((staleReports[0] as { at: string }).at)),
      },
      evidence: evidence(
        "report",
        staleReports.map((r) => r.id),
      ),
      proposal: null,
    });

  // The review queue: how long its oldest claim has waited.
  const waiting = i.pending
    .filter((p) => Date.parse(p.proposed) <= asOf)
    .sort((a, b) => a.proposed.localeCompare(b.proposed) || a.id.localeCompare(b.id));
  const oldestDays = waiting.length
    ? days(asOf - Date.parse((waiting[0] as { proposed: string }).proposed))
    : null;
  if (oldestDays !== null && oldestDays > QUEUE_WAIT_DAYS)
    findings.push({
      code: "queue.waiting",
      weight: weigh("queue.waiting", oldestDays),
      subject: null,
      numbers: {
        days: oldestDays,
        waiting: waiting.length,
        older: waiting.filter((p) => Date.parse(p.proposed) < asOf - QUEUE_WAIT_DAYS * DAY_MS)
          .length,
      },
      evidence: evidence(
        "pending",
        waiting.map((p) => p.id),
      ),
      proposal:
        i.settings.evaluator.decides === "evaluator"
          ? { label: "Evaluate a batch now", command: { type: "evaluator.run" } }
          : null,
    });

  // Claims by topic: research's drafts, and the evaluator's decisions on real claims.
  const topics = new Map<string, TopicCount>();
  const row = (topic: string) => {
    const r = topics.get(topic) ?? { topic, drafted: 0, published: 0, rejected: 0, held: 0 };
    topics.set(topic, r);
    return r;
  };
  for (const s of week) {
    if (!s.counts) continue;
    const r = row(s.topic);
    r.drafted += s.counts.drafted;
    r.published += s.counts.published;
    r.rejected += s.counts.rejected;
    r.held += s.counts.held;
  }
  for (const d of real) {
    if (d.outcome === "publish") row(d.topic).published++;
    if (d.outcome === "reject") row(d.topic).rejected++;
  }
  const topicRows = [...topics.values()].sort(
    (a, b) => b.drafted + b.published - (a.drafted + a.published) || a.topic.localeCompare(b.topic),
  );
  const sum = (k: keyof Omit<TopicCount, "topic">) => topicRows.reduce((n, r) => n + r[k], 0);

  findings.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.code.localeCompare(b.code) ||
      (a.subject ?? "").localeCompare(b.subject ?? ""),
  );
  return LoopReview.parse({
    v: 1,
    week: i.week,
    from: stamp(from),
    to: stamp(to),
    asOf: stamp(asOf),
    at: stamp(at),
    research: {
      sessions: week.length,
      failed: week.filter((s) => s.failed).length,
      last: last === null ? null : stamp(last),
      daysSince: since,
    },
    evaluator: {
      sessions: evaluatorSessions.filter((s) => inWeek(s.start)).length,
      published: real.filter((d) => d.outcome === "publish").length,
      rejected: real.filter((d) => d.outcome === "reject").length,
      held: real.filter((d) => d.outcome === "hold").length,
      caught: caught.length,
      missed: missed.length,
    },
    claims: {
      drafted: sum("drafted"),
      published: sum("published"),
      rejected: sum("rejected"),
      held: sum("held"),
      topics: topicRows.slice(0, 200),
    },
    rules,
    rechecks: { failed: failedIds.length, open: open.length, changed: changed.length },
    sources: { failing: failing.length },
    reports: { open: openReports.length, stale: staleReports.length },
    queue: { waiting: waiting.length, oldestDays },
    agenda: { topics: i.agenda.length, stale: stale.length },
    findings: findings.slice(0, 40),
  });
}

// --- words ---------------------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (f: Finding, k: string) => f.numbers[k] ?? 0;

const CAUSE_TEXT: Record<StarvedCause, string> = {
  paused: "The brain is paused.",
  "no-subscription":
    "The devbox has no Claude subscription token, so no session can start; connect it on Research.",
  "research-off": "Research is off, so only sessions you start run.",
  "every-topic-waits":
    "Every agenda topic has claims in review, and research leaves those topics alone.",
  "evaluator-took-the-slots": "Every session since went to the evaluator.",
};

/** One finding in plain words, from its code and numbers: the CLI prints it, the admin shows it. */
export function findingText(f: Finding): string {
  switch (f.code) {
    case "research.starved": {
      const head =
        "never" in f.numbers
          ? "No research session has run."
          : `No research session for ${num(f, "days")} days.`;
      const cause = f.subject ? ` ${CAUSE_TEXT[f.subject as StarvedCause] ?? ""}` : "";
      return `${head} ${plural(num(f, "sessions"), "research session")} this week, ${plural(num(f, "evaluator"), "evaluator session")} since the last one.${cause}`;
    }
    case "agenda.stale":
      return `${num(f, "topics")} of ${num(f, "agenda")} agenda topics ${num(f, "topics") === 1 ? "has" : "have"} had no research session in ${num(f, "days")} days.`;
    case "evaluator.canary-missed":
      return `The evaluator let ${plural(num(f, "missed"), "test claim")} through this week and caught ${num(f, "caught")}. Calibration holds a batch a test claim slipped through, and pauses publishing when the catch rate falls.`;
    case "rule.broken": {
      const rule = f.subject as EvaluatorRule;
      const text = RULE_TEXT[rule] ?? "";
      return `The evaluator's rule "${rule}" rejected ${plural(num(f, "claims"), "claim")} this week: ${text}.${num(f, "kept") ? " It is already a standing lesson." : ""}`;
    }
    case "recheck.failed":
      return `${plural(num(f, "failed"), "published claim")} failed a recheck this week; ${num(f, "open")} still open, ${num(f, "changed")} revised since.`;
    case "source.quote-failing":
      return `${plural(num(f, "sources"), "source")} failed a quote check more than once this week (${num(f, "failures")} failures).`;
    case "reports.open":
      return `${plural(num(f, "reports"), "reader report")} ${num(f, "reports") === 1 ? "has" : "have"} been open for more than ${REPORT_OPEN_DAYS} days, the oldest for ${num(f, "oldestDays")} days; ${num(f, "open")} open in all.`;
    case "queue.waiting":
      return `A gated claim has waited ${num(f, "days")} days for a decision; ${num(f, "older")} of the ${num(f, "waiting")} waiting are older than ${QUEUE_WAIT_DAYS} days.`;
  }
}

/**
 * Whether what a proposal asks for already holds under the current settings: a lesson already kept,
 * or a settings patch whose every field already has that value. Other commands are actions, never
 * done in advance.
 */
export function proposalDone(cmd: Command, s: Settings): boolean {
  if (cmd.type === "lesson.add") return s.lessons.some((l) => l.text === cmd.text);
  if (cmd.type !== "settings") return false;
  return Object.entries(cmd.patch).every(([k, v]) => {
    const cur = (s as Record<string, unknown>)[k];
    if (typeof v !== "object" || v === null) return cur === v;
    return Object.entries(v).every(([f, x]) => (cur as Record<string, unknown>)?.[f] === x);
  });
}
