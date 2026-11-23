// The security watch (ARCHITECTURE.md, "The security watch"): a continual, checkable account of
// every known way Bitcoin can be attacked, what defends against each, and what Blocklore watches and
// tests for each, from public data and local regtest only.
//
//   knowledge/security/threats/<id>.yaml   the threat map, curated by the owner: one threat per
//                                          file, structure only (titles, ids, links, machine data);
//                                          every sentence a reader sees about a threat is a claim
//   knowledge/security/watches.json        the watches' latest readings and short history, written
//                                          by `brain watch` from public chain and node data
//   knowledge/security/lab.json            lab runs that passed: Bitcoin Core's own functional
//                                          tests run in regtest against the latest release
//   knowledge/security/advisory-map.yaml   the owner's rules for filing advisories under threats
//   knowledge/security/advisories.json     every advisory the watch has read, and NVD's records of
//                                          the CVE ids it and the threat map name (advisories.ts)
//
// Nothing undisclosed is ever here: the disclosure gate (disclosure.ts) holds any lab failure and
// any research finding that may describe an unpatched weakness, privately, for the owner.
//
// Pure: the store comes in as an argument; nothing reads the clock.
import { z } from "zod";
import {
  type AdvisoryLog,
  type AdvisoryMap,
  type AdvisoryMatch,
  type AdvisoryReport,
  type AdvisoryView,
  advisoryReport,
  type CveCheck,
} from "./advisories.ts";
import { claimId, slug } from "./schema.ts";

export const LAYERS = [
  { id: "consensus", label: "Consensus and validation" },
  { id: "network", label: "Peer-to-peer network" },
  { id: "mining", label: "Mining and hashrate" },
  { id: "cryptography", label: "Cryptography" },
  { id: "wallets", label: "Wallets and keys" },
  { id: "layers", label: "Lightning and other layers" },
  { id: "supply-chain", label: "Software supply chain" },
  { id: "people", label: "People and social engineering" },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];
const LAYER_IDS = LAYERS.map((l) => l.id) as [LayerId, ...LayerId[]];

/**
 * A threat's status, as the scene and the page show it:
 *   defended  known, and fixed or defended in deployed software
 *   watching  defended in part, or depends on conditions Blocklore keeps measuring
 *   open      no deployed defense yet, or the defense is not holding
 */
export const THREAT_STATUSES = ["defended", "watching", "open"] as const;
export type ThreatStatus = (typeof THREAT_STATUSES)[number];
const RANK: Record<ThreatStatus, number> = { defended: 0, watching: 1, open: 2 };

export const WATCH_IDS = [
  "hashrate",
  "block-gaps",
  "timestamps",
  "difficulty",
  "reorgs",
  "advisories",
  "node-versions",
] as const;
export type WatchId = (typeof WATCH_IDS)[number];

/** A watch's reading: within normal bounds, worth attention, a threshold crossed, or no data. */
export const WATCH_LEVELS = ["ok", "elevated", "alert", "unknown"] as const;
export type WatchLevel = (typeof WATCH_LEVELS)[number];

/** The lab's release check, which covers threats like any functional test does. */
export const RELEASE_CHECK = "release-signatures";
const labTest = z.union([z.string().regex(/^[a-z0-9_]+\.py$/), z.literal(RELEASE_CHECK)]);

const isoTime = z.iso.datetime({ offset: false });
const isoDate = z.iso.date();

/** A public record of the threat: an advisory, a CVE, a BIP, a paper, an incident. */
export const HistoryRef = z.strictObject({
  /** A short identifier a reader recognizes: "CVE-2018-17144", "BIP 54", "block 74,638". */
  ref: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 #.,:'()/+-]*$/),
  url: z.url({ protocol: /^https$/ }),
  /** When it was published or happened, as precisely as the record says; none for living pages. */
  date: z.union([isoDate, z.string().regex(/^\d{4}(-\d{2})?$/)]).optional(),
});
export type HistoryRef = z.infer<typeof HistoryRef>;

export const Threat = z.strictObject({
  id: slug,
  /** Plain words a newcomer understands. */
  title: z.string().min(3).max(90),
  layer: z.enum(LAYER_IDS),
  /** The owner's assessment; a watch past its threshold raises it (threatStatus). */
  status: z.enum(THREAT_STATUSES),
  /** The topic research files claims about this threat under. */
  topic: slug,
  /** Published claims that say what the threat is and how it works, in order. */
  claims: z.array(claimId),
  /** Published claims that say what defends against it. */
  mitigations: z.array(claimId),
  history: z.array(HistoryRef),
  watches: z.array(z.enum(WATCH_IDS)),
  /** Bitcoin Core functional tests (test/functional) that exercise its defenses, and the release check. */
  lab: z.array(labTest),
  /**
   * Names under which the threat is public knowledge ("time warp", "CVE-2018-17144"). The
   * disclosure gate treats a security finding that names one of them as already public; specific
   * names only, never a whole class like "denial of service".
   */
  terms: z.array(z.string().min(3).max(60)),
});
export type Threat = z.infer<typeof Threat>;

