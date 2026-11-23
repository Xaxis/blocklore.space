// Advisories matched to the threat map, and the threat map's CVE ids checked against NVD
// (BACKLOG 36 and 38). Two files, one for each hand that writes them:
//
//   knowledge/security/advisory-map.yaml   the owner's: words that file an advisory under a threat,
//                                          projects whose every advisory files under one, the
//                                          owner's own placements and vetoes, and how NVD names
//                                          each project
//   knowledge/security/advisories.json     the brain's: every advisory the advisories watch has
//                                          read (from the projects' own feeds), and the NVD record
//                                          of every CVE id the threat map or an advisory names
//
// Matching is code with explicit rules, strongest first, and every match says which rule made it
// and on what words, so a reader can judge a match made by words:
//
//   owner     the advisory map places it under the threat (or, with an empty list, under none)
//   record    its page is in the threat's public record
//   id        it names a CVE or GHSA id the threat's record or terms list
//   source    the advisory map files every advisory of its project under the threat
//   term      its title holds one of the names the threat is known by (the threat's terms)
//   keyword   its title holds words the advisory map files under the threat
//
// The owner's `exclude` takes a threat away whatever rule placed it. An advisory nothing places,
// and the owner has not placed either, is a gap for the owner to map (core/src/gaps.ts).
//
// The NVD check never changes the record: a CVE id NVD has no record of, one it rejected, or one
// whose record names a product other than the one its advisory, its page or the owner's map
// implies is a finding the threat page shows for the owner.
//
// Pure: the store comes in as arguments; nothing reads the clock.
import { z } from "zod";
import { advisoryIds } from "./disclosure.ts";
import { slug } from "./schema.ts";
import type { Threat } from "./security.ts";

const isoTime = z.iso.datetime({ offset: false });
export const cveId = z.string().regex(/^CVE-\d{4}-\d{4,}$/);
const ghsaId = z.string().regex(/^GHSA(-[0-9a-z]{4}){3}$/);
const httpsUrl = z.url({ protocol: /^https$/ });
/** An advisory as the map names it: one of its CVE or GHSA ids, or its page. */
export const advisoryKey = z.union([cveId, ghsaId, httpsUrl]);
/** Words matched whole and in any case; at least three characters so a stray letter matches nothing. */
const phrase = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 .,:'/+_-]*$/);
const productName = z.string().min(2).max(40);

export const ADVISORY_SEVERITIES = ["low", "medium", "high", "critical"] as const;

/** An advisory as a project published it, with the ids it names. */
export const AdvisoryRecord = z.strictObject({
  /** The project, as a reader knows it: "Bitcoin Core", "LND". */
  source: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  url: httpsUrl,
  published: isoTime,
  severity: z.enum(ADVISORY_SEVERITIES).nullable(),
  /** CVE and GHSA ids in its title, its address or its feed id. */
  ids: z.array(z.union([cveId, ghsaId])).max(12),
});
export type AdvisoryRecord = z.infer<typeof AdvisoryRecord>;

/** What NVD's CVE API 2.0 said about one CVE id, when the brain last asked. */
export const NvdRecord = z.strictObject({
  id: cveId,
  checked: isoTime,
  /** NVD has a record of it. */
  found: z.boolean(),
  /** NVD's vulnStatus: Analyzed, Modified, Awaiting Analysis, Rejected and so on. */
  status: z.string().max(40).nullable(),
  published: isoTime.nullable(),
  /** vendor:product pairs from its CPE configurations and the CNA's affected data. */
  products: z.array(z.string().min(3).max(100)).max(40),
  /** NVD's English description, kept so the product check reruns when the map changes. Never shown. */
  description: z.string().max(600).nullable(),
});
export type NvdRecord = z.infer<typeof NvdRecord>;

export const ADVISORY_KEEP = 1000;

