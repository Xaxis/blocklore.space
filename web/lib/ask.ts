import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  ANSWER_SCHEMA,
  ASK,
  ASK_SYSTEM,
  type AskAnswer,
  askPrompt,
  checkAnswer,
  costMicros,
  DEPTHS,
  type Depth,
  REFUSAL_TEXT,
  readQuestion,
  refusalAnswer,
  scopeRefusal,
  worstCaseMicros,
} from "@blocklore/core";
import type { Redis } from "@upstash/redis";
import { claimSummary, edition, retrieve } from "./api";
import { devMemory, salt as getSalt, kv, PRODUCTION, utcDay, visitorHash } from "./kv";
import { queueTicket } from "./queue";

// Ask the Brain, the site's half (core/src/ask.ts is the other): the budget, the per-visitor
// limits, the answer cache and the model call. Every path that cannot write a checked answer shows
// the claims search found instead, and says why. The question is never logged or stored, except
// as a hash keying a cached answer.

/** Model answers a visitor may get per hour and per UTC day; cached answers do not count. */
export const VISITOR_LIMIT = { hour: 6, day: 20 };
const CACHE_SECONDS = 24 * 3600;

export type AskMode = "answer" | "cached" | "refused" | "no_match" | "claims_only";
export type FallbackReason =
  | "budget"
  | "visitor_limit"
  | "unavailable"
  | "model_error"
  | "model_declined"
  | "check_failed";

export const FALLBACK_TEXT: Record<FallbackReason, string> = {
  budget:
    "Today's budget for written answers is spent; it resets at 00:00 UTC. These are the claims that match your question best.",
  visitor_limit: `Written answers are limited to ${VISITOR_LIMIT.hour} an hour and ${VISITOR_LIMIT.day} a day for each visitor. These are the claims that match your question best.`,
  unavailable:
    "Written answers are not available right now. These are the claims that match your question best.",
  model_error:
    "The model did not answer in time. These are the claims that match your question best.",
  model_declined:
    "The model declined to answer this question. These are the claims that match it best.",
  check_failed:
    "The written answer did not pass Blocklore's checks (every sentence must cite a claim it was given, in the house style), so it is not shown. These are the claims that match your question best.",
};

type Summary = ReturnType<typeof claimSummary>;
export interface AskResult {
  edition: ReturnType<typeof edition>;
  question: string;
  depth: Depth;
  mode: AskMode;
  reason: FallbackReason | null;
  /** Why there is no written answer, or the refusal, in Blocklore's words. */
  note: string | null;
  answer: AskAnswer | null;
  /** Claims the answer cites, in the order of their numbers. */
  cited: Summary[];
  /** Every claim search found and the model read, best first. */
  read: Summary[];
  model: string | null;
  /** For a question about Bitcoin that Blocklore does not cover yet: queues it for research. */
  queue_ticket: string | null;
}
export type AskEvent =
  | { type: "read"; read: Summary[] }
  | { type: "result"; result: AskResult }
  | { type: "error"; error: string };

// --- the store ----------------------------------------------------------------------------------

interface AskStore {
  /** Adds `micros` to the day's spend unless that would pass `cap`; false if it would. */
  reserve(day: string, micros: number, cap: number): Promise<boolean>;
  adjust(day: string, delta: number): Promise<void>;
  /** Counts one model answer for a visitor and returns the counts so far. */
  count(visitor: string, hour: string, day: string): Promise<{ hour: number; day: number }>;
  cached(key: string): Promise<AskAnswer | null>;
  cache(key: string, answer: AskAnswer): Promise<void>;
}

const RESERVE = `local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], 259200)
return 1`;

