// The weekly review of the loop, devbox side (BACKLOG 31; core/src/loopreview.ts compiles it): read
// one week's records from where the brain keeps them, save the review for the daemon to carry to
// the admin, and print it for the devbox. The weekly tick reviews the week that just ended.
//
//   pnpm brain review-loop [--week YYYY-MM-DD] [--write]
//
// It only reads, unless --write (or the weekly tick) saves the review to
// var/loop/reviews/<week>.json, which is private: var/ is never committed and the review never
// reaches the bundle.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { LoopReviewView } from "@blocklore/core/control";
import {
  compileLoopReview,
  DAY_MS,
  type Evidence,
  findingText,
  type LoopReview,
  type RunLine,
  weekOf,
} from "@blocklore/core/loopreview";
import { loadStore } from "@blocklore/core/node";
import { parse } from "yaml";
import { controlStore, writeJsonAtomic } from "./control.ts";
import { KNOWLEDGE, VAR } from "./env.ts";
import { evaluatorFiles, modelReady } from "./evaluator.ts";
import { currentGaps } from "./plan.ts";
import { readRechecks } from "./recheck.ts";
import { readReports } from "./reports.ts";
import { agenda } from "./research.ts";
import { readPending } from "./store.ts";
import { readEnvToken } from "./subscription.ts";

export const REVIEWS = path.join(VAR, "loop", "reviews");
/** Enough of decisions.jsonl for any week (its reader keeps the newest 512 KB by default). */
const DECISION_BYTES = 64 * 1024 * 1024;

/** Every public run log, as much of each as the review reads; a malformed one is skipped. */
export function runLogs(dir = path.join(KNOWLEDGE, "runs")): RunLine[] {
  if (!existsSync(dir)) return [];
  const out: RunLine[] = [];
  for (const year of readdirSync(dir).sort())
    for (const f of readdirSync(path.join(dir, year))
      .filter((x) => x.endsWith(".yaml"))
      .sort()) {
      try {
        const r = parse(readFileSync(path.join(dir, year, f), "utf8")) as RunLine;
        if (r?.id && r.kind && r.started?.time && r.finished?.time)
          out.push({
            id: r.id,
            kind: r.kind,
            started: { time: String(r.started.time) },
            finished: { time: String(r.finished.time) },
            published: r.published ?? [],
            revised: r.revised ?? [],
            rejected: r.rejected ?? [],
            gated: r.gated ?? [],
            open: r.open ?? [],
            read: r.read ?? [],
          });
      } catch {
        // a run log lint would reject; the review counts what it can read
      }
    }
  return out;
}

/** The review of the week starting `week` (a Monday), counted up to `at` or the week's end. */
export function loopReview(week: string, at: Date): LoopReview {
  const { store } = loadStore();
  const settings = controlStore().settings();
  return compileLoopReview({
    week,
    at: at.toISOString(),
    sessions: controlStore().sessions(),
    runs: runLogs(),
    decisions: evaluatorFiles().decisions(DECISION_BYTES),
    rechecks: readRechecks(),
    reports: [...readReports().values()],
    agenda: agenda().map((t) => ({ slug: t.slug, title: t.title })),
    gaps: currentGaps().topics.map((t) => ({ slug: t.slug, score: t.score })),
    pending: readPending().map((p) => ({
      id: p.candidate.id,
      topic: p.candidate.topics[0] as string,
      proposed: p.proposed.time,
      sources: p.candidate.sources.map((s) => s.url ?? null),
    })),
    claims: store.claims.map((c) => ({
      id: c.id,
      topic: c.topics[0] as string,
      sources: c.sources.map((s) => s.url ?? null),
      revisions: c.revisions.map((v) => ({ at: v.at.time, change: v.change })),
    })),
    subscription: modelReady() || !!readEnvToken(),
    settings,
  });
}

export function writeLoopReview(r: LoopReview, dir = REVIEWS): string {
  const file = path.join(dir, `${r.week}.json`);
  writeJsonAtomic(file, r);
  return file;
}

const reviewFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
    : [];

