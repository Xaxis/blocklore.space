// The owner's advisory map in the admin (ADMIN.md, "Advisories and NVD"): what the page shows and
// the commands that change knowledge/security/advisory-map.yaml.
//
//   view       the daemon builds it from its own checkout (advisoryAdminView) and sends it on its
//              sync; the site keeps it in ctl:advisories. Every advisory no rule files, the owner's
//              placements, the threat map's NVD findings and the expectations the owner recorded.
//   commands   file an advisory under threats (or none) and take that back; record the project an
//              NVD record names as the one expected for its CVE id, and take that back. The site
//              checks each against the view the owner was shown, the daemon again against its
//              checkout (advisoryCommandProblem), and only the daemon's job writes the file
//              (brain/src/security/advisorymap.ts).
//
// Pure: everything comes in as arguments.
import { z } from "zod";
import {
  ADVISORY_SEVERITIES,
  type AdvisoryMap,
  type AdvisoryRecord,
  type AdvisoryReport,
  advisoryKey,
  cveId,
  EMPTY_ADVISORY_MAP,
  NVD_FINDINGS,
  normId,
  samePage,
} from "./advisories.ts";
import { slug } from "./schema.ts";
import { LAYERS, type Threat } from "./security.ts";

/** A vendor:product pair as NVD lists it, which a project of the map can claim. */
export const CpePair = z
  .string()
  .max(100)
  .regex(/^[a-z0-9_.-]+:[a-z0-9_.-]+$/, "a vendor:product pair");

/** A project's name as the owner gives it: plain words with no colon, so it never reads as a pair. */
export const ProjectName = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 .+_-]{1,39}$/,
    "2 to 40 letters, digits, spaces and . + _ -, starting with a letter or digit",
  );

const unique = (a: readonly string[]) => new Set(a).size === a.length;

/** The owner's four changes to the advisory map, each a signed command the daemon runs as a job. */
export const ADVISORY_COMMANDS = [
  /** File an advisory under the threats it concerns, by the owner's reading; an empty list: none. */
  z.strictObject({
    type: z.literal("advisory.assign"),
    advisory: advisoryKey,
    threats: z.array(slug).max(60).refine(unique, "each threat once"),
  }),
  /** Take the owner's placement back, so the rules file the advisory again. */
  z.strictObject({ type: z.literal("advisory.unassign"), advisory: advisoryKey }),
  /**
   * Settle an NVD finding: the project NVD's record names is the one its CVE id should name. With
   * `cpe`, a new project of the map that claims those pairs; without, a project the map has.
   */
  z.strictObject({
    type: z.literal("advisory.expect"),
    cve: cveId,
    project: ProjectName,
    cpe: z.array(CpePair).max(20).refine(unique, "each pair once"),
  }),
  /** Take the expectation back, and a project it made that nothing else uses. */
  z.strictObject({ type: z.literal("advisory.unexpect"), cve: cveId }),
] as const;

export type AdvisoryCommand = z.infer<(typeof ADVISORY_COMMANDS)[number]>;

export const ADVISORY_COMMAND_TYPES: ReadonlySet<string> = new Set(
  ADVISORY_COMMANDS.map((c) => c.shape.type.value),
);

export function isAdvisoryCommand(cmd: { type: string }): cmd is AdvisoryCommand {
  return ADVISORY_COMMAND_TYPES.has(cmd.type);
}

// ---------------------------------------------------------------------------------------------
// The view

const iso = z.string().max(40);
const threatRef = z.object({ id: slug, where: z.array(z.enum(["history", "terms"])).max(2) });

/** An advisory no rule files and the owner has not placed. */
export const AdminAdvisory = z.object({
  /** How the map names it: its first CVE id, else its first GHSA id, else its page. */
  key: advisoryKey,
  source: z.string().max(40),
  title: z.string().max(200),
  url: z.string().max(400),
  published: iso,
  severity: z.enum(ADVISORY_SEVERITIES).nullable(),
  ids: z.array(z.string().max(40)).max(12),
});
export type AdminAdvisory = z.infer<typeof AdminAdvisory>;

