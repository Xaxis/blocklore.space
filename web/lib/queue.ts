import "server-only";
import {
  cleanQuestion,
  detectSecrets,
  QUEUE_VISITOR_DAY,
  type QueueItem,
  type QueueUpdate,
  queueId,
  queueOrder,
  readQuestion,
  styleIssues,
} from "@blocklore/core";
import type { Redis } from "@upstash/redis";
import { claimById } from "./api";
import { countDay, devMemory, kv, PRODUCTION, salt, utcDay, visitorHash } from "./kv";

// The research queue, the site's half (core/src/queue.ts is the other): what readers suggest the
// brain research next. No model reads it on the site. A suggestion is checked for secrets, its
// links and contacts are stripped, repeats are counted rather than listed twice, and each visitor
// and the whole site have a daily cap. Reader text is public only after the brain or the owner
// triages it: until then a suggestion is a number on the page. The brain pulls new suggestions and
// reports back with a bearer token (brainAuthorized in ./kv).

/** Suggestions the whole site takes in a UTC day, so a flood cannot bury the owner's queue. */
const SITE_DAY = 200;

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
    countVisitor: (visitor, day) => countDay("queue", visitor, day),
  };
}

function memoryStore(): QueueStore {
  const memory = devMemory("queue", () => ({
    items: new Map<string, QueueItem>(),
    fresh: new Set<string>(),
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
    countVisitor: (visitor, day) => countDay("queue", visitor, day),
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

/** Queues a question a reader suggests the brain research. */
export async function enqueue(input: { q: unknown; ip: string }): Promise<QueueResult> {
  const r = readQuestion(input.q);
  if ("error" in r) return { ok: false, status: 400, error: r.error };
  const key = salt();
  const s = store();
  if (!key || !s)
    return { ok: false, status: 503, error: "Suggestions are not available right now." };
  const now = new Date();
  const q = cleanQuestion(r.question);
  if (q.length < 8)
    return { ok: false, status: 400, error: "That question is too short to research." };
  const missing = null;

  const day = utcDay(now);
  if ((await s.countVisitor("site", day)) > SITE_DAY)
    return {
      ok: false,
      status: 429,
      error: "Blocklore has taken all the suggestions it can today. Try again tomorrow.",
    };
  if ((await s.countVisitor(visitorHash(key, input.ip, day), day)) > QUEUE_VISITOR_DAY)
    return {
      ok: false,
      status: 429,
      error: `Each visitor can suggest ${QUEUE_VISITOR_DAY} questions a day. Thank you; try again tomorrow.`,
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

/**
 * Why a status change cannot be applied, or null. The same rules for the brain and the owner: an
 * answer names published claims, and a public note keeps the house style and holds no secret.
 */
export function updateProblem(u: QueueUpdate): string | null {
  const unknown = (u.claims ?? []).filter((id) => !claimById(id));
  if (unknown.length) return `Not published in this edition: ${unknown.join(", ")}.`;
  if (u.note && (styleIssues(u.note).length || detectSecrets(u.note).length))
    return "The note breaks the house style or looks like it holds a secret.";
  if (u.status === "answered" && !u.claims?.length)
    return "An answered question names the claims that answer it.";
  return null;
}

/** A status change, with the claims that answer a question or a note (checked: updateProblem). */
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
