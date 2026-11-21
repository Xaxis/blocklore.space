// The golden question set (brain/bench/golden.yaml) against the store, so changes to search, the
// Ask prompt or the claims are measured instead of guessed at.
//
//   pnpm brain bench                      retrieval only: free and deterministic
//   pnpm brain bench --ask [--limit N] [--only kind,kind] [--ids g001,g002]
//                                         also writes answers with the model, as /ask does,
//                                         charged to the brain's daily budget
//   pnpm brain bench [--ask] --publish [--commit]
//                                         the whole set, written to knowledge/bench.json (the
//                                         public scorecard); without --ask the last answer scores
//                                         are kept
//
// Retrieval: does search put an expected claim in the 12 that Ask reads (hit@1, hit@5, hit@12, the
// reciprocal rank of the first expected claim, and whether every `must` claim is among them)?
// Answers: does Ask answer covered questions from the expected claims, say "not covered" for
// uncovered ones, decline the ones it should, and pass its own check? Value questions are listed
// for a person to read: whether an answer takes a side is not something code can score.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  ANSWER_SCHEMA,
  ASK,
  ASK_SYSTEM,
  type AskAnswer,
  askFingerprint,
  askPrompt,
  type BundleClaim,
  buildIndex,
  checkAnswer,
  compile,
  costMicros,
  refusalAnswer,
  Scorecard,
  type Stamp,
  scopeRefusal,
  searchClaims,
  sha256Hex,
  worstCaseMicros,
} from "@blocklore/core";
import { loadStore, storeMoment } from "@blocklore/core/node";
import { parse } from "yaml";
import { z } from "zod";
import { dailyBudgetUsd, recordSpend, spentToday } from "./agent.ts";
import { KNOWLEDGE, ROOT, VAR } from "./env.ts";
import { commitAsOwner } from "./git.ts";

const KINDS = ["covered", "partial", "uncovered", "value", "refuse"] as const;
type Kind = (typeof KINDS)[number];
const Golden = z.strictObject({
  version: z.literal(1),
  questions: z.array(
    z.strictObject({
      id: z.string().regex(/^g\d{3}$/),
      q: z.string().min(5).max(300),
      kind: z.enum(KINDS),
      expect: z.array(z.string()),
      must: z.array(z.string()).optional(),
      gated: z.boolean().optional(),
      note: z.string().max(200).optional(),
    }),
  ),
});
type Question = z.infer<typeof Golden>["questions"][number];

export const GOLDEN = path.join(ROOT, "brain", "bench", "golden.yaml");
export const SCORECARD = path.join(KNOWLEDGE, "bench.json");

export function loadGolden(file = GOLDEN): Question[] {
  return Golden.parse(parse(readFileSync(file, "utf8"), { uniqueKeys: true })).questions;
}

export interface RetrievalRow {
  id: string;
  kind: Kind;
  rank: number | null;
  must: boolean;
  top: string[];
}

/** A share as a fraction rounded to 4 places, so the published file is stable; null for none. */
const frac = (n: number, d: number) => (d ? Math.round((n / d) * 1e4) / 1e4 : null);
const kindsOf = (rows: { kind: Kind }[]) => KINDS.filter((k) => rows.some((r) => r.kind === k));

export function retrievalStats(rows: RetrievalRow[]): Scorecard["retrieval"] {
  const stat = (kind: string, rs: RetrievalRow[]) => {
    const hit = (k: number) => rs.filter((r) => r.rank !== null && r.rank <= k).length;
    const mrr = rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / (rs.length || 1);
    return {
      kind,
      n: rs.length,
      hit1: frac(hit(1), rs.length),
      hit5: frac(hit(5), rs.length),
      hit12: frac(hit(ASK.claims), rs.length),
      must12: frac(rs.filter((r) => r.must).length, rs.length),
      mrr: Math.round(mrr * 1e4) / 1e4,
    };
  };
  return [
    stat("all", rows),
    ...kindsOf(rows).map((k) =>
      stat(
        k,
        rows.filter((r) => r.kind === k),
      ),
    ),
  ];
}

const show = (f: number | null) => (f === null ? "n/a" : `${(f * 100).toFixed(1)}%`);

function retrievalReport(rows: RetrievalRow[]) {
  return retrievalStats(rows).map(
    (s) =>
      `${s.kind.padEnd(10)} n=${String(s.n).padStart(3)}  hit@1 ${show(s.hit1).padStart(6)}  hit@5 ${show(s.hit5).padStart(6)}  hit@12 ${show(s.hit12).padStart(6)}  must@12 ${show(s.must12).padStart(6)}  MRR ${s.mrr.toFixed(3)}`,
  );
}

