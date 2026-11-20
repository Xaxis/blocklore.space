import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

// The site's Redis (blocklore-kv, provisioned by tools/env.sh) and the small secrets that go with
// it. In production a missing store means the features that need it are off (fail closed); under
// `next dev` without one, callers keep their state in memory.

export const PRODUCTION =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

let client: Redis | null | undefined;
export function kv(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/**
 * State for `next dev` without a Redis. It lives on globalThis because Turbopack re-runs a changed
 * module the next time any route loads it, and module-level state would start empty for that route.
 */
export function devMemory<T>(name: string, make: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const key = `__blocklore_${name}`;
  g[key] ??= make();
  return g[key] as T;
}

/** The key behind visitor hashes and queue tickets; "dev" only outside production. */
export function salt(): string | null {
  return process.env.ASK_SALT || (PRODUCTION ? null : "dev");
}

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** A visitor's address as a hash that changes every UTC day, so days cannot be linked. */
export function visitorHash(key: string, ip: string, day: string): string {
  return createHmac("sha256", `${key}:${day}`).update(ip).digest("hex").slice(0, 32);
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Equal strings, compared in constant time over their hashes (the lengths may differ). */
export function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b)) && a.length > 0;
}

/** The brain's bearer token for the queue's write side; false when none is configured. */
export function brainAuthorized(req: Request): boolean {
  const token = process.env.QUEUE_PULL_TOKEN;
  const got = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  return !!token && sameSecret(got, token);
}
