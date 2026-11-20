// The golden question set (brain/bench/golden.yaml) against the store, so changes to search, the
// Ask prompt or the claims are measured instead of guessed at.
//
//   pnpm brain bench                      retrieval only: free and deterministic
//   pnpm brain bench --ask [--limit N] [--only kind,kind] [--ids g001,g002]
//                                         also writes answers with the model, as /ask does,
//                                         charged to the brain's daily budget
//
// Retrieval: does search put an expected claim in the 12 that Ask reads (hit@1, hit@5, hit@12, the
// reciprocal rank of the first expected claim, and whether every `must` claim is among them)?
// Answers: does Ask answer covered questions from the expected claims, say "not covered" for
// uncovered ones, decline the ones it should, and pass its own check? Value questions are listed
// for a person to read: whether an answer takes a side is not something code can score.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  ANSWER_SCHEMA,
  ASK,
  ASK_SYSTEM,
  type AskAnswer,
  askPrompt,
  type BundleClaim,
  buildIndex,
  checkAnswer,
  compile,
  costMicros,
  refusalAnswer,
  scopeRefusal,
  searchClaims,
  worstCaseMicros,
} from "@blocklore/core";
import { loadStore, storeMoment } from "@blocklore/core/node";
import { parse } from "yaml";
import { z } from "zod";
import { DAILY_BUDGET_USD, recordSpend, spentToday } from "./agent.ts";
import { ROOT, VAR } from "./env.ts";

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

export function loadGolden(file = path.join(ROOT, "brain", "bench", "golden.yaml")): Question[] {
  return Golden.parse(parse(readFileSync(file, "utf8"), { uniqueKeys: true })).questions;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

interface RetrievalRow {
  id: string;
  kind: Kind;
  rank: number | null;
  must: boolean;
  top: string[];
}

function retrievalReport(rows: RetrievalRow[]) {
  const by = (k?: Kind) => rows.filter((r) => !k || r.kind === k);
  const line = (label: string, rs: RetrievalRow[]) => {
    const hit = (k: number) => rs.filter((r) => r.rank !== null && r.rank <= k).length;
    const mrr = rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / (rs.length || 1);
    return `${label.padEnd(10)} n=${String(rs.length).padStart(3)}  hit@1 ${pct(hit(1), rs.length).padStart(6)}  hit@5 ${pct(hit(5), rs.length).padStart(6)}  hit@12 ${pct(hit(ASK.claims), rs.length).padStart(6)}  must@12 ${pct(rs.filter((r) => r.must).length, rs.length).padStart(6)}  MRR ${mrr.toFixed(3)}`;
  };
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return [line("all", by()), ...kinds.map((k) => line(k, by(k)))];
}

interface AskRow {
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

export async function bench(opts: {
  ask: boolean;
  limit?: number;
  only?: string[];
  ids?: string[];
}): Promise<number> {
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

  if (opts.ask) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set (.env)");
    const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
    const asked: AskRow[] = [];
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
      if (spentToday() + worstCaseMicros(ASK_SYSTEM, prompt) / 1e6 > DAILY_BUDGET_USD) {
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
    const kinds = [...new Set(asked.map((r) => r.kind))];
    const total = asked.reduce((s, r) => s + r.micros, 0) / 1e6;
    console.log(
      `\nAnswers (${asked.length}, ${ASK.model}, effort ${ASK.effort}, $${total.toFixed(2)}):`,
    );
    for (const k of kinds) {
      const rs = asked.filter((r) => r.kind === k);
      const scored = rs.filter((r) => r.pass !== null);
      const g = rs.filter((r) => r.grounded !== null);
      const mu = rs.filter((r) => r.must !== null);
      const verdicts = Object.entries(
        rs.reduce<Record<string, number>>((o, r) => {
          const v = r.verdict ?? r.mode;
          o[v] = (o[v] ?? 0) + 1;
          return o;
        }, {}),
      )
        .map(([v, n]) => `${v} ${n}`)
        .join(", ");
      console.log(
        `  ${k.padEnd(10)} n=${String(rs.length).padStart(3)}  pass ${scored.length ? pct(scored.filter((r) => r.pass).length, scored.length) : "(read them)"}  grounded ${pct(g.filter((r) => r.grounded).length, g.length)}  must ${pct(mu.filter((r) => r.must).length, mu.length)}  [${verdicts}]`,
      );
    }
    const failedCheck = asked.filter((r) => r.mode === "check_failed");
    console.log(
      `  rejected by the answer check: ${failedCheck.length}; model errors: ${asked.filter((r) => r.mode === "model_error").length}; median ${[...asked].sort((a, b) => a.ms - b.ms)[Math.floor(asked.length / 2)]?.ms ?? 0} ms`,
    );
    const fails = asked.filter((r) => r.pass === false);
    if (fails.length) {
      console.log(`\nFailed (${fails.length}):`);
      for (const r of fails)
        console.log(
          `  ${r.id} ${r.kind} -> ${r.verdict ?? r.mode}  "${r.q}"\n      ${r.problems ? `problems: ${r.problems.join("; ")}` : r.text.slice(0, 220)}`,
        );
    }
    if (stopped) console.log(`\nStopped early: ${stopped}.`);
    report.ask = { model: ASK.model, effort: ASK.effort, usd: total, rows: asked };
  }

  const file = path.join(out, `${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\nfull report: ${path.relative(ROOT, file)}`);
  return 0;
}
