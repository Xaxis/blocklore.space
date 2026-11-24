// The evaluator's pure half (EDITORIAL.md, "The evaluator"). The gate (gate.ts) classifies a claim;
// this file holds what the evaluator does with that: the structural rules each kind of scrutiny
// adds, how every check combines into one decision (fail closed: any doubt holds or rejects, never
// publishes), the calibration that pauses automatic publishing when the evaluator stops catching
// the test claims mixed into its batches, and the deterministic mutations that make those test
// claims (canaries) from published ones. brain/src/evaluator.ts runs it with the network and the
// models. Pure: time, seeds and settings come in as arguments.
import { z } from "zod";
import type { Scrutiny } from "./gate.ts";
import { sha256Hex } from "./hash.ts";
import type { Claim, Source } from "./schema.ts";
import { styleIssues, wordCount } from "./style.ts";
import { validateClaim } from "./validate.ts";

// --- structural rules --------------------------------------------------------------------------

export interface RuleResult {
  rule: string;
  ok: boolean;
  /** What the rule checked, or what is wrong, in plain words. */
  detail: string;
}

export type RuleClaim = Pick<
  Claim,
  "statement" | "kind" | "status" | "people" | "attributed_to" | "sources" | "related"
>;

/** A URL as a place: no fragment, no trailing slash, host in lower case. */
export function samePlace(url: string | undefined): string {
  if (!url) return "";
  const bare = url.split("#")[0] as string;
  return bare.replace(/\/+$/, "").replace(/^https:\/\/([^/]+)/i, (_m, h: string) => {
    return `https://${h.toLowerCase()}`;
  });
}

