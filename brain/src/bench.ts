// The golden question set (brain/bench/golden.yaml) against the store, so changes to search or the
// claims are measured instead of guessed at. Owner-run: the site runs no model for readers.
//
//   pnpm brain bench [--limit N] [--only kind,kind] [--ids g001,g002]
//   pnpm brain bench --publish [--commit]   the whole set, written to knowledge/bench.json (the
//                                           bench record the gaps view reads)
//
// Retrieval only, free and deterministic: does search put an expected claim in the top 12 that an
// assistant reading over MCP would see (hit@1, hit@5, hit@12, the reciprocal rank of the first
// expected claim, and whether every `must` claim is among them)? No model runs here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type BundleClaim,
  buildIndex,
  compile,
  Scorecard,
  type Stamp,
  searchClaims,
  sha256Hex,
} from "@blocklore/core";
import { loadStore, storeMoment } from "@blocklore/core/node";
import { parse } from "yaml";
import { z } from "zod";
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

/** How many claims, best first, retrieval is scored over. */
const TOP = 12;

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
      hit12: frac(hit(TOP), rs.length),
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

/** The public scorecard from one bench run: retrieval over the published claims. */
export function buildScorecard(input: {
  at: Stamp;
  golden: string;
  questions: Question[];
  claims: number;
  rows: RetrievalRow[];
}): Scorecard {
  const text = new Map(input.questions.map((q) => [q.id, q.q]));
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
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
    ask: null,
  });
}

export async function bench(opts: {
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
    searchClaims(index, claims, q, { limit: TOP }).flatMap((h) => {
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
      commitAsOwner(
        [rel],
        `Refresh the scorecard at block ${at.height}, so it measures search over the claims published now: ${top5} of golden questions find their claim in the top 5.`,
        false,
      );
    }
  }
  return 0;
}