/** A threat needs at least this many published claims of each part to be explained. */
export const THREAT_MIN = { claims: 1, mitigations: 1 } as const;

// ---------------------------------------------------------------------------------------------
// Watches

export const WATCH_HISTORY = 48;

const height = z.number().int().nonnegative();
const point = z.strictObject({
  at: isoTime,
  value: z.number().nullable(),
  status: z.enum(WATCH_LEVELS),
});
const base = {
  /** When the watch last ran. */
  at: isoTime,
  /** The chain tip it saw, when it reads the chain. */
  height: height.nullable(),
  status: z.enum(WATCH_LEVELS),
  /** The headline number, in the watch's unit (WATCHES). */
  value: z.number().nullable(),
  /** Oldest first; a point is added when the value or the status changes, or a day has passed. */
  history: z.array(point).max(WATCH_HISTORY),
  /** Why the last reading failed, when it did: the previous data stays. */
  error: z.string().max(200).optional(),
};
const blockAt = z.strictObject({ height, minutes: z.number() });

export const WatchState = z.discriminatedUnion("id", [
  z.strictObject({
    id: z.literal("hashrate"),
    ...base,
    data: z
      .strictObject({
        /** Blocks in the window the shares are over. */
        blocks: z.number().int().positive(),
        /** The largest pools, by blocks found in the window. */
        pools: z.array(z.strictObject({ name: z.string().min(1).max(60), blocks: height })).max(8),
      })
      .nullable(),
  }),
  z.strictObject({
    id: z.literal("block-gaps"),
    ...base,
    data: z
      .strictObject({
        from: height,
        to: height,
        /** The longest interval between consecutive block timestamps, at the later block. */
        longest: blockAt,
        median: z.number(),
      })
      .nullable(),
  }),
  z.strictObject({
    id: z.literal("timestamps"),
    ...base,
    data: z
      .strictObject({
        from: height,
        to: height,
        /** Blocks whose timestamp is earlier than their parent's, by how many minutes. */
        backward: z.array(blockAt).max(12),
        /** Backward steps at the first block of a difficulty period, the time warp signature. */
        boundary: z.array(blockAt).max(12),
      })
      .nullable(),
  }),
  z.strictObject({
    id: z.literal("difficulty"),
    ...base,
    data: z
      .strictObject({
        /** The first block of the current difficulty period. */
        period: height,
        /** The last adjustment, in percent (positive when difficulty rose). */
        last: z.number(),
        /** The adjustment the current period is on course for, in percent. */
        projected: z.number().nullable(),
        /** Average minutes per block so far in the current period. */
        minutes: z.number().nullable(),
        adjustments: z.array(z.strictObject({ height, percent: z.number() })).max(12),
      })
      .nullable(),
  }),
  z.strictObject({
    id: z.literal("reorgs"),
    ...base,
    data: z
      .strictObject({
        /** Blocks the brain has followed, a hash per height. */
        followed: z.number().int().nonnegative(),
        /** Reorganizations the brain observed: blocks it had seen replaced at a height. */
        events: z
          .array(
            z.strictObject({
              at: isoTime,
              height,
              depth: z.number().int().positive(),
            }),
          )
          .max(24),
      })
      .nullable(),
  }),
  z.strictObject({
    id: z.literal("advisories"),
    ...base,
    data: z
      .strictObject({
        items: z
          .array(
            z.strictObject({
              source: z.string().min(1).max(40),
              title: z.string().min(1).max(200),
              url: z.url({ protocol: /^https$/ }),
              published: isoTime,
              severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
            }),
          )
          .max(24),
      })
      .nullable(),
  }),
  z.strictObject({
    id: z.literal("node-versions"),
    ...base,
    data: z
      .strictObject({
        /** Reachable nodes in the crawl. */
        nodes: z.number().int().nonnegative(),
        /** Of those, nodes that say they run Bitcoin Core. */
        core: z.number().int().nonnegative(),
        /** Of those, nodes on a major version past end of life. */
        eol: z.number().int().nonnegative(),
        /** Major versions below this are past end of life. */
        below: z.number().int().positive(),
        /** The newest Bitcoin Core release when the watch ran. */
        newest: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
        crawled: isoTime,
      })
      .nullable(),
  }),
]);
export type WatchState = z.infer<typeof WatchState>;

export const Watches = z.strictObject({ updated: isoTime, watches: z.array(WatchState) });
export type Watches = z.infer<typeof Watches>;