function redisStore(redis: Redis): AskStore {
  return {
    async reserve(day, micros, cap) {
      return (await redis.eval(RESERVE, [`ask:spend:${day}`], [micros, cap])) === 1;
    },
    async adjust(day, delta) {
      if (delta) await redis.incrby(`ask:spend:${day}`, delta);
    },
    async count(visitor, hour, day) {
      const h = `ask:v:${visitor}:${hour}`;
      const d = `ask:v:${visitor}:${day}`;
      const [hn, , dn] = await redis
        .pipeline()
        .incr(h)
        .expire(h, 3600)
        .incr(d)
        .expire(d, 86400)
        .exec<[number, number, number, number]>();
      return { hour: hn, day: dn };
    },
    async cached(key) {
      return (await redis.get<AskAnswer>(`ask:answer:${key}`)) ?? null;
    },
    async cache(key, answer) {
      await redis.set(`ask:answer:${key}`, answer, { ex: CACHE_SECONDS });
    },
  };
}

/** For `next dev` without a Redis: the same rules, in memory, forgotten on restart. */
function memoryStore(): AskStore {
  const { n, answers } = devMemory("ask", () => ({
    n: new Map<string, number>(),
    answers: new Map<string, AskAnswer>(),
  }));
  const add = (k: string, d: number) => {
    const v = (n.get(k) ?? 0) + d;
    n.set(k, v);
    return v;
  };
  return {
    async reserve(day, micros, cap) {
      if ((n.get(`spend:${day}`) ?? 0) + micros > cap) return false;
      add(`spend:${day}`, micros);
      return true;
    },
    async adjust(day, delta) {
      add(`spend:${day}`, delta);
    },
    async count(visitor, hour, day) {
      return { hour: add(`${visitor}:${hour}`, 1), day: add(`${visitor}:${day}`, 1) };
    },
    async cached(key) {
      return answers.get(key) ?? null;
    },
    async cache(key, answer) {
      answers.set(key, answer);
    },
  };
}

interface Setup {
  store: AskStore;
  client: Anthropic;
  salt: string;
  capMicros: number;
}
let setup: Setup | null | undefined;

/** What written answers need; null in production when any of it is missing (fail closed). */
function getSetup(): Setup | null {
  if (setup !== undefined) return setup;
  const key = process.env.ANTHROPIC_API_KEY;
  const redis = kv();
  const salt = getSalt();
  const budget = Number(process.env.ASK_DAILY_BUDGET_USD ?? "2");
  if (!key || !salt || !(budget > 0) || (PRODUCTION && !redis)) {
    setup = null;
    return setup;
  }
  setup = {
    store: redis ? redisStore(redis) : memoryStore(),
    client: new Anthropic({ apiKey: key, maxRetries: 1, timeout: 50_000 }),
    salt,
    capMicros: Math.round(budget * 1_000_000),
  };
  return setup;
}

// --- asking -------------------------------------------------------------------------------------

export type AskInput = { q: unknown; depth?: unknown };
export type Refused = { status: number; error: string };