/** Who published a source, for independence: the GitHub org, else the host without www. */
export function publisher(s: Pick<Source, "url" | "kind">): string {
  if (!s.url) return s.kind === "chain" ? "the chain" : "(no url)";
  const m = /^https:\/\/(?:www\.)?([^/]+)(?:\/([^/#?]+))?/i.exec(s.url);
  const host = (m?.[1] ?? s.url).toLowerCase();
  if (host === "github.com" && m?.[2]) return `github.com/${m[2].toLowerCase()}`;
  return host;
}

const LOADED = /\b(spam\w*|censor\w*|bloat\w*|ossif\w*)\b/gi;
const REPORTED =
  /\b(call|calls|called|calling|label|labels|labeled|labelled|term|terms|termed|describe|describes|described|so-called)\b(\W+\w+){0,4}\W*$/i;

/**
 * The loaded words (EDITORIAL.md, "Neutral words") a text uses in Blocklore's own voice: every
 * match of `words` (a global pattern) that is neither inside double quotes nor reported as what
 * people call things ("which critics call spam"). The claim rule looks for spam, censor, bloat and
 * ossify; a claim may use "filter" and "attack" in their settled technical sense (a Bloom filter, a
 * 51% attack). A debate's own words look for all six (core/src/debateview.ts).
 */
export function loadedWords(text: string, words: RegExp = LOADED): string[] {
  return [...text.matchAll(words)]
    .filter((m) => {
      const before = text.slice(0, m.index);
      const quoted = (before.match(/"/g)?.length ?? 0) % 2 === 1;
      return !quoted && !REPORTED.test(before);
    })
    .map((m) => m[0]);
}
const PREDICTION =
  /\b(will|is (?:likely|expected|certain|bound|set) to|is going to)\s+(?:\w+\s+)?(activate|be activated|pass|fail|succeed|be adopted|be merged|win|lose|prevail)\b/i;
const CONDITIONAL = /\b(if|once|when|unless|after|until)\b/i;
const UNCOUNTED =
  /\b(most|many|few|the majority of|a majority of|nearly all|almost all|everyone|nobody)\b(\W+\w+){0,4}\W+(developers?|users?|miners?|bitcoiners|node operators|people|holders|experts|contributors)\b/i;
const ADVICE: RegExp[] = [
  /\b(you|one)\s+(should|must|need to|ought to|have to|had better)\b/i,
  /\b(we|blocklore)\s+(recommend|suggest|advise|urge)\b/i,
  /(^|[.;:]\s+)(always|never|avoid|use|keep|store|make sure|ensure|do not|don't|buy|sell|hold|back up|write down|consider|remember)\b/i,
];
const ACCUSATION = /\b(scam(mer)?s?|fraud(ster)?s?|con artists?|thie(f|ves)|stole|steals?)\b/i;
const DATED =
  /\b(1[89]\d{2}|20\d{2})\b|\bblock \d[\d,]*\b|\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

/** Every structural rule by name, so a recorded failure can be read back one rule at a time. */
export const EVALUATOR_RULES = [
  "primary evidence",
  "their words or a primary record",
  "no predicted outcome",
  "counted with care",
  "neutral words",
  "links the sides",
  "attributed with a link",
  "in their own words",
  "dated",
  "not settled",
  "independent sources",
  "no advice voice",
  "no accusation",
  "named as listed",
  "person attributed",
] as const;
export type EvaluatorRule = (typeof EVALUATOR_RULES)[number];

/**
 * What each rule asks of a claim, in the words its pass and failure details use. The weekly review
 * of the loop (core/src/loopreview.ts) builds a standing lesson from it, so a lesson it proposes is
 * code's text, never a model's.
 */
export const RULE_TEXT: Record<EvaluatorRule, string> = {
  "primary evidence":
    "a T1 or T2 source supports a gated claim directly; media and social sources never carry a gated claim alone",
  "their words or a primary record":
    "each named person's part rests on their own words or a T1 or T2 record",
  "no predicted outcome":
    "it predicts no outcome; Blocklore reports parameters, signaling and stated plans, never whether a proposal will activate",
  "counted with care": "it says how many people hold a view only with a count and a method",
  "neutral words":
    "no loaded word in Blocklore's own voice; loaded words are reported as what people call things",
  "links the sides": "a contested claim links the sides in related",
  "attributed with a link":
    "a stance or argument names who holds it, each with a link to where they said it",
  "in their own words": "each holder's link is a cited source with a quote of their words",
  dated: "a position is dated: the statement or the cited source says when it was stated",
  "not settled":
    "a stance or argument is contested (or speculative for a projection), never established",
  "independent sources":
    "a claim on a safety topic, fact or advice, needs two independent publishers supporting it",
  "no advice voice":
    "it describes and does not tell the reader what to do; safety claims describe threats, tradeoffs and costs",
  "no accusation":
    "it names no person beside a word of fraud; only a court or regulator's finding allows that",
  "named as listed": "every person in people is named in the statement",
  "person attributed": "every named person is attributed with a link to where they said or did it",
};

/** One rule research broke lately: how often, and its latest failure as code recorded it. */
export interface HeldBack {
  rule: EvaluatorRule;
  count: number;
  /** The latest failure of the rule, as code recorded it. */
  detail: string;
  claim: string;
}

const RULE_START = new RegExp(
  `(?:^|; )(${EVALUATOR_RULES.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}): `,
  "g",
);

/** A failed rules stage's detail, back into its rules. A rule's own text may hold "; ". */
export function brokenRules(detail: string): { rule: EvaluatorRule; detail: string }[] {
  const starts = [...detail.matchAll(RULE_START)];
  return starts.map((m, i) => ({
    rule: m[1] as EvaluatorRule,
    detail: detail
      .slice((m.index ?? 0) + m[0].length, starts[i + 1]?.index ?? detail.length)
      .trim(),
  }));
}

/**
 * The rules broken in the last `recent` decisions, most often broken first. Only code's own reasons
 * are read (a failed rules stage); canaries, the evaluator's planted test claims, are left out.
 */
export function heldBack(
  decisions: readonly Pick<Decision, "id" | "canary" | "stages">[],
  recent = 80,
): HeldBack[] {
  const by = new Map<string, HeldBack>();
  for (const d of decisions.slice(-recent)) {
    if (d.canary) continue;
    const failed = d.stages.find((s) => s.stage === "rules" && !s.ok);
    if (!failed) continue;
    for (const b of brokenRules(failed.detail)) {
      const cur = by.get(b.rule);
      by.set(b.rule, { rule: b.rule, count: (cur?.count ?? 0) + 1, detail: b.detail, claim: d.id });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

const rule = (name: EvaluatorRule, ok: boolean, pass: string, fail: string): RuleResult => ({
  rule: name,
  ok,
  detail: ok ? pass : fail,
});

/**
 * The rules a gated claim must meet, by the scrutiny its gate reasons call for, derived from
 * CLAIMS.md and EDITORIAL.md. Every one is code: no model is asked. A failure is final for this
 * candidate (the evaluator rejects it, with the rule's words).
 */
export function structuralRules(c: RuleClaim, scrutiny: ReadonlySet<Scrutiny>): RuleResult[] {
  const out: RuleResult[] = [];
  const direct = c.sources.filter((s) => s.supports === "direct");
  const attributed = c.attributed_to ?? [];

  // Every gated claim: T3 and T4 never carry a gated claim alone (SECURITY.md, T2).
  out.push(
    rule(
      "primary evidence",
      direct.some((s) => s.tier === "T1" || s.tier === "T2"),
      "a T1 or T2 source supports it directly",
      "no T1 or T2 source supports it directly; media and social sources never carry a gated claim alone",
    ),
  );

  const position = c.kind === "stance" || c.kind === "argument";
  if (scrutiny.has("contested") || position) {
    const predicted = PREDICTION.test(c.statement) && !CONDITIONAL.test(c.statement);
    out.push(
      rule(
        "no predicted outcome",
        !predicted,
        "it predicts no outcome",
        "it predicts an outcome; Blocklore reports parameters, signaling and stated plans, never whether a proposal will activate",
      ),
    );
    // "most of the 40 developers surveyed" carries its count; "most developers" does not.
    const crowd = UNCOUNTED.exec(c.statement);
    const uncounted = !!crowd && !/\d/.test(crowd[0]);
    out.push(
      rule(
        "counted with care",
        !uncounted,
        "it counts no people without a number",
        "it says how many people hold a view without a count and a method",
      ),
    );
    if (!position) {
      const loaded = loadedWords(c.statement);
      out.push(
        rule(
          "neutral words",
          loaded.length === 0,
          "no loaded word in Blocklore's own voice",
          `"${loaded.join('", "')}" in Blocklore's own voice; report loaded words as what people call things`,
        ),
      );
    }
  }

  if (c.status === "contested")
    out.push(
      rule(
        "links the sides",
        (c.related?.length ?? 0) > 0,
        "it links related claims",
        "a contested claim links the sides (related), and this one links none",
      ),
    );

  if (position) {
    const linked = attributed.length > 0 && attributed.every((a) => !!a.url);
    out.push(
      rule(
        "attributed with a link",
        linked,
        `attributed to ${attributed.map((a) => a.name).join(", ")}, each with a link`,
        "a stance or argument names who holds it, each with a link to where they said it",
      ),
    );
    const cited = new Map(c.sources.filter((s) => s.quote).map((s) => [samePlace(s.url), s]));
    const missing = attributed.filter((a) => !cited.has(samePlace(a.url)));
    out.push(
      rule(
        "in their own words",
        linked && missing.length === 0,
        "each holder's link is a cited source with a quote of their words",
        `${missing.map((a) => a.name).join(", ") || "the holder"}: the link is not a cited source with a quote, so their own words are not shown`,
      ),
    );
    const sourceDated = attributed.some((a) => cited.get(samePlace(a.url))?.published);
    out.push(
      rule(
        "dated",
        DATED.test(c.statement) || sourceDated,
        "it says when the position was stated",
        "a position is dated: the statement or the cited source says when it was stated",
      ),
    );
    out.push(
      rule(
        "not settled",
        c.status === "contested" || c.status === "speculative",
        `status ${c.status}`,
        `a ${c.kind} is contested (or speculative for a projection), never ${c.status}`,
      ),
    );
  }

  if (scrutiny.has("safety")) {
    const supporting = c.sources.filter((s) => s.supports !== "background");
    const publishers = [...new Set(supporting.map(publisher))];
    out.push(
      rule(
        "independent sources",
        publishers.length >= 2 && direct.length > 0,
        `${publishers.length} independent sources (${publishers.join(", ")})`,
        `a claim on a safety topic, fact or advice, needs two independent publishers supporting it; it has ${publishers.length} (${publishers.join(", ") || "none"})`,
      ),
    );
    const advice = ADVICE.find((re) => re.test(c.statement));
    out.push(
      rule(
        "no advice voice",
        !advice,
        "it describes; it does not tell the reader what to do",
        "it tells the reader what to do; safety claims describe threats, tradeoffs and costs",
      ),
    );
    out.push(
      rule(
        "no accusation",
        !(c.people.length > 0 && ACCUSATION.test(c.statement)),
        "it calls no named person a scammer",
        "it names a person beside a word of fraud; only a court or regulator's finding allows that",
      ),
    );
  }

  if (scrutiny.has("person")) {
    const text = c.statement.toLowerCase();
    const unnamed = c.people.filter((p) => !text.includes(p.toLowerCase()));
    out.push(
      rule(
        "named as listed",
        unnamed.length === 0,
        "every person in people is named in the statement",
        `${unnamed.join(", ")} listed in people but not named in the statement`,
      ),
    );
    const byName = new Map(attributed.map((a) => [a.name.toLowerCase(), a]));
    const unlinked = c.people.filter((p) => !byName.get(p.toLowerCase())?.url);
    out.push(
      rule(
        "person attributed",
        unlinked.length === 0,
        "every named person is attributed with a link",
        `${unlinked.join(", ")}: not attributed with a link to where they said or did it`,
      ),
    );
    const unsupported = c.people.filter((p) => {
      const own = samePlace(byName.get(p.toLowerCase())?.url);
      return !direct.some(
        (s) => (own && samePlace(s.url) === own) || s.tier === "T1" || s.tier === "T2",
      );
    });
    out.push(
      rule(
        "their words or a primary record",
        unsupported.length === 0,
        "each named person's part rests on their own words or a T1 or T2 record",
        `${unsupported.join(", ")}: no direct source is their own words or a T1 or T2 record`,
      ),
    );
  }
  return out;
}

// --- the decision ------------------------------------------------------------------------------

export const STAGES = ["recheck", "rules", "verifier-a", "verifier-b"] as const;
export type StageName = (typeof STAGES)[number];

export const Stage = z.object({
  stage: z.enum(STAGES),
  /** true passed, false failed (final), null could not run or could not tell (try again). */
  ok: z.boolean().nullable(),
  detail: z.string().max(1500),
  model: z.string().optional(),
});
export type Stage = z.infer<typeof Stage>;

export const OUTCOMES = ["publish", "hold", "reject"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * One decision from every stage, failing closed: a failed stage rejects; a stage that could not
 * run or is missing holds; only every stage passing, with publishing allowed, publishes.
 */
export function decide(
  stages: readonly Stage[],
  publishing: { allowed: boolean; why: string | null },
): { outcome: Outcome; why: string } {
  const failed = stages.find((s) => s.ok === false);
  if (failed) return { outcome: "reject", why: `${failed.stage}: ${failed.detail}` };
  for (const name of STAGES) {
    const s = stages.find((x) => x.stage === name);
    if (!s) return { outcome: "hold", why: `${name}: did not run` };
    if (s.ok !== true) return { outcome: "hold", why: `${name}: ${s.detail}` };
  }
  if (!publishing.allowed)
    return { outcome: "hold", why: publishing.why ?? "automatic publishing is paused" };
  return { outcome: "publish", why: "every check passed" };
}

/** A verifier's verdict on one candidate, as a stage. Only accept passes. */
export function verdictStage(
  stage: "verifier-a" | "verifier-b",
  model: string,
  verdict: { verdict: "accept" | "revise" | "reject"; reason: string } | null,
  problem?: string,
): Stage {
  if (!verdict)
    return { stage, model, ok: null, detail: problem ?? "the verifier wrote no valid verdict" };
  const ok = verdict.verdict === "accept";
  return {
    stage,
    model,
    ok,
    detail: `${verdict.verdict}: ${verdict.reason}`.slice(0, 1500),
  };
}

// --- calibration -------------------------------------------------------------------------------

/** Below this many conclusive canaries the evaluator does not publish: it is still calibrating. */
export const MIN_CANARIES = 5;

export interface CanaryResult {
  at: string;
  kind: string;
  /** The evaluator rejected it. A canary held for a stage that could not run is not counted. */
  caught: boolean;
}

export interface Calibration {
  total: number;
  caught: number;
  recent: number;
  recentCaught: number;
  rate: number | null;
  kinds: Array<{ kind: string; n: number; caught: number }>;
  /** Whether gated claims may publish automatically. */
  publishing: boolean;
  why: string | null;
}

const pct = (x: number) => `${Math.round(x * 100)} percent`;

/** The catch rate over the recent window (results oldest first) against the owner's threshold. */
export function calibration(
  results: readonly CanaryResult[],
  s: { window: number; minCatchRate: number },
): Calibration {
  const recent = results.slice(-s.window);
  const recentCaught = recent.filter((r) => r.caught).length;
  const kinds = new Map<string, { n: number; caught: number }>();
  for (const r of results) {
    const k = kinds.get(r.kind) ?? { n: 0, caught: 0 };
    k.n++;
    if (r.caught) k.caught++;
    kinds.set(r.kind, k);
  }
  const rate = recent.length ? recentCaught / recent.length : null;
  let why: string | null = null;
  if (recent.length < MIN_CANARIES)
    why = `calibrating: ${recent.length} of ${MIN_CANARIES} test claims evaluated so far`;
  else if ((rate as number) < s.minCatchRate)
    why = `paused: the evaluator caught ${recentCaught} of the last ${recent.length} test claims (${pct(rate as number)}), below the owner's ${pct(s.minCatchRate)}`;
  return {
    total: results.length,
    caught: results.filter((r) => r.caught).length,
    recent: recent.length,
    recentCaught,
    rate,
    kinds: [...kinds]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    publishing: why === null,
    why,
  };
}

/** Publishing for one batch: the calibration allows it and none of the batch's own canaries slipped. */
export function batchPublishing(
  cal: Calibration,
  missedInBatch: number,
): { allowed: boolean; why: string | null } {
  if (missedInBatch > 0)
    return {
      allowed: false,
      why: `${missedInBatch} test claim${missedInBatch === 1 ? "" : "s"} in this batch passed every check, so nothing from it publishes`,
    };
  return { allowed: cal.publishing, why: cal.why };
}

// --- canaries ----------------------------------------------------------------------------------

export const MUTATIONS = ["number", "name", "hedge", "quote", "stance", "revoked"] as const;
export type Mutation = (typeof MUTATIONS)[number];

export const MUTATION_LABEL: Record<Mutation, string> = {
  number: "a number changed",
  name: "a name or attribution swapped",
  hedge: "a hedge or qualifier dropped",
  quote: "a quote that does not support the statement",
  stance: "a position stated as fact",
  revoked: "a claim the owner revoked",
};

/** The content of a claim without its history: what a candidate proposes. */
export type ClaimContent = Omit<
  Claim,
  "first_seen" | "last_verified" | "run" | "revisions" | "review"
>;

export interface Canary {
  id: string;
  kind: Mutation;
  /** The published (or revoked) claim it was made from. */
  source: string;
  candidate: ClaimContent;
}

/** A deterministic index in [0, n) from a seed and a label. */
export function pick(seed: string, label: string, n: number): number {
  if (n <= 0) return 0;
  return Number.parseInt(sha256Hex(`${seed}:${label}`).slice(0, 12), 16) % n;
}

export function contentOf(c: Claim | ClaimContent): ClaimContent {
  const {
    first_seen: _f,
    last_verified: _l,
    run: _r,
    revisions: _v,
    review: _w,
    ...rest
  } = c as Claim;
  return structuredClone(rest);
}

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

function formatLike(original: string, value: number): string {
  const decimals = original.includes(".") ? (original.split(".")[1]?.length ?? 0) : 0;
  const fixed = value.toFixed(decimals);
  if (!original.includes(",")) return fixed;
  const [int, frac] = fixed.split(".");
  const grouped = (int as string).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

function changeNumber(c: ClaimContent, seed: string): ClaimContent | null {
  const quotes = c.sources.map((s) => s.quote ?? "").join(" ");
  const found = [...c.statement.matchAll(NUMBER)].filter((m) => {
    const before = c.statement.slice(Math.max(0, (m.index ?? 0) - 9), m.index);
    return !/(BIP|PR|#|Newsletter)\s*#?\s*$/i.test(before) && !/\d\.$/.test(before);
  });
  if (found.length === 0) return null;
  const m = found[pick(seed, "number", found.length)] as RegExpMatchArray;
  const text = m[0];
  const value = Number(text.replace(/,/g, ""));
  for (let k = 1; k <= 4; k++) {
    let next: number;
    if (/^(19|20)\d{2}$/.test(text)) next = value + k;
    else if (value < 10 && !text.includes(".")) next = value + k;
    else if (text.includes(".")) next = value * (1 + k);
    else {
      const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
      next = value + step * (k + 1);
    }
    const out = formatLike(text, next);
    if (out === text || quotes.includes(out) || quotes.includes(out.replace(/,/g, ""))) continue;
    const at = m.index ?? 0;
    return {
      ...c,
      statement: `${c.statement.slice(0, at)}${out}${c.statement.slice(at + text.length)}`,
    };
  }
  return null;
}

function swapName(
  c: ClaimContent,
  pool: readonly ClaimContent[],
  seed: string,
): ClaimContent | null {
  const own = new Set(c.people.map((p) => p.toLowerCase()));
  const others = [
    ...new Set(pool.flatMap((o) => [...o.people, ...(o.attributed_to ?? []).map((a) => a.name)])),
  ]
    .filter((n) => !own.has(n.toLowerCase()) && /^[A-Z]/.test(n))
    .sort();
  const named = c.people.filter((p) => c.statement.includes(p));
  if (named.length > 0 && others.length > 0) {
    const from = named[pick(seed, "person", named.length)] as string;
    const to = others[pick(seed, "swap", others.length)] as string;
    const swap = (s: string) => s.split(from).join(to);
    return {
      ...c,
      statement: swap(c.statement),
      people: c.people.map((p) => (p === from ? to : p)),
      attributed_to: c.attributed_to?.map((a) => (a.name === from ? { ...a, name: to } : a)),
    };
  }
  const bips = [...c.statement.matchAll(/\bBIP (\d{1,4})\b/g)];
  if (bips.length === 0) return null;
  const m = bips[pick(seed, "bip", bips.length)] as RegExpMatchArray;
  const n = Number(m[1]);
  const known = [
    ...new Set(
      pool.flatMap((o) => [...o.statement.matchAll(/\bBIP (\d{1,4})\b/g)].map((x) => Number(x[1]))),
    ),
  ]
    .filter((x) => x !== n && !c.statement.includes(`BIP ${x}`))
    .sort((a, b) => a - b);
  const to = known.length ? (known[pick(seed, "bipto", known.length)] as number) : n + 1;
  const at = m.index ?? 0;
  return {
    ...c,
    statement: `${c.statement.slice(0, at)}BIP ${to}${c.statement.slice(at + m[0].length)}`,
  };
}

const HEDGES: Array<[RegExp, string]> = [
  [/\b(may|might|could)\b/i, "will"],
  [/\b(usually|typically|often|generally|normally)\b/i, "always"],
  [/\b(about|approximately|roughly|around|nearly|almost|up to|at most|at least) (?=\d)/i, ""],
  [/\bcan\b/i, "will"],
  [/\b(some|most|many)\b/i, "all"],
];

function dropHedge(c: ClaimContent, seed: string): ClaimContent | null {
  const start = pick(seed, "hedge", HEDGES.length);
  for (let i = 0; i < HEDGES.length; i++) {
    const [re, to] = HEDGES[(start + i) % HEDGES.length] as [RegExp, string];
    const m = re.exec(c.statement);
    if (!m) continue;
    const at = m.index;
    const word = m[0];
    const upper = word[0] === word[0]?.toUpperCase() && /[A-Z]/.test(word[0] ?? "");
    const rep = upper && to ? `${to[0]?.toUpperCase()}${to.slice(1)}` : to;
    const statement = `${c.statement.slice(0, at)}${rep}${c.statement.slice(at + word.length)}`
      .replace(/\s{2,}/g, " ")
      .replace(/^\s+/, "");
    return { ...c, statement: statement[0]?.toUpperCase() + statement.slice(1) };
  }
  return null;
}

function swapQuote(
  c: ClaimContent,
  pool: readonly ClaimContent[],
  seed: string,
): ClaimContent | null {
  const donors = pool.filter(
    (o) =>
      o.id !== c.id &&
      o.topics[0] !== c.topics[0] &&
      o.sources.some((s) => s.supports === "direct" && s.quote),
  );
  if (donors.length === 0) return null;
  const d = donors[pick(seed, "donor", donors.length)] as ClaimContent;
  const sources = d.sources.filter((s) => s.supports === "direct" && s.quote);
  return { ...c, sources: structuredClone(sources), checks: undefined };
}

const LEAD =
  /^(.*?)\b(argued|argues|argue|wrote|writes|stated|states|said|says|claimed|claims|contended|contends|maintains|maintained|motivates|motivated|holds)\s+(that\s+)?/i;

function stanceAsFact(c: ClaimContent): ClaimContent | null {
  const attributed = c.kind === "stance" || c.kind === "argument" || !!c.attributed_to?.length;
  let statement: string | null = null;
  const lead = LEAD.exec(c.statement);
  if (attributed && lead && lead[0].length < c.statement.length - 20) {
    const rest = c.statement.slice(lead[0].length);
    statement = `${rest[0]?.toUpperCase()}${rest.slice(1)}`;
  } else if (c.status === "speculative" && /\bwould\b/.test(c.statement)) {
    statement = c.statement.replace(/\bwould\b/, "will");
  }
  if (!statement) return null;
  const text = statement.toLowerCase();
  return {
    ...c,
    statement,
    kind: "fact",
    status: "established",
    attributed_to: undefined,
    people: c.people.filter((p) => text.includes(p.toLowerCase())),
  };
}

const SUFFIXES = [
  "rule",
  "detail",
  "record",
  "basis",
  "scope",
  "limit",
  "count",
  "effect",
  "origin",
];

/** A fresh id on the source's topic that no claim, candidate or earlier canary has used. */
function canaryId(source: ClaimContent, seed: string, taken: ReadonlySet<string>): string | null {
  const slug = source.id.slice(source.id.indexOf(".") + 1).replace(/-\d+$/, "");
  const topic = source.topics[0] as string;
  const start = pick(seed, `id:${source.id}`, SUFFIXES.length);
  for (let i = 0; i < SUFFIXES.length; i++) {
    const id = `${topic}.${slug}-${SUFFIXES[(start + i) % SUFFIXES.length]}`;
    if (!taken.has(id) && id.length <= 120) return id;
  }
  return null;
}

/** Whether a mutated candidate still meets the schema's rules, so code alone does not catch it. */
function wellFormed(c: ClaimContent): boolean {
  const at = { time: "2009-01-03T18:15:05Z", height: 0 };
  const claim = {
    ...c,
    first_seen: at,
    last_verified: { ...at, run: "canary", method: "canary" },
    run: "canary",
    revisions: [{ rev: 1, at, run: "canary", change: "created" as const }],
  };
  const words = wordCount(c.statement);
  return (
    words >= 12 &&
    words <= 80 &&
    styleIssues(c.statement).length === 0 &&
    validateClaim(claim).every((i) => i.level !== "error")
  );
}

export function mutate(
  kind: Exclude<Mutation, "revoked">,
  source: ClaimContent,
  pool: readonly ClaimContent[],
  seed: string,
): ClaimContent | null {
  const c = contentOf(source);
  const out =
    kind === "number"
      ? changeNumber(c, seed)
      : kind === "name"
        ? swapName(c, pool, seed)
        : kind === "hedge"
          ? dropHedge(c, seed)
          : kind === "quote"
            ? swapQuote(c, pool, seed)
            : stanceAsFact(c);
  if (!out || (out.statement === source.statement && kind !== "quote")) return null;
  return wellFormed(out) ? out : null;
}

/**
 * `n` canaries for one batch, deterministically from the seed: the kinds rotate from a seeded
 * start, each made from a seeded published claim (or a revoked one, verbatim), under a fresh id.
 * Kinds that no claim allows are skipped. The caller registers them before anything is written.
 */
export function makeCanaries(
  seed: string,
  published: readonly ClaimContent[],
  revoked: readonly ClaimContent[],
  n: number,
  taken: ReadonlySet<string>,
): Canary[] {
  const used = new Set(taken);
  const out: Canary[] = [];
  const pool = published.filter((c) => c.status !== "withdrawn" && c.status !== "superseded");
  const start = pick(seed, "kind", MUTATIONS.length);
  for (let i = 0, tries = 0; out.length < n && tries < n * MUTATIONS.length * 3; tries++, i++) {
    const kind = MUTATIONS[(start + i) % MUTATIONS.length] as Mutation;
    const s = `${seed}:${i}`;
    let made: { source: ClaimContent; candidate: ClaimContent } | null = null;
    if (kind === "revoked") {
      if (revoked.length) {
        const source = revoked[pick(s, "revoked", revoked.length)] as ClaimContent;
        const candidate = contentOf(source);
        if (candidate.status === "withdrawn") candidate.status = "established";
        made = { source, candidate };
      }
    } else if (pool.length) {
      for (let k = 0; k < 6 && !made; k++) {
        const source = pool[pick(s, `src${k}`, pool.length)] as ClaimContent;
        const candidate = mutate(kind, source, pool, `${s}:${k}`);
        if (candidate) made = { source, candidate };
      }
    }
    if (!made) continue;
    const id = canaryId(made.source, s, used);
    if (!id) continue;
    used.add(id);
    const {
      change: _c,
      note: _n,
      ...content
    } = made.candidate as ClaimContent & {
      change?: unknown;
      note?: unknown;
    };
    out.push({
      id,
      kind,
      source: made.source.id,
      candidate: {
        ...content,
        id,
        related: undefined,
        supersedes: undefined,
        superseded_by: undefined,
      },
    });
  }
  return out;
}

/** The fingerprint the publisher refuses: a canary's statement, whitespace and case folded. */
export function statementPrint(statement: string): string {
  return sha256Hex(statement.replace(/\s+/g, " ").trim().toLowerCase());
}

// --- what the admin shows ---------------------------------------------------------------------

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

/** One evaluation of one candidate, as the devbox keeps it (private: it holds the statement). */
export const Decision = z.object({
  at: iso,
  batch: z.string(),
  id: z.string(),
  topic: z.string(),
  statement: z.string(),
  /** The candidate's hash when it was evaluated; publishing checks it has not changed since. */
  hash: z.string(),
  updates: z.boolean(),
  /** Set for a test claim: what was mutated and from which claim. */
  canary: z.object({ kind: z.enum(MUTATIONS), source: z.string() }).nullable(),
  reasons: z.array(z.string()),
  stages: z.array(Stage),
  /** The decision before calibration: what the checks alone said. */
  raw: z.enum(OUTCOMES),
  outcome: z.enum(OUTCOMES),
  why: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export const EvaluatorView = z.object({
  at: iso,
  decides: z.enum(["evaluator", "owner"]),
  /** ready: deciding; calibrating or paused: deciding but not publishing; waiting: no token. */
  state: z.enum(["ready", "calibrating", "paused", "waiting", "owner"]),
  why: z.string(),
  backlog: z.number().int().min(0),
  due: z.number().int().min(0),
  calibration: z.object({
    total: z.number(),
    caught: z.number(),
    recent: z.number(),
    recentCaught: z.number(),
    rate: z.number().nullable(),
    threshold: z.number(),
    window: z.number(),
    kinds: z.array(z.object({ kind: z.string(), n: z.number(), caught: z.number() })),
  }),
  decisions: z.array(Decision).max(120),
  /** Gated claims the evaluator published lately, with their published hash, to revoke. */
  published: z
    .array(
      z.object({
        id: z.string(),
        hash: z.string(),
        statement: z.string(),
        at: iso,
        batch: z.string(),
      }),
    )
    .max(60),
  lastBatch: z.object({ id: z.string(), at: iso, note: z.string() }).nullable(),
  /** Who signed the last batch's decisions (ORANGECHECK.md); null when they were not signed. */
  signed: z
    .object({ by: z.string(), authority: z.enum(["delegated", "alone"]) })
    .nullable()
    .default(null),
});
export type EvaluatorView = z.infer<typeof EvaluatorView>;