/** What changes when a review is written: the newest file and its time. */
export function loopReviewStamp(dir = REVIEWS): string {
  const f = reviewFiles(dir).pop();
  return f ? `${f}:${statSync(path.join(dir, f)).mtimeMs}` : "";
}

/** The latest week's review, as the daemon carries it to the admin; null when none was written. */
export function latestLoopReview(dir = REVIEWS): LoopReviewView | null {
  const f = reviewFiles(dir).pop();
  if (!f) return null;
  const v = LoopReviewView.safeParse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  if (!v.success) throw new Error(`${f} is not a LoopReview: ${v.error.message.slice(0, 300)}`);
  return v.data;
}

/** The weekly tick's step: the week that just ended, saved for the admin. */
export function weeklyReview(now = new Date()): string {
  const week = weekOf(new Date(now.getTime() - 7 * DAY_MS).toISOString());
  const r = loopReview(week, now);
  writeLoopReview(r);
  const top = r.findings[0];
  return `the week of ${week}: ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}${top ? `, first ${top.code}` : ""} (var/loop/reviews/${week}.json)`;
}

const minute = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const ev = (e: Evidence) => `${e.kind} ${e.id}`;

/** The review as text, for the devbox. */
export function reviewText(r: LoopReview): string[] {
  const c = r.claims;
  const out = [
    `Weekly review of the loop: the week of ${r.week} (to ${r.to.slice(0, 10)}), counted to ${minute(r.asOf)}`,
    "",
    `Research    ${r.research.sessions} session${r.research.sessions === 1 ? "" : "s"} this week, ${r.research.failed} failed; ${r.research.last ? `the last ended ${minute(r.research.last)}, ${r.research.daysSince} days before` : "none has ever run"}`,
    `Evaluator   ${r.evaluator.sessions} sessions; ${r.evaluator.published} published, ${r.evaluator.rejected} rejected, ${r.evaluator.held} held; test claims ${r.evaluator.caught} caught, ${r.evaluator.missed} missed`,
    `Claims      ${c.drafted} drafted, ${c.published} published, ${c.rejected} rejected, ${c.held} held for the evaluator`,
    ...c.topics.map(
      (t) =>
        `            ${t.topic.padEnd(26)} ${String(t.drafted).padStart(3)} drafted ${String(t.published).padStart(3)} published ${String(t.rejected).padStart(3)} rejected ${String(t.held).padStart(3)} held`,
    ),
    `Rules       ${r.rules.length ? r.rules.map((x) => `${x.rule} ${x.count}`).join(", ") : "none broken"}`,
    `Rechecks    ${r.rechecks.failed} published claims failed, ${r.rechecks.open} still open, ${r.rechecks.changed} revised; ${r.sources.failing} sources failed a quote more than once`,
    `Reports     ${r.reports.open} open, ${r.reports.stale} open past a week`,
    `Queue       ${r.queue.waiting} waiting${r.queue.oldestDays === null ? "" : `, the oldest ${r.queue.oldestDays} days`}`,
    `Agenda      ${r.agenda.topics} topics, ${r.agenda.stale} with no research session in 14 days`,
    "",
  ];
  if (!r.findings.length) return [...out, "No findings."];
  out.push(`Findings, most weight first (${r.findings.length}):`);
  r.findings.forEach((f, n) => {
    out.push("", `${n + 1}. [${f.code}${f.subject ? `: ${f.subject}` : ""}] ${findingText(f)}`);
    if (f.evidence.length) out.push(`   evidence: ${f.evidence.map(ev).join("; ")}`);
    out.push(
      f.proposal
        ? `   proposal: ${f.proposal.label} (${f.proposal.command.type}, a button on the admin's Weekly review)`
        : "   proposal: none; no admin command fits",
    );
  });
  return out;
}

export async function reviewLoop(opts: { week?: string; write: boolean }): Promise<number> {
  const now = new Date();
  const week = weekOf(opts.week ?? now.toISOString());
  if (opts.week && week !== opts.week) console.log(`(${opts.week} is in the week of ${week})`);
  const r = loopReview(week, now);
  console.log(reviewText(r).join("\n"));
  if (opts.write) console.log(`\nwrote ${path.relative(process.cwd(), writeLoopReview(r))}`);
  return 0;
}