// ---------------------------------------------------------------------------------------------
// The lab

export const LAB_KEEP = 12;

export const LabTest = z.strictObject({
  name: labTest,
  ok: z.boolean(),
  seconds: z.number().min(0),
});
export type LabTest = z.infer<typeof LabTest>;

export const LabRun = z.strictObject({
  at: isoTime,
  /** The Bitcoin Core release tested, as tagged: "32.1". */
  version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  platform: z.string().min(3).max(60),
  verified: z.strictObject({
    /** The tarball's SHA-256 matched the release's SHA256SUMS. */
    sha256: z.boolean(),
    /** Builder signatures over SHA256SUMS that gpg found good, and builders whose keys were known. */
    signatures: z.number().int().min(0).nullable(),
    signers: z.number().int().min(0).nullable(),
  }),
  jobs: z.number().int().positive(),
  seconds: z.number().min(0),
  tests: z.array(LabTest).min(1),
});
export type LabRun = z.infer<typeof LabRun>;

/** Newest first. Only runs that passed, or that the owner released after a look. */
export const Lab = z.strictObject({ runs: z.array(LabRun).max(LAB_KEEP) });
export type Lab = z.infer<typeof Lab>;

// ---------------------------------------------------------------------------------------------
// The compiled view

export interface SecurityStore {
  threats: Threat[];
  watches: Watches | null;
  lab: Lab | null;
  /** Every advisory the watch has read and the NVD records (knowledge/security/advisories.json). */
  advisories?: AdvisoryLog | null;
  /** The owner's rules for filing advisories (knowledge/security/advisory-map.yaml). */
  advisoryMap?: AdvisoryMap | null;
}

/** An advisory on a threat's page: the advisory, the rule that filed it there and on what. */
export type ThreatAdvisory = Omit<AdvisoryView, "matches" | "placed"> &
  Pick<AdvisoryMatch, "rule" | "by">;

export interface ThreatView extends Threat {
  /** The owner's status raised by any watch past its threshold. */
  live: ThreatStatus;
  /** Why the live status differs from the owner's, when it does. */
  raisedBy: WatchId[];
  /** Published claim ids of each part (claims not published yet are left out). */
  published: { claims: string[]; mitigations: string[] };
  /** What research still has to explain; empty when the threat is covered. */
  missing: ("claims" | "mitigations")[];
  /** The newest published lab result of each of its tests. */
  results: { name: string; ok: boolean; version: string; at: string }[];
  /** The advisories filed under it, newest first. */
  advisories: ThreatAdvisory[];
  /** The CVE ids its record and terms name, checked against NVD. */
  cves: CveCheck[];
}

export interface SecurityView {
  layers: {
    id: LayerId;
    label: string;
    threats: ThreatView[];
    counts: Record<ThreatStatus, number>;
  }[];
  watches: WatchState[];
  lab: LabRun | null;
  labRuns: LabRun[];
  updated: string | null;
  /** Threats research still has to explain, by topic. */
  gaps: ThreatGap[];
  /** Every advisory with its threats, the ones still to map, and the NVD check. */
  advisories: AdvisoryReport;
}

export interface ThreatGap {
  id: string;
  title: string;
  topic: string;
  layer: LayerId;
  missing: ("claims" | "mitigations")[];
  have: number;
}

/**
 * The watches that measure a threat's own conditions on the chain, so their level can raise its
 * status. Advisories and node versions are context for every threat they list, never a reason to
 * call one open: a new advisory about one bug says nothing about another.
 */
export const RAISING: ReadonlySet<WatchId> = new Set<WatchId>([
  "hashrate",
  "block-gaps",
  "timestamps",
  "difficulty",
  "reorgs",
]);

/** A watch's level raises a threat's status to at least this. */
const RAISE: Record<WatchLevel, ThreatStatus | null> = {
  ok: null,
  unknown: null,
  elevated: "watching",
  alert: "open",
};

/**
 * The owner's status, raised to `watching` by an elevated chain watch and to `open` by an alert
 * (RAISING lists the chain watches).
 */
export function threatStatus(
  t: Pick<Threat, "status" | "watches">,
  watches: readonly Pick<WatchState, "id" | "status">[],
): { live: ThreatStatus; raisedBy: WatchId[] } {
  let live = t.status;
  const raisedBy: WatchId[] = [];
  for (const w of watches) {
    if (!t.watches.includes(w.id) || !RAISING.has(w.id)) continue;
    const r = RAISE[w.status];
    if (r && RANK[r] > RANK[t.status]) {
      raisedBy.push(w.id);
      if (RANK[r] > RANK[live]) live = r;
    }
  }
  return { live, raisedBy };
}