/** Reads the request; a refusal here (a secret, an empty or long question) is a 400. */
export function readAsk(input: AskInput): { question: string; depth: Depth } | Refused {
  const r = readQuestion(input.q);
  if ("error" in r) return { status: 400, error: r.error };
  const depth = (DEPTHS as readonly unknown[]).includes(input.depth)
    ? (input.depth as Depth)
    : "user";
  return { question: r.question, depth };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Answers a question, emitting the claims read as soon as search finds them and then the result.
 * `ip` only feeds a salted hash that keys the visitor's counters; it is not stored.
 */
export async function ask(
  q: { question: string; depth: Depth },
  ip: string,
  emit: (e: AskEvent) => void = () => {},
): Promise<AskResult> {
  const started = Date.now();
  const base = {
    edition: edition(),
    question: q.question,
    depth: q.depth,
    model: null,
    queue_ticket: null,
  };
  const finish = (r: AskResult, cost = 0) => {
    // One line per answer for the owner: what happened, never what was asked.
    console.log(
      JSON.stringify({
        ask: r.mode,
        reason: r.reason,
        verdict: r.answer?.verdict ?? null,
        read: r.read.length,
        cited: r.cited.length,
        micros: cost,
        ms: Date.now() - started,
      }),
    );
    emit({ type: "result", result: r });
    return r;
  };

  const out = scopeRefusal(q.question);
  if (out)
    return finish({
      ...base,
      mode: "refused",
      reason: null,
      note: REFUSAL_TEXT[out],
      answer: refusalAnswer(out),
      cited: [],
      read: [],
    });

  const claims = retrieve(q.question, ASK.claims);
  const read = claims.map(claimSummary);
  emit({ type: "read", read });
  const claimsOnly = (reason: FallbackReason, cost = 0) =>
    finish(
      {
        ...base,
        mode: "claims_only",
        reason,
        note: FALLBACK_TEXT[reason],
        answer: null,
        cited: [],
        read,
      },
      cost,
    );
  if (!claims.length)
    return finish({
      ...base,
      mode: "no_match",
      reason: null,
      note: "Blocklore has no published claim that matches this question yet.",
      answer: null,
      cited: [],
      read,
    });

  const s = getSetup();
  if (!s) return claimsOnly("unavailable");
  const now = new Date();
  const day = utcDay(now);
  const hour = now.toISOString().slice(0, 13);
  const key = sha256(
    JSON.stringify([
      base.edition.generated.time,
      base.edition.build,
      q.depth,
      q.question.toLowerCase(),
    ]),
  );
  const byId = new Map(read.map((c) => [c.id, c]));
  const shown = (answer: AskAnswer, mode: AskMode, cost = 0) =>
    finish(
      {
        ...base,
        model: ASK.model,
        mode,
        reason: null,
        note: answer.refusal ? REFUSAL_TEXT[answer.refusal] : null,
        answer,
        queue_ticket:
          answer.aboutBitcoin && (answer.verdict === "partial" || answer.verdict === "not_covered")
            ? queueTicket(s.salt, q.question, answer.missing ?? "", day)
            : null,
        cited: answer.claims.flatMap((id) => {
          const c = byId.get(id);
          return c ? [c] : [];
        }),
        read,
      },
      cost,
    );

  try {
    const hit = await s.store.cached(key);
    if (hit?.claims.every((id) => byId.has(id))) return shown(hit, "cached");
  } catch {
    // A cache that cannot be read is a cache miss.
  }

  const visitor = visitorHash(s.salt, ip, day);
  try {
    const n = await s.store.count(visitor, hour, day);
    if (n.hour > VISITOR_LIMIT.hour || n.day > VISITOR_LIMIT.day)
      return claimsOnly("visitor_limit");
  } catch {
    return claimsOnly("unavailable");
  }

  const prompt = askPrompt(q.question, q.depth, claims);
  const reserved = worstCaseMicros(ASK_SYSTEM, prompt);
  try {
    if (!(await s.store.reserve(day, reserved, s.capMicros))) return claimsOnly("budget");
  } catch {
    return claimsOnly("unavailable");
  }

  let message: Anthropic.Message;
  try {
    message = await s.client.messages.create({
      model: ASK.model,
      max_tokens: ASK.maxTokens,
      system: ASK_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: ASK.effort, format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    });
  } catch (e) {
    // A failed request is not billed; give the reservation back.
    await s.store.adjust(day, -reserved).catch(() => {});
    console.error(`ask: model call failed: ${e instanceof Error ? e.name : "error"}`);
    return claimsOnly("model_error");
  }
  const cost = costMicros(message.usage);
  await s.store.adjust(day, cost - reserved).catch(() => {});

  if (message.stop_reason === "refusal") return claimsOnly("model_declined", cost);
  if (message.stop_reason !== "end_turn") return claimsOnly("model_error", cost);
  const raw = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const checked = checkAnswer(
    raw,
    claims.map((c) => c.id),
  );
  if (!checked.ok) {
    console.error(`ask: answer rejected: ${checked.problems.join("; ")}`);
    return claimsOnly("check_failed", cost);
  }
  await s.store.cache(key, checked.answer).catch(() => {});
  return shown(checked.answer, "answer", cost);
}
