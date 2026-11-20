// Ingest (ARCHITECTURE.md, brain processes): hourly, no model. Each SourceAdapter polls one feed
// from SOURCES.md and appends what is new to var/inbox/<id>.jsonl, keeping a cursor so a missed hour
// catches up and nothing is read twice. Items are pointers (title, author, link, date, a short
// excerpt); the research role reads the source itself.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Tier } from "@blocklore/core";
import { XMLParser } from "fast-xml-parser";
import { INBOX } from "./env.ts";
import { get, getJson } from "./http.ts";
import { htmlToText } from "./text.ts";

export interface InboxItem {
  source: string;
  id: string;
  url: string;
  title: string;
  author?: string;
  published: string;
  excerpt?: string;
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
function githubCommits(
  id: string,
  repo: string,
  branch: string,
  tier: Tier,
  every: number,
): SourceAdapter {
  return feed(id, `https://github.com/${repo}/commits/${branch}.atom`, tier, every);
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
  feed("core-releases", "https://github.com/bitcoin/bitcoin/releases.atom", "T1", 6 * 60),
  feed("bitcoindev", "https://gnusha.org/pi/bitcoindev/new.atom", "T1", 60),
  delving,
  feed("optech", "https://bitcoinops.org/feed.xml", "T2", 60),
  stackexchange,
  githubCommits("transcripts", "bitcointranscripts/bitcointranscripts", "master", "T2", 24 * 60),
  githubCommits("bolts", "lightning/bolts", "master", "T1", 24 * 60),
  githubCommits("inquisition", "bitcoin-inquisition/bitcoin", "29.x", "T1", 24 * 60),
  feed("knots-releases", "https://github.com/bitcoinknots/bitcoin/releases.atom", "T1", 6 * 60),
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

/** Polls every adapter that is due (or all with force), appending new items to the inbox. */
export async function ingest(opts: { force?: boolean; only?: string } = {}): Promise<number> {
  mkdirSync(INBOX, { recursive: true });
  const health = readHealth();
  let failed = 0;
  for (const a of ADAPTERS) {
    if (opts.only && a.id !== opts.only) continue;
    const h = health[a.id] ?? { failures: 0, items: 0 };
    if (!opts.force && h.lastRun && Date.now() - Date.parse(h.lastRun) < a.every * 60e3 - 60e3)
      continue;
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
  return failed > 0 ? 1 : 0;
}