/** One of the owner's placements (the map's `assign`), with the advisories it names. */
export const AdminPlacement = z.object({
  key: advisoryKey,
  /** Empty: the owner said it concerns no threat. */
  threats: z.array(slug).max(60),
  advisories: z
    .array(z.object({ title: z.string().max(200), url: z.string().max(400), source: z.string() }))
    .max(20),
});
export type AdminPlacement = z.infer<typeof AdminPlacement>;

/** A CVE id of the threat map whose NVD record disagrees with it, or says too little. */
export const AdminFinding = z.object({
  id: cveId,
  finding: z.enum(NVD_FINDINGS),
  threats: z.array(threatRef).max(60),
  status: z.string().max(40).nullable(),
  published: iso.nullable(),
  checked: iso.nullable(),
  /** Every vendor:product pair NVD lists as affected. */
  products: z.array(z.string().max(100)).max(40),
  /** Projects of the map NVD's record names. */
  named: z.array(z.string().max(40)).max(40),
  /** Pairs no project of the map claims: what a new project would be made from. */
  other: z.array(z.string().max(100)).max(40),
  expected: z.array(z.string().max(100)).max(40),
  basis: z.enum(["owner", "advisory", "page", "any"]),
});
export type AdminFinding = z.infer<typeof AdminFinding>;

/** One of the owner's expectations (the map's `expect`), and what the check says with it. */
export const AdminExpectation = z.object({
  id: cveId,
  projects: z.array(z.string().max(40)).max(20),
  /** Projects the admin made for it that undoing it also removes (nothing else names them). */
  made: z.array(z.string().max(40)).max(20),
  threats: z.array(threatRef).max(60),
  /** The finding the check still makes with the expectation in place; null when it matches. */
  finding: z.enum(NVD_FINDINGS).nullable(),
});
export type AdminExpectation = z.infer<typeof AdminExpectation>;

export const AdvisoryAdminView = z.object({
  /** The daemon's checkout the view was built from. */
  head: z.string().max(64),
  layers: z.array(z.object({ id: z.string(), label: z.string() })).max(20),
  threats: z.array(z.object({ id: slug, title: z.string().max(200), layer: z.string() })).max(200),
  unmatched: z.array(AdminAdvisory).max(1000),
  placed: z.array(AdminPlacement).max(1000),
  findings: z.array(AdminFinding).max(500),
  expected: z.array(AdminExpectation).max(500),
  /** The map's projects, by name. */
  projects: z.array(z.string().max(40)).max(200),
  counts: z.object({
    advisories: z.number(),
    matched: z.number(),
    unmatched: z.number(),
    cves: z.number(),
    findings: z.number(),
  }),
});
export type AdvisoryAdminView = z.infer<typeof AdvisoryAdminView>;

/** How the map names an advisory the owner places: its first CVE id, else GHSA id, else its page. */
export function advisoryKeyOf(a: Pick<AdvisoryRecord, "ids" | "url">): string {
  return a.ids.find((id) => id.startsWith("CVE-")) ?? a.ids[0] ?? a.url;
}

/** Whether a key of the map names this advisory, as matching reads it. */
export function keyNames(key: string, a: Pick<AdvisoryRecord, "ids" | "url">): boolean {
  return key.startsWith("https://")
    ? samePage(key) === samePage(a.url)
    : a.ids.includes(normId(key));
}

/** A project the admin made from NVD's pairs: it has no words and no pages of its own. */
const madeByAdmin = (p: AdvisoryMap["products"][string] | undefined) =>
  !!p && p.words.length === 0 && p.pages.length === 0;

/** The projects an expectation made that undoing it removes: admin-made, named by no other one. */
export function projectsToDrop(map: AdvisoryMap, cve: string): string[] {
  return (map.expect[cve] ?? []).filter(
    (name) =>
      madeByAdmin(map.products[name]) &&
      !Object.entries(map.expect).some(([id, list]) => id !== cve && list.includes(name)),
  );
}

