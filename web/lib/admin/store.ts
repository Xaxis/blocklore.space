import "server-only";
import { KEYS, LIVE_KEEP, RESULT_TTL_S, STATE_TTL_S, WATCH_TTL_S } from "@blocklore/core/control";
import { devMemory, kv, PRODUCTION } from "@/lib/kv";

// The site's half of the control plane's storage (ADMIN.md): one small interface over Redis, with
// an in-memory stand-in under `next dev` without a store, so the admin and the daemon can be driven
// locally. Values are JSON strings; callers parse them with the schemas in core/src/control.ts.

interface Mem {
  kv: Map<string, { v: string; exp: number | null }>;
  lists: Map<string, string[]>;
}
const mem = () => devMemory<Mem>("control", () => ({ kv: new Map(), lists: new Map() }));
const nowMs = () => Date.now();

export function controlAvailable(): boolean {
  return kv() !== null || !PRODUCTION;
}

export async function getJson(key: string): Promise<unknown | null> {
  const r = kv();
  if (r) {
    const v = await r.get<unknown>(key);
    return v ?? null;
  }
  const e = mem().kv.get(key);
  if (!e || (e.exp !== null && e.exp < nowMs())) return null;
  return JSON.parse(e.v);
}

export async function setJson(key: string, value: unknown, ttlS?: number): Promise<void> {
  const r = kv();
  if (r) {
    if (ttlS) await r.set(key, JSON.stringify(value), { ex: ttlS });
    else await r.set(key, JSON.stringify(value));
    return;
  }
  mem().kv.set(key, { v: JSON.stringify(value), exp: ttlS ? nowMs() + ttlS * 1000 : null });
}

export async function del(key: string): Promise<void> {
  const r = kv();
  if (r) await r.del(key);
  else mem().kv.delete(key);
}

/** Appends to the end of a list (the command queue). */
export async function pushTail(key: string, value: unknown): Promise<void> {
  const r = kv();
  if (r) await r.rpush(key, JSON.stringify(value));
  else mem().lists.set(key, [...(mem().lists.get(key) ?? []), JSON.stringify(value)]);
}

/** Takes up to n items from the front of a list, oldest first. */
export async function popHead(key: string, n: number): Promise<unknown[]> {
  const r = kv();
  if (r) {
    const got = await r.lpop<unknown[]>(key, n);
    if (!got) return [];
    return (Array.isArray(got) ? got : [got]).map((x) =>
      typeof x === "string" ? JSON.parse(x) : x,
    );
  }
  const list = mem().lists.get(key) ?? [];
  const out = list.splice(0, n);
  return out.map((x) => JSON.parse(x));
}

export async function listLength(key: string): Promise<number> {
  const r = kv();
  if (r) return r.llen(key);
  return mem().lists.get(key)?.length ?? 0;
}

/** Live events: newest first, at most LIVE_KEEP. */
export async function pushLive(events: unknown[], reset: boolean): Promise<void> {
  const r = kv();
  if (r) {
    const p = r.pipeline();
    if (reset) p.del(KEYS.live);
    if (events.length) {
      p.lpush(KEYS.live, ...events.map((e) => JSON.stringify(e)));
      p.ltrim(KEYS.live, 0, LIVE_KEEP - 1);
    }
    await p.exec();
    return;
  }
  const list = reset ? [] : (mem().lists.get(KEYS.live) ?? []);
  mem().lists.set(
    KEYS.live,
    [...events.map((e) => JSON.stringify(e)).reverse(), ...list].slice(0, LIVE_KEEP),
  );
}

export async function readLive(n = 200): Promise<unknown[]> {
  const r = kv();
  if (r) {
    const got = await r.lrange<unknown>(KEYS.live, 0, n - 1);
    return got.map((x) => (typeof x === "string" ? JSON.parse(x) : x));
  }
  return (mem().lists.get(KEYS.live) ?? []).slice(0, n).map((x) => JSON.parse(x));
}

export const TTL = { state: STATE_TTL_S, result: RESULT_TTL_S, watch: WATCH_TTL_S };

/** Reads and deletes in one step, so a one-time token can be used once. */
export async function takeJson(key: string): Promise<unknown | null> {
  const r = kv();
  if (r) {
    const v = await r.getdel<unknown>(key);
    return v ?? null;
  }
  const v = await getJson(key);
  mem().kv.delete(key);
  return v;
}

/** Counts within a window that starts at the first hit. */
export async function hit(key: string, windowS: number): Promise<number> {
  const r = kv();
  if (r) {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, windowS);
    return n;
  }
  const n = Number((await getJson(key)) ?? 0) + 1;
  await setJson(key, n, windowS);
  return n;
}

export async function setAdd(key: string, member: string): Promise<void> {
  const r = kv();
  if (r) await r.sadd(key, member);
  else {
    const cur = ((await getJson(key)) as string[] | null) ?? [];
    await setJson(key, [...new Set([...cur, member])]);
  }
}

export async function setMembers(key: string): Promise<string[]> {
  const r = kv();
  if (r) return r.smembers(key);
  return ((await getJson(key)) as string[] | null) ?? [];
}