export const AdvisoryLog = z.strictObject({
  updated: isoTime,
  /** Newest first. */
  advisories: z.array(AdvisoryRecord).max(ADVISORY_KEEP),
  /** By id. */
  nvd: z.array(NvdRecord),
});
export type AdvisoryLog = z.infer<typeof AdvisoryLog>;

export const NvdProduct = z.strictObject({
  /** CPE vendor:product pairs, or vendor:* for every product of a vendor. */
  cpe: z.array(z.string().regex(/^[a-z0-9_.-]+:([a-z0-9_.-]+|\*)$/)),
  /** Names in NVD's description, matched whole and in any case. */
  words: z.array(phrase),
  /** Hosts and paths whose pages are the project's own: "bitcoincore.org", "github.com/ACINQ/eclair". */
  pages: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]+(\/[A-Za-z0-9._-]+)*$/)),
});
export type NvdProduct = z.infer<typeof NvdProduct>;

export const AdvisoryMap = z.strictObject({
  /** Threat id: words in an advisory's title that file it under the threat. */
  keywords: z.record(slug, z.array(phrase)),
  /** Threat id: projects (an advisory's source) whose every advisory files under the threat. */
  sources: z.record(slug, z.array(z.string().min(1).max(40))),
  /** Advisory: the threats it concerns, by the owner's reading. An empty list says none. */
  assign: z.record(advisoryKey, z.array(slug)),
  /** Advisory: threats a rule placed it under that it does not concern. */
  exclude: z.record(advisoryKey, z.array(slug)),
  /** Project name: how NVD's records name it. */
  products: z.record(productName, NvdProduct),
  /** CVE id: the projects its NVD record should name, when its advisory and its pages say none. */
  expect: z.record(cveId, z.array(productName)),
});
export type AdvisoryMap = z.infer<typeof AdvisoryMap>;

export const EMPTY_ADVISORY_MAP: AdvisoryMap = {
  keywords: {},
  sources: {},
  assign: {},
  exclude: {},
  products: {},
  expect: {},
};

// ---------------------------------------------------------------------------------------------
// Matching

export const MATCH_RULES = ["owner", "record", "id", "source", "term", "keyword"] as const;
export type MatchRule = (typeof MATCH_RULES)[number];

export interface AdvisoryMatch {
  threat: string;
  rule: MatchRule;
  /** What matched: the map's key, the page, the ids, the project, or the words in the title. */
  by: string[];
}