export function advisoryAdminView(input: {
  threats: readonly Threat[];
  report: AdvisoryReport;
  map: AdvisoryMap | null;
  head: string;
}): AdvisoryAdminView {
  const { report } = input;
  const map = input.map ?? EMPTY_ADVISORY_MAP;
  const findings = report.cves.filter((c) => c.finding);
  return {
    head: input.head,
    layers: LAYERS.map((l) => ({ id: l.id, label: l.label })),
    threats: input.threats.map((t) => ({ id: t.id, title: t.title, layer: t.layer })),
    unmatched: report.unmatched.map((a) => ({
      key: advisoryKeyOf(a),
      source: a.source,
      title: a.title,
      url: a.url,
      published: a.published,
      severity: a.severity,
      ids: a.ids,
    })),
    placed: Object.entries(map.assign).map(([key, threats]) => ({
      key,
      threats,
      advisories: report.advisories
        .filter((a) => keyNames(key, a))
        .slice(0, 20)
        .map((a) => ({ title: a.title, url: a.url, source: a.source })),
    })),
    findings: findings.map((c) => ({
      id: c.id,
      finding: c.finding ?? "unnamed",
      threats: c.threats,
      status: c.nvd.status,
      published: c.nvd.published,
      checked: c.nvd.checked,
      products: c.products,
      named: c.named,
      other: c.other,
      expected: c.expected,
      basis: c.basis,
    })),
    expected: Object.entries(map.expect).map(([id, projects]) => {
      const c = report.cves.find((x) => x.id === id);
      return {
        id,
        projects,
        made: projectsToDrop(map, id),
        threats: c?.threats ?? [],
        finding: c?.finding ?? null,
      };
    }),
    projects: Object.keys(map.products),
    counts: {
      advisories: report.counts.advisories,
      matched: report.counts.matched,
      unmatched: report.counts.unmatched,
      cves: report.counts.cves,
      findings: findings.length,
    },
  };
}

/**
 * Why a command does not fit the map as this view shows it, or null when it does. The site asks it
 * of the view the owner was shown, the daemon of its checkout just before it edits the file.
 */
export function advisoryCommandProblem(
  cmd: AdvisoryCommand,
  view: AdvisoryAdminView,
): string | null {
  switch (cmd.type) {
    case "advisory.assign": {
      const known = new Set(view.threats.map((t) => t.id));
      const missing = cmd.threats.filter((t) => !known.has(t));
      if (missing.length) return `There is no threat ${missing.join(", ")} on the map.`;
      const open =
        view.unmatched.some((a) => a.key === cmd.advisory) ||
        view.placed.some((p) => p.key === cmd.advisory);
      return open ? null : `${cmd.advisory} is not an advisory to map, nor one you placed.`;
    }
    case "advisory.unassign":
      return view.placed.some((p) => p.key === cmd.advisory)
        ? null
        : `You have not placed ${cmd.advisory}.`;
    case "advisory.expect": {
      const f = view.findings.find((x) => x.id === cmd.cve);
      if (!f) return `${cmd.cve} has no NVD finding to settle.`;
      if (f.finding !== "product")
        return `${cmd.cve}'s finding is not about the product NVD names, so no project settles it.`;
      if (cmd.cpe.length) {
        const extra = cmd.cpe.filter((p) => !f.other.includes(p));
        if (extra.length) return `NVD's record of ${cmd.cve} does not list ${extra.join(", ")}.`;
        if (view.projects.some((p) => p.toLowerCase() === cmd.project.toLowerCase()))
          return `The map already has a project called ${cmd.project}; give the new one its own name.`;
        return null;
      }
      return f.named.includes(cmd.project)
        ? null
        : `NVD's record of ${cmd.cve} does not name ${cmd.project}.`;
    }
    case "advisory.unexpect":
      return view.expected.some((e) => e.id === cmd.cve)
        ? null
        : `You have recorded no expectation for ${cmd.cve}.`;
  }
}
