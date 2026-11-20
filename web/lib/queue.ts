import "server-only";
import { createHmac } from "node:crypto";
import {
  cleanQuestion,
  QUEUE_VISITOR_DAY,
  type QueueItem,
  type QueueUpdate,
  queueId,
  queueOrder,
  readQuestion,
} from "@blocklore/core";
import type { Redis } from "@upstash/redis";
import { devMemory, kv, PRODUCTION, salt, sameSecret, utcDay, visitorHash } from "./kv";

// The public research queue, the site's half (core/src/queue.ts is the other). A question gets in
// only with a ticket from an Ask answer that judged it about Bitcoin and not covered yet, so the
// queue cannot be filled with arbitrary text; it is checked for secrets again, contacts and links
// are stripped, and repeats are counted rather than listed twice. Reader text is public only after
// the brain triages it: until then a question is a number on the page. The brain pulls new
// questions and reports back with a bearer token (brainAuthorized in ./kv).

/**
 * A ticket for queueing `question` with Ask's note on what is `missing`, valid the UTC day it was
 * issued and the next. It signs both, since both are shown on the public queue.
 */
export function queueTicket(key: string, question: string, missing: string, day: string): string {
  return createHmac("sha256", key)
    .update(JSON.stringify(["queue", day, question, missing]))
    .digest("base64url");
}

function ticketValid(k: string, question: string, missing: string, ticket: string, now: Date) {
  const yesterday = utcDay(new Date(now.getTime() - 86_400_000));
  return [utcDay(now), yesterday].some((d) =>
    sameSecret(ticket, queueTicket(k, question, missing, d)),
  );
}

interface QueueStore {
  get(id: string): Promise<QueueItem | null>;
  put(item: QueueItem, isNew: boolean): Promise<void>;
  all(): Promise<QueueItem[]>;
  /** New questions since the last pull, removed from the new set as they are returned. */
  takeNew(): Promise<QueueItem[]>;
  countVisitor(visitor: string, day: string): Promise<number>;
}

function redisStore(r: Redis): QueueStore {
  const key = (id: string) => `queue:item:${id}`;
  const many = async (ids: string[]) =>
    ids.length ? (await r.mget<(QueueItem | null)[]>(...ids.map(key))).filter((x) => !!x) : [];
  return {
    get: async (id) => (await r.get<QueueItem>(key(id))) ?? null,
    async put(item, isNew) {
      const p = r.pipeline().set(key(item.id), item).sadd("queue:ids", item.id);
      if (isNew) p.sadd("queue:new", item.id);
      await p.exec();
    },
    all: async () => many(await r.smembers("queue:ids")),
    async takeNew() {
      const ids = await r.smembers("queue:new");
      if (!ids.length) return [];
      const items = await many(ids);
      await r.srem("queue:new", ...ids);
      return items as QueueItem[];
    },
    async countVisitor(visitor, day) {
      const k = `queue:v:${visitor}:${day}`;
      const [n] = await r.pipeline().incr(k).expire(k, 86400).exec<[number, number]>();
      return n;
    },
  };
}

function memoryStore(): QueueStore {
  const memory = devMemory("queue", () => ({
    items: new Map<string, QueueItem>(),
    fresh: new Set<string>(),
    n: new Map<string, number>(),
  }));
  return {
    get: async (id) => memory.items.get(id) ?? null,
    async put(item, isNew) {
      memory.items.set(item.id, item);
      if (isNew) memory.fresh.add(item.id);
    },
    all: async () => [...memory.items.values()],
    async takeNew() {
      const items = [...memory.fresh].flatMap((id) => memory.items.get(id) ?? []);
      memory.fresh.clear();
      return items;
    },
    async countVisitor(visitor, day) {
      const k = `${visitor}:${day}`;
      memory.n.set(k, (memory.n.get(k) ?? 0) + 1);
      return memory.n.get(k) ?? 0;
    },
  };
}

function store(): QueueStore | null {
  const r = kv();
  if (r) return redisStore(r);
  return PRODUCTION ? null : memoryStore();
}

export type QueueResult =
  | { ok: true; item: QueueItem; added: boolean }
  | { ok: false; status: number; error: string };

/** Queues a question a reader asked, if its ticket shows Ask could not answer it yet. */
export async function enqueue(input: {
  q: unknown;
  ticket: unknown;
  missing?: unknown;
  ip: string;
}): Promise<QueueResult> {
  const r = readQuestion(input.q);
  if ("error" in r) return { ok: false, status: 400, error: r.error };
  const key = salt();
  const s = store();
  if (!key || !s)
    return { ok: false, status: 503, error: "The research queue is not available right now." };
  const now = new Date();
  const said = typeof input.missing === "string" ? input.missing : "";
  if (typeof input.ticket !== "string" || !ticketValid(key, r.question, said, input.ticket, now))
    return {
      ok: false,
      status: 403,
      error:
        "Queue a question from its answer on /ask: only questions about Bitcoin that Blocklore could not answer yet can be queued, for a day after they were asked.",
    };
  const q = cleanQuestion(r.question);
  if (q.length < 8)
    return { ok: false, status: 400, error: "That question is too short to research." };
  // Ask's own words, signed by the ticket; cleaned like the question all the same.
  const missing = cleanQuestion(said).slice(0, 300) || null;

  const day = utcDay(now);
  if ((await s.countVisitor(visitorHash(key, input.ip, day), day)) > QUEUE_VISITOR_DAY)
    return {
      ok: false,
      status: 429,
      error: `Each visitor can queue ${QUEUE_VISITOR_DAY} questions a day. Thank you for asking; try again tomorrow.`,
    };
  const id = queueId(q);
  const at = now.toISOString();
  const old = await s.get(id);
  const item: QueueItem = old
    ? { ...old, asks: old.asks + 1, updated: at }
    : { id, q, missing, at, asks: 1, status: "queued", claims: [], note: null, updated: at };
  await s.put(item, !old);
  return { ok: true, item, added: !old };
}

/** What a reader may see: triaged questions, and how many still wait for triage. */
export async function publicQueue(): Promise<{ questions: QueueItem[]; waiting: number } | null> {
  const s = store();
  if (!s) return null;
  const all = await s.all();
  return {
    questions: all
      .filter((i) => i.status === "researching" || i.status === "answered")
      .sort(queueOrder),
    waiting: all.filter((i) => i.status === "queued").length,
  };
}

/** For the brain: new questions since the last pull, or every question with `all`. */
export async function pullQueue(all: boolean): Promise<QueueItem[] | null> {
  const s = store();
  if (!s) return null;
  return all ? (await s.all()).sort(queueOrder) : s.takeNew();
}

/** For the brain: a status change, with the claims that answer a question or a note. */
export async function updateQueue(u: QueueUpdate): Promise<QueueItem | null> {
  const s = store();
  if (!s) return null;
  const old = await s.get(u.id);
  if (!old) return null;
  const item: QueueItem = {
    ...old,
    status: u.status,
    claims: u.status === "answered" ? (u.claims ?? old.claims) : old.claims,
    note: u.note === undefined ? old.note : u.note,
    updated: new Date().toISOString(),
  };
  await s.put(item, false);
  return item;
}
