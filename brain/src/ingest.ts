// Ingest (ARCHITECTURE.md, brain processes): hourly, no model. Each SourceAdapter polls one feed
// from SOURCES.md and appends what is new to var/inbox/<id>.jsonl, keeping a cursor so a missed hour
// catches up and nothing is read twice. Items are pointers (title, author, link, date, a short
// excerpt); the research role reads the source itself.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Tier, undash, type Wire, WireItem } from "@blocklore/core";
import { XMLParser } from "fast-xml-parser";
import { INBOX, ROOT, remoteHead } from "./env.ts";
import { feedEvent } from "./feed.ts";
import { commitsSince, syncMirror, tagsSince } from "./git.ts";
import { get, getJson } from "./http.ts";
import { ADVISORY_ADAPTERS } from "./security/advisories.ts";
import { htmlToText } from "./text.ts";

export interface InboxItem {
  source: string;
  id: string;
  url: string;
  title: string;
  author?: string;
  published: string;
  excerpt?: string;
  /** For security advisories: the severity the project gave, when it gave one. */
  severity?: "low" | "medium" | "high" | "critical" | null;
  tier: Tier;
}

export interface SourceAdapter {
  id: string;
  tier: Tier;
  /** Minutes between polls. */
  every: number;
  poll(cursor: string | null): Promise<{ items: InboxItem[]; cursor: string }>;
}

/** The latest ISO date among the items and the old cursor (string order is date order). */
const newest = (items: InboxItem[], since: string) =>
  [since, ...items.map((i) => i.published)].sort().at(-1) ?? since;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const excerpt = (html: string | undefined, n = 400) =>
  html ? htmlToText(html).text.replace(/\s+/g, " ").slice(0, n) : undefined;
const textOf = (x: unknown): string =>
  typeof x === "string"
    ? x
    : typeof x === "object" && x && "#text" in x
      ? String((x as { "#text": unknown })["#text"])
      : String(x ?? "");
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

