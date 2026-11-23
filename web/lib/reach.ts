import "server-only";
import { type ReachDay, reachDays, sumReach } from "@blocklore/core/reach";
import { devMemory, kv, PRODUCTION } from "./kv";

// The counters behind Blocklore's reach (core/src/reach.ts): one Redis hash per UTC day, numbers
// only, kept 400 days. Counting never delays or fails a response; when the store is down a count
// is lost and nothing else happens. Without a store, `next dev` counts in memory and production
// counts nothing.

const KEEP_SECONDS = 400 * 86_400;
const key = (day: string) => `reach:${day}`;
const memory = () => devMemory("reach", () => new Map<string, ReachDay>());

/** Adds one to each counter for the UTC day `day`. */
export async function addReach(fields: string[], day: string): Promise<void> {
  if (!fields.length) return;
  const r = kv();
  if (!r) {
    if (PRODUCTION) return;
    const d = memory().get(day) ?? {};
    for (const f of fields) d[f] = (d[f] ?? 0) + 1;
    memory().set(day, d);
    return;
  }
  try {
    const p = r.pipeline();
    for (const f of fields) p.hincrby(key(day), f, 1);
    p.expire(key(day), KEEP_SECONDS);
    await p.exec();
  } catch {
    // A lost count; the reader's answer has already gone out.
  }
}

/** Each day's counters from `from` to `to` (UTC, inclusive), and their sum. Null when unreadable. */
export async function readReach(
  from: string,
  to: string,
): Promise<{ days: Record<string, ReachDay>; total: ReachDay } | null> {
  const days = reachDays(from, to);
  const r = kv();
  let rows: (ReachDay | null)[];
  if (!r) {
    if (PRODUCTION) return null;
    rows = days.map((d) => memory().get(d) ?? null);
  } else {
    try {
      const p = r.pipeline();
      for (const d of days) p.hgetall(key(d));
      rows = (await p.exec()) as (ReachDay | null)[];
    } catch {
      return null;
    }
  }
  const byDay: Record<string, ReachDay> = {};
  days.forEach((d, i) => {
    byDay[d] = sumReach([rows[i] ?? {}]);
  });
  return { days: byDay, total: sumReach(Object.values(byDay)) };
}
