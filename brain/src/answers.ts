// The brain's own hand in the public research queue (brain/src/queue.ts), so a reader's question
// goes from the box on /gaps to an answer with no one in between. The admin said from the start
// that the brain triages questions; until 2026-11-26 nothing did, and every question waited for
// the owner to accept it and again to answer it.
//
// Each hour, after the pull, the brain:
//   - accepts a waiting question that search places near a published claim, unless it reads as
//     instructions to a model (those, and questions near no claim, wait for the owner);
//   - answers an accepted question once every claim research named for it has been decided and at
//     least one of them is published.
// Research names those claims in run.yaml (`answers`), and publishing keeps what it named here,
// privately: a claim the gate held is never named in public until it publishes. The brain acts on a
// question at most once per step, so the owner's later choice in the admin always stands.
//
//   var/queue/answers.json  question id -> the claims research named as answering it
//   var/queue/brain.json    what the brain did: question id -> when it accepted, when it answered
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BundleClaim, buildIndex, nearestTopic, type QueueItem } from "@blocklore/core";
import { z } from "zod";
import { QUEUE_DIR } from "./env.ts";
import { stripInvisible, suspectedInjections } from "./text.ts";

const ANSWERS = path.join(QUEUE_DIR, "answers.json");
const DONE = path.join(QUEUE_DIR, "brain.json");

const QuestionId = z.string().regex(/^[0-9a-f]{16}$/);
const Answers = z.record(QuestionId, z.array(z.string()));
export type Answers = z.infer<typeof Answers>;
const Done = z.strictObject({
  accepted: z.record(QuestionId, z.string()),
  answered: z.record(QuestionId, z.string()),
});
export type Done = z.infer<typeof Done>;

const read = <T>(file: string, schema: z.ZodType<T>, empty: T): T =>
  existsSync(file) ? schema.parse(JSON.parse(readFileSync(file, "utf8"))) : empty;
const write = (file: string, value: unknown) => {
  mkdirSync(QUEUE_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

export const readAnswers = (): Answers => read(ANSWERS, Answers, {});
export const readDone = (): Done => read(DONE, Done, { accepted: {}, answered: {} });

/** Adds the claims a published run named for its questions, keeping what earlier runs named. */
export function recordAnswers(named: readonly { question: string; claims: readonly string[] }[]) {
  if (!named.length) return;
  const all = readAnswers();
  for (const a of named) all[a.question] = [...new Set([...(all[a.question] ?? []), ...a.claims])];
  write(ANSWERS, all);
}

/**
 * What a published run keeps of its `answers`: only questions its task carried, and only claims
 * now published or waiting for the evaluator, so a question is never answered by a claim that is
 * nowhere.
 */
export function runAnswers(
  answers: readonly { question: string; claims: readonly string[] }[],
  asked: readonly string[],
  known: ReadonlySet<string>,
): { question: string; claims: string[] }[] {
  const carried = new Set(asked);
  return answers
    .filter((a) => carried.has(a.question))
    .map((a) => ({ question: a.question, claims: a.claims.filter((c) => known.has(c)) }))
    .filter((a) => a.claims.length > 0);
}

export function markDone(step: keyof Done, id: string, at: string) {
  const d = readDone();
  d[step][id] = at;
  write(DONE, d);
}

export interface QueueActions {
  accept: { id: string; topic: string }[];
  answer: { id: string; claims: string[] }[];
  /** Waiting questions the brain leaves for the owner, and why. */
  left: { id: string; why: string }[];
}

/**
 * What the brain does to the queue this hour. `claims` is the published store as compiled,
 * `pending` the ids waiting for the evaluator, `answers` what research named, `done` what the
 * brain did before. Pure.
 */
export function queueActions(i: {
  items: readonly QueueItem[];
  claims: Record<string, BundleClaim>;
  pending: ReadonlySet<string>;
  answers: Answers;
  done: Done;
}): QueueActions {
  const out: QueueActions = { accept: [], answer: [], left: [] };
  const index = buildIndex(Object.values(i.claims));
  const current = (id: string) => {
    const c = i.claims[id];
    return !!c && c.status !== "superseded";
  };
  for (const q of i.items) {
    if (q.status === "queued" && !i.done.accepted[q.id]) {
      const text = stripInvisible(q.q).replace(/\s+/g, " ").trim();
      if (suspectedInjections(text).length) {
        out.left.push({ id: q.id, why: "it reads as instructions to a model" });
        continue;
      }
      const topic = nearestTopic(index, i.claims, q.q);
      if (topic) out.accept.push({ id: q.id, topic });
      else out.left.push({ id: q.id, why: "no published claim is near it" });
    }
    if (q.status === "researching" && !i.done.answered[q.id]) {
      const named = i.answers[q.id] ?? [];
      if (!named.length || named.some((c) => i.pending.has(c))) continue;
      // In research's order, at most the 12 an answer may name (QueueUpdate).
      const claims = named.filter(current).slice(0, 12);
      if (claims.length) out.answer.push({ id: q.id, claims });
    }
  }
  return out;
}
