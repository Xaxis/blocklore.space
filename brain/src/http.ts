// The brain's only door to the network (SOURCES.md, "How the brain fetches"): it names itself,
// obeys robots.txt and its Crawl-delay, waits a second between requests to one host, backs off on
// 429 and 5xx, revalidates with ETag and Last-Modified, and keeps a disk cache so re-running a check
// costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CACHE, githubToken, USER_AGENT } from "./env.ts";
import { allowed, isApi, parseRobots, type RobotsRules } from "./robots.ts";

export interface Fetched {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
  fromCache: boolean;
  etag?: string;
  lastModified?: string;
}

const lastHit = new Map<string, number>();
const turns = new Map<string, Promise<void>>();
const GAP_MS: Record<string, number> = { "api.github.com": 100, "raw.githubusercontent.com": 100 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Crawl-delay seconds a host's robots.txt asked for, once read. */
const crawlDelay = new Map<string, number>();

/** Waits for this host's turn: requests to one host start at least its gap apart, in order. */
async function politeWait(host: string) {
  const gap = Math.max(GAP_MS[host] ?? 1000, (crawlDelay.get(host) ?? 0) * 1000);
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

const robotsByOrigin = new Map<string, Promise<RobotsRules | string>>();

/**
 * The robots rules for an origin, or why there are none to obey. A missing robots.txt (4xx) allows
 * everything; an unreachable one (5xx, network) disallows everything until it can be read (RFC 9309).
 */
function robotsFor(origin: string): Promise<RobotsRules | string> {
  let p = robotsByOrigin.get(origin);
  if (!p) {
    p = get(`${origin}/robots.txt`, { maxAge: 86400, robots: false, accept: "text/plain" }).then(
      (r) => {
        if (r.status >= 200 && r.status < 300) {
          const rules = parseRobots(r.body);
          if (rules.crawlDelay)
            crawlDelay.set(new URL(origin).hostname, Math.min(rules.crawlDelay, 30));
          return rules;
        }
        if (r.status >= 400 && r.status < 500) return { rules: [] };
        return `robots.txt at ${origin} could not be read (${r.status || r.body.slice(0, 80)})`;
      },
    );
    robotsByOrigin.set(origin, p);
  }
  return p;
}

export interface GetOptions {
  /** Seconds a cached copy stays good. 0 skips the cache. Default one day. */
  maxAge?: number;
  accept?: string;
  binary?: boolean;
  /** Obey robots.txt. Off only for robots.txt itself. */
  robots?: boolean;
}

const refused = (url: string, why: string): Fetched => ({
  url,
  finalUrl: url,
  status: 0,
  contentType: "",
  body: why,
  fetchedAt: new Date().toISOString(),
  fromCache: false,
});

const IMMUTABLE = 365 * 86400;
let ageCap = Number.POSITIVE_INFINITY;

/**
 * Caps how old a cached copy may be, so a recheck reads its sources again instead of trusting
 * yesterday's copy. Files at a commit (cached a year) keep theirs: they cannot change.
 */
export function capCacheAge(seconds: number) {
  ageCap = seconds;
}

export async function get(url: string, opts: GetOptions = {}): Promise<Fetched> {
  const asked = opts.maxAge ?? 86400;
  const maxAge = asked >= IMMUTABLE ? asked : Math.min(asked, ageCap);
  const file = cacheFile(url);
  let stale: Fetched | null = null;
  if (maxAge > 0 && existsSync(file)) {
    const hit = JSON.parse(readFileSync(file, "utf8")) as Fetched;
    if (Date.now() - Date.parse(hit.fetchedAt) < maxAge * 1000) return { ...hit, fromCache: true };
    stale = hit;
  }
  const u = new URL(url);
  if (opts.robots !== false && !isApi(u)) {
    const rules = await robotsFor(u.origin);
    if (typeof rules === "string") return refused(url, rules);
    if (!allowed(rules, u.pathname + u.search))
      return refused(url, `robots.txt at ${u.origin} disallows ${u.pathname} for BlockloreBot`);
  }
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.accept) headers.Accept = opts.accept;
  if (stale?.etag) headers["If-None-Match"] = stale.etag;
  else if (stale?.lastModified) headers["If-Modified-Since"] = stale.lastModified;
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
      if (res.status === 304 && stale) {
        const fresh = { ...stale, fetchedAt: new Date().toISOString() };
        writeFileSync(file, JSON.stringify(fresh));
        return { ...fresh, fromCache: true };
      }
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
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
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
  return refused(url, lastError);
}

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const r = await get(url, { accept: "application/json", ...opts });
  if (r.status !== 200) throw new Error(`${url}: ${r.status} ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}
