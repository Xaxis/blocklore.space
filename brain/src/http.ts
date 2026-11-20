// The brain's only door to the network (SOURCES.md, "How the brain fetches"): it names itself,
// waits a second between requests to one host, backs off on 429 and 5xx, and keeps a disk cache so
// re-running a check costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CACHE, githubToken, USER_AGENT } from "./env.ts";

export interface Fetched {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
  fromCache: boolean;
}

const lastHit = new Map<string, number>();
const turns = new Map<string, Promise<void>>();
const GAP_MS: Record<string, number> = { "api.github.com": 100, "raw.githubusercontent.com": 100 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for this host's turn: requests to one host start at least its gap apart, in order. */
async function politeWait(host: string) {
  const gap = GAP_MS[host] ?? 1000;
  const prev = turns.get(host) ?? Promise.resolve();
  let release = () => {};
  const mine = new Promise<void>((r) => {
    release = r;
  });
  turns.set(
    host,
    prev.then(() => mine),
  );
  await prev;
  const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  release();
}

function cacheFile(url: string): string {
  const h = createHash("sha256").update(url).digest("hex");
  return path.join(CACHE, "http", h.slice(0, 2), `${h}.json`);
}

export interface GetOptions {
  /** Seconds a cached copy stays good. 0 skips the cache. Default one day. */
  maxAge?: number;
  accept?: string;
  binary?: boolean;
}

export async function get(url: string, opts: GetOptions = {}): Promise<Fetched> {
  const maxAge = opts.maxAge ?? 86400;
  const file = cacheFile(url);
  if (maxAge > 0 && existsSync(file)) {
    const hit = JSON.parse(readFileSync(file, "utf8")) as Fetched;
    if (Date.now() - Date.parse(hit.fetchedAt) < maxAge * 1000) return { ...hit, fromCache: true };
  }
  const u = new URL(url);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.accept) headers.Accept = opts.accept;
  if (u.hostname === "api.github.com") {
    const t = githubToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    await politeWait(u.hostname);
    try {
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        const retry = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
        await new Promise((r) => setTimeout(r, Math.min(retry, 30) * 1000));
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const body = opts.binary
        ? Buffer.from(await res.arrayBuffer()).toString("base64")
        : await res.text();
      const out: Fetched = {
        url,
        finalUrl: res.url,
        status: res.status,
        contentType,
        body,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
      };
      if (res.ok && maxAge > 0) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(out));
      }
      return out;
    } catch (e) {
      lastError = String(e);
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  return {
    url,
    finalUrl: url,
    status: 0,
    contentType: "",
    body: lastError,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
}

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const r = await get(url, { accept: "application/json", ...opts });
  if (r.status !== 200) throw new Error(`${url}: ${r.status} ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}
