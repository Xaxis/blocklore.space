// Security advisories as ingest feeds (SOURCES.md): Bitcoin Core's disclosures on bitcoincore.org
// and the GitHub security advisories of Bitcoin Core and the Lightning implementations. They land
// in var/inbox like every other feed, so the wire shows them, research can read them, and the
// advisories watch counts them. Public records only: an advisory is published by the project once
// the fix is out.
import type { Tier } from "@blocklore/core";
import { XMLParser } from "fast-xml-parser";
import { get, getJson } from "../http.ts";
import type { InboxItem, SourceAdapter } from "../ingest.ts";
import { htmlToText } from "../text.ts";

export type Severity = "low" | "medium" | "high" | "critical";

/** "This issue is considered High severity." in a bitcoincore.org disclosure. */
export function coreSeverity(text: string): Severity | null {
  const m = /considered\s+(low|medium|high|critical)\s+severity/i.exec(text);
  return m ? ((m[1] as string).toLowerCase() as Severity) : null;
}

/** A bitcoincore.org post that discloses a vulnerability, by its title or address. */
export function isCoreDisclosure(title: string, url: string): boolean {
  return (
    /^CVE-\d{4}-\d+|^Disclosure of|disclos/i.test(title) ||
    /\/en\/\d{4}\/\d{2}\/\d{2}\/(disclose|cb-stall)/.test(url)
  );
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** Bitcoin Core's disclosures, from the bitcoincore.org feed (everything else in it is skipped). */
export const coreAdvisories: SourceAdapter = {
  id: "core-advisories",
  tier: "T1",
  every: 6 * 60,
  async poll(cursor) {
    const r = await get("https://bitcoincore.org/en/rss.xml", { maxAge: 0 });
    if (r.status !== 200) throw new Error(`bitcoincore.org feed: HTTP ${r.status}`);
    const doc = xml.parse(r.body);
    const since = cursor ?? "";
    const items: InboxItem[] = [];
    for (const e of arr(doc.rss?.channel?.item) as Record<string, unknown>[]) {
      const title = String(e.title ?? "").trim();
      const url = String(e.link ?? "").trim();
      const published = new Date(String(e.pubDate ?? "")).toISOString();
      if (!url.startsWith("https://") || published <= since || !isCoreDisclosure(title, url))
        continue;
      const text = htmlToText(String(e.description ?? "")).text.replace(/\s+/g, " ");
      items.push({
        source: "core-advisories",
        id: url,
        url,
        title,
        published,
        excerpt: text.slice(0, 400),
        severity: coreSeverity(text),
        tier: "T1" as Tier,
      });
    }
    const newest = [since, ...items.map((i) => i.published)].sort().at(-1) ?? since;
    return { items, cursor: newest };
  },
};

interface GhAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  html_url: string;
  published_at: string | null;
  severity: string | null;
}

/** A repository's published GitHub security advisories (REST, one request a day). */
export function githubAdvisories(id: string, repo: string): SourceAdapter {
  return {
    id,
    tier: "T1",
    every: 24 * 60,
    async poll(cursor) {
      const list = await getJson<GhAdvisory[]>(
        `https://api.github.com/repos/${repo}/security-advisories?state=published&per_page=100`,
        { maxAge: 0 },
      );
      const since = cursor ?? "";
      const items: InboxItem[] = list
        .filter(
          (a) => a.published_at && a.published_at > since && a.html_url.startsWith("https://"),
        )
        .map((a) => ({
          source: id,
          id: a.ghsa_id,
          url: a.html_url,
          title: `${repo}: ${a.cve_id ? `${a.cve_id} ` : ""}${a.summary.trim()}`,
          published: new Date(a.published_at as string).toISOString(),
          severity:
            (["low", "medium", "high", "critical"] as const).find((s) => s === a.severity) ?? null,
          tier: "T1" as Tier,
        }));
      const newest = [since, ...items.map((i) => i.published)].sort().at(-1) ?? since;
      return { items, cursor: newest };
    },
  };
}

export const ADVISORY_ADAPTERS: SourceAdapter[] = [
  coreAdvisories,
  githubAdvisories("gh-advisories-core", "bitcoin/bitcoin"),
  githubAdvisories("gh-advisories-lnd", "lightningnetwork/lnd"),
  githubAdvisories("gh-advisories-cln", "ElementsProject/lightning"),
  githubAdvisories("gh-advisories-eclair", "ACINQ/eclair"),
  githubAdvisories("gh-advisories-ldk", "lightningdevkit/rust-lightning"),
];

/** Which sources the advisories watch reads, with the name a reader sees. */
export const ADVISORY_SOURCES: Record<string, string> = {
  "core-advisories": "Bitcoin Core",
  "gh-advisories-core": "Bitcoin Core",
  "gh-advisories-lnd": "LND",
  "gh-advisories-cln": "Core Lightning",
  "gh-advisories-eclair": "Eclair",
  "gh-advisories-ldk": "LDK",
};