/** The threats research still has to explain, for the gap map. */
export function threatGaps(threats: Threat[], published: ReadonlySet<string>): ThreatGap[] {
  return threats.flatMap((t) => {
    const claims = t.claims.filter((id) => published.has(id));
    const mitigations = t.mitigations.filter((id) => published.has(id));
    const missing = missingParts(claims.length, mitigations.length);
    return missing.length
      ? [
          {
            id: t.id,
            title: t.title,
            topic: t.topic,
            layer: t.layer,
            missing,
            have: claims.length + mitigations.length,
          },
        ]
      : [];
  });
}

function missingParts(claims: number, mitigations: number): ("claims" | "mitigations")[] {
  const out: ("claims" | "mitigations")[] = [];
  if (claims < THREAT_MIN.claims) out.push("claims");
  if (mitigations < THREAT_MIN.mitigations) out.push("mitigations");
  return out;
}

/** Problems with the threat map against the published claims; errors stop a publish. */
export function threatIssues(
  threats: Threat[],
  claims: ReadonlySet<string>,
): { file: string; level: "error" | "warning"; where: string; message: string }[] {
  const out: { file: string; level: "error" | "warning"; where: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const t of threats) {
    const file = `threat ${t.id}`;
    if (seen.has(t.id)) out.push({ file, level: "error", where: "id", message: "is used twice" });
    seen.add(t.id);
    for (const part of ["claims", "mitigations"] as const)
      for (const id of t[part])
        if (!claims.has(id))
          out.push({ file, level: "error", where: part, message: `no published claim ${id}` });
    if (
      new Set(t.claims).size !== t.claims.length ||
      new Set(t.mitigations).size !== t.mitigations.length
    )
      out.push({ file, level: "error", where: "claims", message: "lists a claim twice" });
    for (const term of t.terms)
      if (BROAD_TERMS.has(term.toLowerCase()))
        out.push({
          file,
          level: "error",
          where: "terms",
          message: `"${term}" names a whole class; the disclosure gate needs specific names`,
        });
  }
  return out;
}

/**
 * Terms too broad to mark a finding as public: a new bug of any of these kinds would pass the
 * disclosure gate under them. The threat map may not use them.
 */
export const BROAD_TERMS = new Set([
  "attack",
  "bug",
  "crash",
  "denial of service",
  "dos",
  "exploit",
  "vulnerability",
  "consensus bug",
  "inflation",
  "memory exhaustion",
  "remote crash",
  "security",
]);

/** Compiles the security view from the threat map, the watches, the lab and the published claims. */
export function securityView(store: SecurityStore, published: ReadonlySet<string>): SecurityView {
  const watches = store.watches?.watches ?? [];
  const runs = store.lab?.runs ?? [];
  const results = new Map<string, ThreatView["results"][number]>();
  // Runs are newest first: the first result seen for a test is its newest.
  for (const run of runs) {
    for (const t of run.tests)
      if (!results.has(t.name))
        results.set(t.name, { name: t.name, ok: t.ok, version: run.version, at: run.at });
    if (!results.has(RELEASE_CHECK))
      results.set(RELEASE_CHECK, {
        name: RELEASE_CHECK,
        ok: run.verified.sha256 && (run.verified.signatures ?? 0) > 0,
        version: run.version,
        at: run.at,
      });
  }
  const report = advisoryReport({
    threats: store.threats,
    log: store.advisories ?? null,
    map: store.advisoryMap ?? null,
  });
  const views: ThreatView[] = store.threats.map((t) => {
    const claims = t.claims.filter((id) => published.has(id));
    const mitigations = t.mitigations.filter((id) => published.has(id));
    return {
      ...t,
      ...threatStatus(t, watches),
      published: { claims, mitigations },
      missing: missingParts(claims.length, mitigations.length),
      results: t.lab.flatMap((name) => {
        const r = results.get(name);
        return r ? [r] : [];
      }),
      advisories: report.advisories.flatMap(({ matches, placed: _, ...a }) => {
        const m = matches.find((x) => x.threat === t.id);
        return m ? [{ ...a, rule: m.rule, by: m.by }] : [];
      }),
      cves: report.cves.filter((c) => c.threats.some((x) => x.id === t.id)),
    };
  });
  return {
    layers: LAYERS.map((l) => {
      const threats = views.filter((v) => v.layer === l.id);
      const counts = { defended: 0, watching: 0, open: 0 };
      for (const t of threats) counts[t.live]++;
      return { id: l.id, label: l.label, threats, counts };
    }),
    watches: WATCH_IDS.flatMap((id) => watches.filter((w) => w.id === id)),
    lab: runs[0] ?? null,
    labRuns: runs,
    updated: store.watches?.updated ?? null,
    gaps: threatGaps(store.threats, published),
    advisories: report,
  };
}