export interface AskRow {
  id: string;
  kind: Kind;
  q: string;
  mode: "answer" | "refused" | "no_match" | "check_failed" | "model_error" | "model_declined";
  verdict: string | null;
  cites: string[];
  pass: boolean | null;
  grounded: boolean | null;
  must: boolean | null;
  micros: number;
  ms: number;
  text: string;
  problems?: string[];
}

function score(q: Question, published: Set<string>, mode: AskRow["mode"], a: AskAnswer | null) {
  const expect = q.expect.filter((id) => published.has(id));
  const cites = a?.claims ?? [];
  const grounded = expect.length ? cites.some((id) => expect.includes(id)) : null;
  const must = q.must?.length ? q.must.every((id) => cites.includes(id)) : null;
  const v = a?.verdict ?? null;
  let pass: boolean | null;
  switch (q.kind) {
    case "covered":
      pass = (v === "answered" || v === "partial") && grounded === true;
      break;
    case "partial":
      pass = (v === "partial" || v === "answered") && grounded !== false;
      break;
    case "uncovered":
      pass = mode === "no_match" || v === "not_covered";
      break;
    case "refuse":
      // The model's own safety refusal also declines; the site shows a note and no answer.
      pass = v === "refused" || mode === "model_declined";
      break;
    case "value":
      pass = null;
      break;
  }
  return { grounded, must, pass };
}

/** Outcomes that leave a reader without a full answer. */
const SHORT = new Set(["partial", "not_covered", "no_match", "check_failed", "model_declined"]);

type Scored = Pick<AskRow, "kind" | "pass" | "grounded" | "must" | "verdict" | "mode">;

export function askStats(asked: Scored[]): NonNullable<Scorecard["ask"]>["rows"] {
  const stat = (kind: string, rs: Scored[]) => {
    const scored = rs.filter((r) => r.pass !== null);
    const g = rs.filter((r) => r.grounded !== null);
    const mu = rs.filter((r) => r.must !== null);
    const verdicts: Record<string, number> = {};
    for (const r of rs) verdicts[r.verdict ?? r.mode] = (verdicts[r.verdict ?? r.mode] ?? 0) + 1;
    return {
      kind,
      n: rs.length,
      pass: frac(scored.filter((r) => r.pass).length, scored.length),
      grounded: frac(g.filter((r) => r.grounded).length, g.length),
      must: frac(mu.filter((r) => r.must).length, mu.length),
      verdicts: Object.fromEntries(Object.entries(verdicts).sort(([a], [b]) => a.localeCompare(b))),
    };
  };
  return [
    stat("all", asked),
    ...kindsOf(asked).map((k) =>
      stat(
        k,
        asked.filter((r) => r.kind === k),
      ),
    ),
  ];
}

/**
 * The public scorecard from one bench run. A run that scored every answer replaces the answer
 * scores; any other run keeps the previous ones, which carry the edition, golden set and Ask
 * fingerprint they were scored with.
 */
export function buildScorecard(input: {
  at: Stamp;
  golden: string;
  questions: Question[];
  claims: number;
  rows: RetrievalRow[];
  ask: { ran: string; usd: number; rows: AskRow[] } | null;
  previous: Scorecard | null;
}): Scorecard {
  const text = new Map(input.questions.map((q) => [q.id, q.q]));
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  const run = input.ask;
  return Scorecard.parse({
    at: input.at,
    golden: input.golden,
    questions: input.questions.length,
    claims: input.claims,
    retrieval: retrievalStats(input.rows),
    misses: input.rows
      .filter((r) => r.rank === null || r.rank > 5)
      .map((r) => ({ id: r.id, kind: r.kind, q: text.get(r.id) ?? "", rank: r.rank }))
      .sort(byId),
    ask: run
      ? {
          at: input.at,
          ran: run.ran,
          golden: input.golden,
          ask: askFingerprint(),
          model: ASK.model,
          effort: ASK.effort,
          questions: run.rows.length,
          usd: Math.round(run.usd * 100) / 100,
          rows: askStats(run.rows),
          failed: run.rows
            .filter((r) => r.pass === false)
            .map((r) => ({ id: r.id, kind: r.kind, q: r.q, got: r.verdict ?? r.mode }))
            .sort(byId),
          short: run.rows
            .filter((r) => r.kind !== "refuse" && SHORT.has(r.verdict ?? r.mode))
            .map((r) => ({ id: r.id, kind: r.kind, q: r.q, got: r.verdict ?? r.mode }))
            .sort(byId),
          rejected: run.rows.filter((r) => r.mode === "check_failed").length,
          medianMs:
            [...run.rows].sort((a, b) => a.ms - b.ms)[Math.floor(run.rows.length / 2)]?.ms ?? 0,
        }
      : (input.previous?.ask ?? null),
  });
}