async function text(url: string): Promise<string> {
  const r = await get(url, { maxAge: 0 });
  if (r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
  return r.body;
}

/** Commits on a GitHub branch, from its public Atom feed (no API quota). Core's merge commits
 * ("Merge bitcoin/bitcoin#N: title") make this feed its merged-PR feed too. */
/** Commits landing on a GitHub branch, read from a treeless git mirror (src/git.ts). */
function githubCommits(
  id: string,
  repo: string,
  branch: string,
  tier: Tier,
  every: number,
): SourceAdapter {
  return {
    id,
    tier,
    every,
    async poll(cursor) {
      const dir = syncMirror(repo, branch);
      const items: InboxItem[] = commitsSince(dir, branch, cursor).map((c) => ({
        source: id,
        id: c.sha,
        url: `https://github.com/${repo}/commit/${c.sha}`,
        title: c.subject,
        author: c.author,
        published: c.date,
        tier,
      }));
      return { items, cursor: newest(items, cursor ?? "") };
    },
  };
}

/**
 * New tags on a GitHub repository (releases and release candidates), from the same mirror. The
 * branch defaults to the repository's default branch at poll time, which moves for forks like Knots.
 */
function githubTags(
  id: string,
  repo: string,
  tier: Tier,
  every: number,
  branch?: string,
): SourceAdapter {
  return {
    id,
    tier,
    every,
    async poll(cursor) {
      const dir = syncMirror(repo, branch ?? remoteHead(repo).branch);
      const items: InboxItem[] = tagsSince(dir, cursor).map((t) => ({
        source: id,
        id: t.tag,
        url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(t.tag)}`,
        title: `${repo} ${t.tag}`,
        published: t.date,
        tier,
      }));
      return { items, cursor: newest(items, cursor ?? "") };
    },
  };
}

/** An Atom or RSS feed; the cursor is the newest entry date seen. */
function feed(id: string, url: string, tier: Tier, every: number): SourceAdapter {
  return {
    id,
    tier,
    every,
    async poll(cursor) {
      const doc = xml.parse(await text(url));
      const atom = arr(doc.feed?.entry).map((e: Record<string, unknown>) => {
        const link =
          arr(e.link as Record<string, string> | Record<string, string>[])[0]?.["@href"] ?? "";
        const content = e.content as string | { "#text"?: string } | undefined;
        return {
          url: link,
          title: textOf(e.title),
          author: String((e.author as { name?: string } | undefined)?.name ?? ""),
          published: String(e.updated ?? e.published ?? ""),
          body: typeof content === "string" ? content : content?.["#text"],
        };
      });
      const rss = arr(doc.rss?.channel?.item).map((e: Record<string, unknown>) => ({
        url: String(e.link ?? ""),
        title: textOf(e.title),
        author: String(e["dc:creator"] ?? e.author ?? ""),
        published: new Date(String(e.pubDate ?? "")).toISOString(),
        body: String(e.description ?? ""),
      }));
      const since = cursor ?? "";
      const items = [...atom, ...rss]
        .filter((e) => e.url && e.published > since)
        .map((e) => ({
          source: id,
          id: e.url,
          url: e.url,
          title: e.title,
          author: e.author || undefined,
          published: new Date(e.published).toISOString(),
          excerpt: excerpt(e.body),
          tier,
        }));
      return { items, cursor: newest(items, since) };
    },
  };
}

const delving: SourceAdapter = {
  id: "delving",
  tier: "T1",
  every: 60,
  async poll(cursor) {
    const since = cursor ?? new Date(Date.now() - 7 * 86400e3).toISOString();
    const j = await getJson<{
      latest_posts: {
        id: number;
        topic_id: number;
        topic_slug: string;
        topic_title: string;
        post_number: number;
        username: string;
        created_at: string;
        raw?: string;
        cooked?: string;
      }[];
    }>("https://delvingbitcoin.org/posts.json", { maxAge: 0 });
    const items = j.latest_posts
      .filter((p) => p.created_at > since)
      .map((p) => ({
        source: "delving",
        id: String(p.id),
        url: `https://delvingbitcoin.org/t/${p.topic_slug}/${p.topic_id}/${p.post_number}`,
        title: p.topic_title,
        author: p.username,
        published: p.created_at,
        excerpt: p.raw?.slice(0, 400) ?? excerpt(p.cooked),
        tier: "T1" as Tier,
      }));
    return { items, cursor: newest(items, since) };
  },
};

const stackexchange: SourceAdapter = {
  id: "stackexchange",
  tier: "T2",
  every: 60,
  async poll(cursor) {
    const from = cursor ? Number(cursor) : Math.floor(Date.now() / 1000) - 7 * 86400;
    const j = await getJson<{
      items: {
        question_id: number;
        title: string;
        link: string;
        owner?: { display_name?: string };
        creation_date: number;
        score: number;
        is_answered: boolean;
      }[];
    }>(
      `https://api.stackexchange.com/2.3/questions?site=bitcoin&sort=creation&order=desc&pagesize=100&fromdate=${from + 1}`,
      { maxAge: 0 },
    );
    const items = j.items.map((q) => ({
      source: "stackexchange",
      id: String(q.question_id),
      url: q.link,
      title: htmlToText(q.title).text,
      author: q.owner?.display_name,
      published: new Date(q.creation_date * 1000).toISOString(),
      tier: "T2" as Tier,
    }));
    const newest = j.items.reduce((m, q) => Math.max(m, q.creation_date), from);
    return { items, cursor: String(newest) };
  },
};

export const ADAPTERS: SourceAdapter[] = [
  githubCommits("bips", "bitcoin/bips", "master", "T1", 60),
  githubCommits("core", "bitcoin/bitcoin", "master", "T1", 60),
  githubTags("core-releases", "bitcoin/bitcoin", "T1", 6 * 60, "master"),
  feed("bitcoindev", "https://gnusha.org/pi/bitcoindev/new.atom", "T1", 60),
  delving,
  feed("optech", "https://bitcoinops.org/feed.xml", "T2", 60),
  stackexchange,
  githubCommits("transcripts", "bitcointranscripts/bitcointranscripts", "master", "T2", 24 * 60),
  githubCommits("bolts", "lightning/bolts", "master", "T1", 24 * 60),
  githubCommits("inquisition", "bitcoin-inquisition/bitcoin", "29.x", "T1", 24 * 60),
  githubTags("knots-releases", "bitcoinknots/bitcoin", "T1", 6 * 60),
  ...ADVISORY_ADAPTERS,
];

interface Health {
  lastRun?: string;
  lastOk?: string;
  lastError?: string;
  failures: number;
  items: number;
}

const healthFile = path.join(INBOX, "health.json");
export function readHealth(): Record<string, Health> {
  return existsSync(healthFile) ? JSON.parse(readFileSync(healthFile, "utf8")) : {};
}

/**
 * The hourly timer starts up to 5 minutes late (RandomizedDelaySec=300), so two ticks can be as
 * little as 55 minutes apart. An adapter is due 10 minutes short of its interval, or an hourly feed
 * would be skipped on about every other tick.
 */
export const DUE_SLACK_MS = 10 * 60e3;

export function isDue(lastRun: string | undefined, everyMinutes: number, now: number): boolean {
  return !lastRun || now - Date.parse(lastRun) >= everyMinutes * 60e3 - DUE_SLACK_MS;
}

/** Polls every adapter that is due (or all with force), appending new items to the inbox. */
export async function ingest(opts: { force?: boolean; only?: string } = {}): Promise<number> {
  mkdirSync(INBOX, { recursive: true });
  const health = readHealth();
  let failed = 0;
  let read = 0;
  const sources: string[] = [];
  for (const a of ADAPTERS) {
    if (opts.only && a.id !== opts.only) continue;
    const h = health[a.id] ?? { failures: 0, items: 0 };
    if (!opts.force && !isDue(h.lastRun, a.every, Date.now())) continue;
    const cursorFile = path.join(INBOX, `${a.id}.cursor`);
    const cursor = existsSync(cursorFile) ? readFileSync(cursorFile, "utf8").trim() || null : null;
    h.lastRun = new Date().toISOString();
    try {
      const { items, cursor: next } = await a.poll(cursor);
      if (items.length)
        appendFileSync(
          path.join(INBOX, `${a.id}.jsonl`),
          `${items.map((i) => JSON.stringify(i)).join("\n")}\n`,
        );
      writeFileSync(cursorFile, next);
      h.lastOk = h.lastRun;
      h.failures = 0;
      h.items += items.length;
      read += items.length;
      sources.push(a.id);
      console.log(`ingest ${a.id}: ${items.length} new`);
    } catch (e) {
      h.failures++;
      h.lastError = String(e).slice(0, 300);
      failed++;
      console.error(`ingest ${a.id}: failed (${h.failures} in a row): ${h.lastError}`);
    }
    health[a.id] = h;
  }
  writeFileSync(healthFile, `${JSON.stringify(health, null, 2)}\n`);
  writeWire();
  if (sources.length)
    feedEvent({
      kind: "ingest",
      text: `Read ${sources.length} upstream feeds: ${read} new item${read === 1 ? "" : "s"}`,
      n: read,
      outcome: failed ? "failed" : "ok",
    });
  return failed > 0 ? 1 : 0;
}

const WIRE_SIZE = 80;

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Feed titles arrive with HTML entities; the wire stores the characters they stand for. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

/** Writes knowledge/wire.json: the newest items across every inbox, titles and links only. */
export function writeWire(): Wire {
  const items: WireItem[] = [];
  const seen = new Set<string>();
  for (const a of ADAPTERS) {
    const f = path.join(INBOX, `${a.id}.jsonl`);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const i = JSON.parse(line) as InboxItem;
      const parsed = WireItem.safeParse({
        source: i.source,
        title: undash(decodeEntities(i.title).replace(/\s+/g, " ").trim()).slice(0, 400),
        url: i.url,
        published: new Date(i.published).toISOString().replace(/\.\d+Z$/, "Z"),
        tier: i.tier,
      });
      if (parsed.success && !seen.has(parsed.data.url)) {
        seen.add(parsed.data.url);
        items.push(parsed.data);
      }
    }
  }
  items.sort((a, b) => b.published.localeCompare(a.published));
  // Replies in one thread share its title: keep the newest of each.
  const titles = new Set<string>();
  const unique = items.filter((i) => {
    const key = `${i.source}\n${i.title.toLowerCase()}`;
    if (titles.has(key)) return false;
    titles.add(key);
    return true;
  });
  const wire: Wire = {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    items: unique.slice(0, WIRE_SIZE),
  };
  writeFileSync(path.join(ROOT, "knowledge", "wire.json"), `${JSON.stringify(wire, null, 1)}\n`);
  return wire;
}
