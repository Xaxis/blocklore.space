// NVD's public CVE API 2.0, read for the CVE ids the threat map and the advisories name (BACKLOG
// 38). No API key: the public limit is 5 requests in any 30 seconds, so brain/src/http.ts spaces
// requests to this host 6 seconds apart, and a record is asked for again only when it may have
// changed (nvdDue). What NVD says is kept in knowledge/security/advisories.json; core's checkCve
// compares it with the threat map, and a disagreement is a finding for the owner, never an edit.
import type { NvdRecord } from "@blocklore/core";
import { undash } from "@blocklore/core";
import { get } from "../http.ts";

export const NVD_API = "https://services.nvd.nist.gov/rest/json/cves/2.0";

interface NvdCve {
  id: string;
  published?: string;
  vulnStatus?: string;
  descriptions?: { lang: string; value: string }[];
  configurations?: { nodes?: { cpeMatch?: { criteria: string; vulnerable?: boolean }[] }[] }[];
  affected?: { affectedData?: { vendor?: string; product?: string }[] }[];
}

export interface NvdResponse {
  totalResults: number;
  vulnerabilities?: { cve: NvdCve }[];
}

/** NVD writes UTC times without a zone and with milliseconds: "2018-09-19T08:29:00.333". */
export function nvdTime(t: string | undefined): string | null {
  if (!t) return null;
  const ms = Date.parse(/Z$|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

const part = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "");

/** The vendor:product pairs a record lists as affected: CPE matches first, then the CNA's data. */
export function nvdProducts(cve: NvdCve): string[] {
  const out = new Set<string>();
  for (const c of cve.configurations ?? [])
    for (const n of c.nodes ?? [])
      for (const m of n.cpeMatch ?? []) {
        if (m.vulnerable === false) continue;
        const [, , , vendor, product] = m.criteria.split(":");
        if (vendor && product && vendor !== "*" && product !== "*")
          out.add(`${part(vendor)}:${part(product)}`);
      }
  for (const a of cve.affected ?? [])
    for (const d of a.affectedData ?? []) {
      const vendor = part(d.vendor);
      const product = part(d.product);
      if (vendor && product && vendor !== "n/a" && product !== "n/a" && vendor !== "na")
        out.add(`${vendor}:${product}`);
    }
  return [...out].filter((p) => p.length >= 3 && p.length <= 100).slice(0, 40);
}

/** Reads one API answer into the record Blocklore keeps. */
export function parseNvd(id: string, body: NvdResponse, checked: string): NvdRecord {
  const cve = body.vulnerabilities?.find((v) => v.cve.id === id)?.cve;
  if (!body.totalResults || !cve)
    return {
      id,
      checked,
      found: false,
      status: null,
      published: null,
      products: [],
      description: null,
    };
  const en = cve.descriptions?.find((d) => d.lang === "en")?.value ?? "";
  const description = undash(en.replace(/\s+/g, " ").trim()).slice(0, 600);
  return {
    id,
    checked,
    found: true,
    status: cve.vulnStatus?.slice(0, 40) ?? null,
    published: nvdTime(cve.published),
    products: nvdProducts(cve),
    description: description || null,
  };
}

const DAY = 86400e3;
/** Statuses under which NVD's analysts have not finished: the CPE data may still come. */
const PENDING = new Set(["Received", "Awaiting Analysis", "Undergoing Analysis", "Deferred"]);

/**
 * When a record is worth asking for again: one NVD did not have, a day later (a new CVE is often
 * published days after its advisory); one still in analysis, a week later; any other, a month later.
 */
export function nvdDue(r: NvdRecord | undefined, now: string): boolean {
  if (!r) return true;
  const age = Date.parse(now) - Date.parse(r.checked);
  if (!r.found) return age >= DAY;
  if (PENDING.has(r.status ?? "")) return age >= 7 * DAY;
  return age >= 30 * DAY;
}

/** The ids to ask for now, never asked first, then the longest unasked, at most `limit`. */
export function nvdQueue(
  ids: readonly string[],
  records: ReadonlyMap<string, NvdRecord>,
  now: string,
  limit: number,
): string[] {
  return ids
    .filter((id) => nvdDue(records.get(id), now))
    .sort((a, b) => {
      const x = records.get(a)?.checked ?? "";
      const y = records.get(b)?.checked ?? "";
      return x.localeCompare(y) || a.localeCompare(b);
    })
    .slice(0, limit);
}

/** Asks NVD for one CVE id. Throws when NVD does not answer, so the old record stays. */
export async function fetchNvd(id: string): Promise<NvdRecord> {
  // A copy younger than six hours is reused, so a rerun by hand costs NVD nothing.
  const r = await get(`${NVD_API}?cveId=${encodeURIComponent(id)}`, {
    maxAge: 6 * 3600,
    accept: "application/json",
  });
  if (r.status !== 200) throw new Error(`NVD ${id}: HTTP ${r.status || r.body.slice(0, 80)}`);
  const checked = new Date(r.fetchedAt).toISOString().replace(/\.\d+Z$/, "Z");
  return parseNvd(id, JSON.parse(r.body) as NvdResponse, checked);
}