export async function bench(opts: {
  ask: boolean;
  limit?: number;
  only?: string[];
  ids?: string[];
  publish?: boolean;
  commit?: boolean;
}): Promise<number> {
  if (opts.publish && (opts.limit !== undefined || opts.only?.length || opts.ids?.length))
    throw new Error("--publish scores the whole golden set: drop --limit, --only and --ids");
  const questions = loadGolden()
    .filter((q) => !opts.only?.length || opts.only.includes(q.kind))
    .filter((q) => !opts.ids?.length || opts.ids.includes(q.id))
    .slice(0, opts.limit ?? Number.POSITIVE_INFINITY);
  const { store } = loadStore();
  const at = storeMoment(store);
  const { bundle } = compile(store, at);
  const claims = bundle.claims as Record<string, BundleClaim>;
  const published = new Set(Object.keys(claims));
  const index = buildIndex(Object.values(claims));
  const retrieve = (q: string) =>
    searchClaims(index, claims, q, { limit: ASK.claims }).flatMap((h) => {
      const c = claims[h.id];
      return c ? [c] : [];
    });

  // Retrieval
  const rows: RetrievalRow[] = [];
  const misses: string[] = [];
  for (const q of questions) {
    const expect = q.expect.filter((id) => published.has(id));
    if (!expect.length || !(q.kind === "covered" || q.kind === "partial" || q.kind === "value"))
      continue;
    const top = retrieve(q.q).map((c) => c.id);
    const ranks = expect.map((id) => top.indexOf(id)).filter((i) => i >= 0);
    const rank = ranks.length ? Math.min(...ranks) + 1 : null;
    const must = (q.must ?? []).every((id) => top.includes(id));
    rows.push({ id: q.id, kind: q.kind, rank, must, top });
    if (rank === null || rank > 5)
      misses.push(
        `  ${q.id} ${rank === null ? "miss" : `rank ${rank}`}  "${q.q}"\n      expect ${expect.join(", ")}\n      got    ${top.slice(0, 3).join(", ")}`,
      );
  }
  console.log(`Retrieval over ${published.size} published claims, edition at block ${at.height}:`);
  for (const l of retrievalReport(rows)) console.log(`  ${l}`);
  if (misses.length) console.log(`\nNot in the top 5 (${misses.length}):\n${misses.join("\n")}`);

  const out = path.join(VAR, "bench");
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report: Record<string, unknown> = {
    at,
    questions: questions.length,
    retrieval: { lines: retrievalReport(rows), rows },
  };
  let scoredRun: { ran: string; usd: number; rows: AskRow[] } | null = null;

  if (opts.ask) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set (.env)");
    const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
    const asked: AskRow[] = [];
    const ran = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    let stopped = "";
    const one = async (q: Question): Promise<AskRow> => {
      const started = Date.now();
      const base = { id: q.id, kind: q.kind, q: q.q, micros: 0, cites: [] as string[] };
      const done = (
        mode: AskRow["mode"],
        a: AskAnswer | null,
        micros = 0,
        problems?: string[],
      ) => ({
        ...base,
        mode,
        verdict: a?.verdict ?? null,
        cites: a?.claims ?? [],
        micros,
        ms: Date.now() - started,
        text: a
          ? a.sentences.map((s) => `${s.text} [${s.cites.join(",")}]`).join(" ") ||
            (a.missing ?? "")
          : "",
        ...score(q, published, mode, a),
        ...(problems ? { problems } : {}),
      });
      const out = scopeRefusal(q.q);
      if (out) return done("refused", refusalAnswer(out));
      const read = retrieve(q.q);
      if (!read.length) return done("no_match", null);
      const prompt = askPrompt(q.q, "user", read);
      if (spentToday() + worstCaseMicros(ASK_SYSTEM, prompt) / 1e6 > dailyBudgetUsd()) {
        stopped = "the brain's daily budget";
        return done("model_error", null);
      }
      let m: Anthropic.Message;
      try {
        m = await client.messages.create({
          model: ASK.model,
          max_tokens: ASK.maxTokens,
          system: ASK_SYSTEM,
          messages: [{ role: "user", content: prompt }],
          output_config: {
            effort: ASK.effort,
            format: { type: "json_schema", schema: ANSWER_SCHEMA },
          },
        });
      } catch (e) {
        return done("model_error", null, 0, [
          e instanceof Error ? e.message.slice(0, 200) : "error",
        ]);
      }
      const micros = costMicros(m.usage);
      recordSpend("bench", micros / 1e6);
      if (m.stop_reason === "refusal") return done("model_declined", null, micros);
      if (m.stop_reason !== "end_turn")
        return done("model_error", null, micros, [m.stop_reason ?? ""]);
      const raw = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const c = checkAnswer(
        raw,
        read.map((x) => x.id),
      );
      if (!c.ok) return done("check_failed", null, micros, c.problems);
      return done("answer", c.answer, micros);
    };
    // Four at a time: fast enough for 200 questions, gentle on rate limits.
    const queue = [...questions];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let q = queue.shift(); q && !stopped; q = queue.shift()) {
          const r = await one(q);
          asked.push(r);
          process.stdout.write(r.pass === false ? "x" : r.pass ? "." : "?");
        }
      }),
    );
    process.stdout.write("\n");
    asked.sort((a, b) => a.id.localeCompare(b.id));
    const total = asked.reduce((s, r) => s + r.micros, 0) / 1e6;
    console.log(
      `\nAnswers (${asked.length}, ${ASK.model}, effort ${ASK.effort}, $${total.toFixed(2)}):`,
    );
    for (const s of askStats(asked))
      console.log(
        `  ${s.kind.padEnd(10)} n=${String(s.n).padStart(3)}  pass ${s.pass === null ? "(read them)" : show(s.pass)}  grounded ${show(s.grounded)}  must ${show(s.must)}  [${Object.entries(
          s.verdicts,
        )
          .map(([v, n]) => `${v} ${n}`)
          .join(", ")}]`,
      );
    const failedCheck = asked.filter((r) => r.mode === "check_failed");
    console.log(
      `  rejected by the answer check: ${failedCheck.length}; model errors: ${asked.filter((r) => r.mode === "model_error").length}; median ${[...asked].sort((a, b) => a.ms - b.ms)[Math.floor(asked.length / 2)]?.ms ?? 0} ms`,
    );
    const fails = asked.filter((r) => r.pass === false);
    if (fails.length) {
      console.log(`\nFailed (${fails.length}):`);
      for (const r of fails)
        console.log(
          `  ${r.id} ${r.kind} -> ${r.verdict ?? r.mode}  "${r.q}"\n      ${r.problems ? `problems: ${r.problems.join("; ")}` : r.text.slice(0, 220)}${r.kind === "uncovered" && r.mode === "answer" ? "\n      (the claims may cover this now, after research on the gap map: if the answer holds, make it a covered question with expected claims in golden.yaml)" : ""}`,
        );
    }
    if (stopped) console.log(`\nStopped early: ${stopped}.`);
    report.ask = { model: ASK.model, effort: ASK.effort, usd: total, rows: asked };
    const errors = asked.filter((r) => r.mode === "model_error").length;
    if (stopped || errors)
      console.log(
        "\nThese answer scores are not published: a run that stopped early or met model errors would understate Ask.",
      );
    else scoredRun = { ran, usd: total, rows: asked };
  }

  const file = path.join(out, `${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\nfull report: ${path.relative(ROOT, file)}`);

  if (opts.publish) {
    const previous = existsSync(SCORECARD)
      ? Scorecard.parse(JSON.parse(readFileSync(SCORECARD, "utf8")))
      : null;
    const card = buildScorecard({
      at,
      golden: sha256Hex(readFileSync(GOLDEN, "utf8")),
      questions,
      claims: published.size,
      rows,
      ask: scoredRun,
      previous,
    });
    const rel = path.relative(ROOT, SCORECARD);
    if (previous && JSON.stringify(previous) === JSON.stringify(card)) {
      console.log(`${rel} unchanged`);
      return 0;
    }
    writeFileSync(SCORECARD, `${JSON.stringify(card, null, 1)}\n`);
    console.log(`wrote ${rel}`);
    if (opts.commit) {
      const top5 = show(card.retrieval[0]?.hit5 ?? null);
      const pass = card.ask?.rows[0]?.pass ?? null;
      commitAsOwner(
        [rel],
        scoredRun
          ? `Score Ask on the ${card.questions} golden questions at block ${at.height}, so readers see how often it answers well: ${show(pass)} of scored answers pass, ${top5} find their claim in the top 5.`
          : `Refresh the scorecard at block ${at.height}, so it measures search over the claims published now: ${top5} of golden questions find their claim in the top 5.`,
        false,
      );
    }
  }
  return 0;
}