/** A page address compared without its fragment, trailing slash or the host's case. */
export function samePage(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** CVE ids in capitals, GHSA ids as GitHub writes them: "GHSA-9gxx-58q6-42p7". */
export function normId(id: string): string {
  const u = id.toUpperCase();
  return u.startsWith("GHSA-") ? `GHSA-${u.slice(5).toLowerCase()}` : u;
}

/** The CVE and GHSA ids a text names, each once. */
export function idsIn(text: string): string[] {
  return [...new Set(advisoryIds(text).map(normId))];
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `text` holds `words` whole (not inside a longer word), in any case, any spacing. */
export function hasWords(text: string, words: string): boolean {
  const body = words.trim().split(/\s+/).map(reEscape).join("\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "i").test(text);
}

function mapped(record: Record<string, string[]>, a: Pick<AdvisoryRecord, "ids" | "url">) {
  const page = samePage(a.url);
  const keys: string[] = [];
  const threats = new Set<string>();
  for (const [key, list] of Object.entries(record))
    if (key.startsWith("https://") ? samePage(key) === page : a.ids.includes(normId(key))) {
      keys.push(key);
      for (const t of list) threats.add(t);
    }
  return { keys, threats };
}

/** The CVE and GHSA ids a threat's public record and terms list. */
export function threatIds(t: Pick<Threat, "history" | "terms">): string[] {
  return [
    ...new Set([
      ...t.history.flatMap((h) => idsIn(`${h.ref} ${h.url}`)),
      ...t.terms.flatMap(idsIn),
    ]),
  ];
}

/**
 * The threats an advisory concerns, each by its strongest rule, in threat map order. The owner's
 * exclusions come off last, whatever placed them.
 */
export function matchAdvisory(
  a: AdvisoryRecord,
  threats: readonly Threat[],
  map: AdvisoryMap,
): AdvisoryMatch[] {
  const page = samePage(a.url);
  const owner = mapped(map.assign, a);
  const excluded = mapped(map.exclude, a).threats;
  const out: AdvisoryMatch[] = [];
  for (const t of threats) {
    if (excluded.has(t.id)) continue;
    const match = ((): Omit<AdvisoryMatch, "threat"> | null => {
      if (owner.threats.has(t.id))
        return {
          rule: "owner",
          by: owner.keys.filter((k) => map.assign[k]?.includes(t.id)),
        };
      const cited = t.history.filter((h) => samePage(h.url) === page);
      if (cited.length) return { rule: "record", by: [a.url] };
      const known = new Set(threatIds(t));
      const ids = a.ids.filter((id) => known.has(id));
      if (ids.length) return { rule: "id", by: ids };
      if (map.sources[t.id]?.includes(a.source)) return { rule: "source", by: [a.source] };
      const terms = t.terms.filter((w) => !idsIn(w).length && hasWords(a.title, w));
      if (terms.length) return { rule: "term", by: terms };
      const words = (map.keywords[t.id] ?? []).filter((w) => hasWords(a.title, w));
      if (words.length) return { rule: "keyword", by: words };
      return null;
    })();
    if (match) out.push({ threat: t.id, ...match });
  }
  return out;
}

/** An advisory with the threats it concerns and the NVD record of each CVE id it names. */
export interface AdvisoryView extends AdvisoryRecord {
  matches: AdvisoryMatch[];
  /** The owner's map names it (an empty placement too), so it is never a gap. */
  placed: boolean;
  nvd: NvdBrief[];
}

/** What a page shows of an NVD record next to an advisory or a public record entry. */
export interface NvdBrief {
  id: string;
  /** Not asked yet, asked and found, or asked and NVD has no record. */
  state: "unchecked" | "found" | "missing";
  published: string | null;
  status: string | null;
  checked: string | null;
  url: string;
}

export const nvdUrl = (id: string) => `https://nvd.nist.gov/vuln/detail/${id}`;

export function nvdBrief(id: string, records: ReadonlyMap<string, NvdRecord>): NvdBrief {
  const r = records.get(id);
  return {
    id,
    state: !r ? "unchecked" : r.found ? "found" : "missing",
    published: r?.published ?? null,
    status: r?.status ?? null,
    checked: r?.checked ?? null,
    url: nvdUrl(id),
  };
}

// ---------------------------------------------------------------------------------------------
// The NVD check

/** Where the threat map names a CVE id. */
export type CveWhere = "history" | "terms";

export const NVD_FINDINGS = ["missing", "rejected", "product", "unnamed"] as const;
export type FindingKind = (typeof NVD_FINDINGS)[number];

/** The kinds that say the record and NVD disagree; `unnamed` only says the check could not tell. */
export const MISMATCHES: ReadonlySet<FindingKind> = new Set(["missing", "rejected", "product"]);

export interface CveCheck {
  id: string;
  /** Threats that name it, and where. */
  threats: { id: string; where: CveWhere[] }[];
  /** The projects its record should name; empty means any project the map knows. */
  expected: string[];
  /** Why it expects them: "advisory", "page", "owner", or "any" when nothing narrows it. */
  basis: "owner" | "advisory" | "page" | "any";
  nvd: NvdBrief;
  /** Projects of the map NVD's record names, by its CPE pairs or its description. */
  named: string[];
  /** Every vendor:product pair NVD's record lists as affected. */
  products: string[];
  /** Of those, the pairs no project in the map claims. */
  other: string[];
  finding: FindingKind | null;
}

/** The project whose own page an address is, by the map's `pages`. */
export function pageProject(url: string, products: AdvisoryMap["products"]): string | null {
  const p = samePage(url).toLowerCase();
  for (const [name, prod] of Object.entries(products))
    if (prod.pages.some((x) => p === x.toLowerCase() || p.startsWith(`${x.toLowerCase()}/`)))
      return name;
  return null;
}

const cpeMatches = (pair: string, pattern: string) => {
  const [pv, pp] = pattern.split(":");
  const [v, p] = pair.split(":");
  return v === pv && (pp === "*" || p === pp);
};

/** The map's projects an NVD record names, and the CPE pairs none of them claims. */
export function namedProducts(
  r: Pick<NvdRecord, "products" | "description">,
  products: AdvisoryMap["products"],
): { named: string[]; other: string[] } {
  const named = Object.entries(products)
    .filter(
      ([, prod]) =>
        r.products.some((pair) => prod.cpe.some((c) => cpeMatches(pair, c))) ||
        prod.words.some((w) => hasWords(r.description ?? "", w)),
    )
    .map(([name]) => name);
  const other = r.products.filter(
    (pair) => !Object.values(products).some((prod) => prod.cpe.some((c) => cpeMatches(pair, c))),
  );
  return { named, other };
}

/** Every CVE id the threat map names, with the threats and the places that name it. */
export function threatCves(threats: readonly Threat[]): Map<string, CveCheck["threats"]> {
  const out = new Map<string, CveCheck["threats"]>();
  for (const t of threats) {
    const where = new Map<string, Set<CveWhere>>();
    const add = (id: string, w: CveWhere) => {
      if (!id.startsWith("CVE-")) return;
      if (!where.has(id)) where.set(id, new Set());
      where.get(id)?.add(w);
    };
    for (const h of t.history) for (const id of idsIn(`${h.ref} ${h.url}`)) add(id, "history");
    for (const term of t.terms) for (const id of idsIn(term)) add(id, "terms");
    for (const [id, w] of where) {
      const list = out.get(id) ?? [];
      list.push({ id: t.id, where: [...w].sort() });
      out.set(id, list);
    }
  }
  return new Map([...out].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Every CVE id the brain should ask NVD about: the threat map's and the advisories'. */
export function cvesToCheck(
  threats: readonly Threat[],
  advisories: readonly AdvisoryRecord[],
): string[] {
  return [...new Set([...threatCves(threats).keys(), ...advisories.flatMap((a) => a.ids)])]
    .filter((id) => id.startsWith("CVE-"))
    .sort();
}

/**
 * Checks one CVE id the threat map names against its NVD record. The projects it should name come
 * from the owner's `expect`, else the advisories that name it, else the project pages of the threat
 * records that cite it, else any project the map knows.
 */
export function checkCve(
  id: string,
  named: CveCheck["threats"],
  input: {
    threats: readonly Threat[];
    advisories: readonly AdvisoryRecord[];
    map: AdvisoryMap;
    records: ReadonlyMap<string, NvdRecord>;
  },
): CveCheck {
  const { map } = input;
  const known = new Set(Object.keys(map.products));
  const fromAdvisories = input.advisories
    .filter((a) => a.ids.includes(id) && known.has(a.source))
    .map((a) => a.source);
  const fromPages = input.threats
    .flatMap((t) => t.history)
    .filter((h) => idsIn(`${h.ref} ${h.url}`).includes(id))
    .map((h) => pageProject(h.url, map.products))
    .filter((p): p is string => p !== null);
  const [expected, basis]: [string[], CveCheck["basis"]] = map.expect[id]
    ? [map.expect[id], "owner"]
    : fromAdvisories.length
      ? [fromAdvisories, "advisory"]
      : fromPages.length
        ? [fromPages, "page"]
        : [[], "any"];
  const want = [...new Set(expected)].sort();
  const r = input.records.get(id);
  const nvd = nvdBrief(id, input.records);
  const names = r?.found ? namedProducts(r, map.products) : { named: [], other: [] };
  const allowed = want.length ? want : [...known];
  const finding: FindingKind | null = !r
    ? null
    : !r.found
      ? "missing"
      : r.status === "Rejected"
        ? "rejected"
        : names.named.some((n) => allowed.includes(n))
          ? null
          : names.named.length || names.other.length
            ? "product"
            : "unnamed";
  return {
    id,
    threats: named,
    expected: want,
    basis,
    nvd,
    products: r?.products ?? [],
    ...names,
    finding,
  };
}

export interface AdvisoryReport {
  /** Every advisory the watch has read, newest first, with its matches. */
  advisories: AdvisoryView[];
  /** Advisories no rule and no placement of the owner's puts under any threat: gaps to map. */
  unmatched: AdvisoryView[];
  /** The threat map's CVE ids checked against NVD, by id. */
  cves: CveCheck[];
  counts: {
    advisories: number;
    matched: number;
    unmatched: number;
    /** CVE ids the threat map names. */
    cves: number;
    checked: number;
    found: number;
    mismatched: number;
    unnamed: number;
  };
}

/** Matches every advisory and checks every CVE id of the threat map. */
export function advisoryReport(input: {
  threats: readonly Threat[];
  log: AdvisoryLog | null;
  map: AdvisoryMap | null;
}): AdvisoryReport {
  const map = input.map ?? EMPTY_ADVISORY_MAP;
  const advisories = input.log?.advisories ?? [];
  const records = new Map((input.log?.nvd ?? []).map((r) => [r.id, r]));
  const views: AdvisoryView[] = advisories.map((a) => ({
    ...a,
    matches: matchAdvisory(a, input.threats, map),
    placed: mapped(map.assign, a).keys.length > 0,
    nvd: a.ids.filter((id) => id.startsWith("CVE-")).map((id) => nvdBrief(id, records)),
  }));
  const unmatched = views.filter((v) => !v.matches.length && !v.placed);
  const cves = [...threatCves(input.threats)].map(([id, named]) =>
    checkCve(id, named, { threats: input.threats, advisories, map, records }),
  );
  return {
    advisories: views,
    unmatched,
    cves,
    counts: {
      advisories: views.length,
      matched: views.filter((v) => v.matches.length).length,
      unmatched: unmatched.length,
      cves: cves.length,
      checked: cves.filter((c) => c.nvd.state !== "unchecked").length,
      found: cves.filter((c) => c.nvd.state === "found").length,
      mismatched: cves.filter((c) => c.finding && MISMATCHES.has(c.finding)).length,
      unnamed: cves.filter((c) => c.finding === "unnamed").length,
    },
  };
}

/** Problems with the owner's map against the threat map; errors stop a publish. */
export function advisoryMapIssues(
  map: AdvisoryMap,
  threats: readonly Pick<Threat, "id">[],
): { file: string; level: "error" | "warning"; where: string; message: string }[] {
  const file = "knowledge/security/advisory-map.yaml";
  const ids = new Set(threats.map((t) => t.id));
  const products = new Set(Object.keys(map.products));
  const out: ReturnType<typeof advisoryMapIssues> = [];
  const threat = (where: string, id: string) => {
    if (!ids.has(id))
      out.push({ file, level: "error", where, message: `no threat ${id} on the map` });
  };
  for (const id of Object.keys(map.keywords)) threat(`keywords.${id}`, id);
  for (const id of Object.keys(map.sources)) threat(`sources.${id}`, id);
  for (const part of ["assign", "exclude"] as const)
    for (const [key, list] of Object.entries(map[part]))
      for (const id of list) threat(`${part}.${key}`, id);
  for (const [cve, list] of Object.entries(map.expect))
    for (const p of list)
      if (!products.has(p))
        out.push({
          file,
          level: "error",
          where: `expect.${cve}`,
          message: `no product ${p} in products`,
        });
  return out;
}
