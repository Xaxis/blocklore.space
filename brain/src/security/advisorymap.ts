// The owner's advisory map changed from the admin (ADMIN.md, "Advisories and NVD"). Each command
// is one edit of knowledge/security/advisory-map.yaml as a YAML document, so the owner's comments,
// order and every line it does not touch stay as they were; the job (brain/src/jobs.ts) formats
// it, checks it here against the map's schema and the threat map, and only then writes and commits
// it. The view the admin shows comes from here too, built from this checkout.
import { statSync } from "node:fs";
import path from "node:path";
import {
  type AdvisoryAdminView,
  type AdvisoryCommand,
  AdvisoryMap,
  advisoryAdminView,
  advisoryCommandProblem,
  advisoryMapIssues,
  advisoryReport,
  hasDash,
  projectsToDrop,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { isMap, parse, parseDocument, Scalar, YAMLMap } from "yaml";
import { KNOWLEDGE } from "../env.ts";

export const ADVISORY_MAP_FILE = path.join(KNOWLEDGE, "security", "advisory-map.yaml");
const ADVISORY_LOG_FILE = path.join(KNOWLEDGE, "security", "advisories.json");

/** When the map and the advisories last changed on disk, so the daemon rebuilds the view only then. */
export function advisoryStamp(): string {
  return [ADVISORY_MAP_FILE, ADVISORY_LOG_FILE]
    .map((f) => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return "none";
      }
    })
    .join("|");
}

/** How the map is written back: as the owner wrote it (flow lists without inner padding). */
const TO_STRING = { lineWidth: 100, flowCollectionPadding: false } as const;

/** The map, the threats and the matching as this checkout has them now. */
export function advisoryView(head: string): AdvisoryAdminView {
  const { store } = loadStore(KNOWLEDGE);
  const s = store.security;
  if (!s) throw new Error("the store has no security section");
  const map = s.advisoryMap ?? null;
  const report = advisoryReport({ threats: s.threats, log: s.advisories ?? null, map });
  return advisoryAdminView({ threats: s.threats, report, map, head });
}

/** A top-level section of the map, as a node of the document. */
function section(doc: ReturnType<typeof parseDocument>, key: string): YAMLMap {
  const node = doc.get(key, true);
  if (!isMap(node)) throw new Error(`the advisory map has no ${key} section`);
  return node;
}

/** A section is written in block style while it has entries and as `{}` without, as the owner does. */
const blockOrEmpty = (m: YAMLMap) => {
  m.flow = m.items.length === 0;
};

/** A flow list `[a, b]`, its strings quoted when `quote` says so (CPE pairs are, as the file has them). */
function flowList(doc: ReturnType<typeof parseDocument>, items: readonly string[], quote = false) {
  const seq = doc.createNode(
    items.map((v) => {
      const s = new Scalar(v);
      if (quote) s.type = Scalar.QUOTE_DOUBLE;
      return s;
    }),
    { flow: true },
  );
  return seq;
}

const threatsText = (ids: readonly string[]) =>
  ids.length === 1 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;

/**
 * The map's text with one command applied, and the sentence its commit says. Throws, changing
 * nothing, when the command does not fit the map as `view` (this checkout, now) shows it.
 */
export function editAdvisoryMap(
  text: string,
  cmd: AdvisoryCommand,
  view: AdvisoryAdminView,
): { text: string; message: string } {
  const problem = advisoryCommandProblem(cmd, view);
  if (problem) throw new Error(problem);
  const doc = parseDocument(text);
  if (doc.errors.length)
    throw new Error(`the advisory map does not parse: ${doc.errors[0]?.message}`);
  let message: string;
  switch (cmd.type) {
    case "advisory.assign": {
      const assign = section(doc, "assign");
      assign.set(cmd.advisory, flowList(doc, cmd.threats));
      blockOrEmpty(assign);
      message = cmd.threats.length
        ? `File ${cmd.advisory} under ${threatsText(cmd.threats)}, as the owner asked in the admin, so ${cmd.threats.length === 1 ? "that threat's page lists" : "those threats' pages list"} it.`
        : `Say ${cmd.advisory} concerns no threat, as the owner asked in the admin, so it stops waiting on /gaps.`;
      break;
    }
    case "advisory.unassign": {
      const assign = section(doc, "assign");
      if (!assign.delete(cmd.advisory)) throw new Error(`the map does not place ${cmd.advisory}`);
      blockOrEmpty(assign);
      message = `Take back the owner's placement of ${cmd.advisory}, as the owner asked in the admin, so the rules file it again.`;
      break;
    }
    case "advisory.expect": {
      const products = section(doc, "products");
      const expect = section(doc, "expect");
      if (cmd.cpe.length) {
        if (products.has(cmd.project))
          throw new Error(`the map already has a project ${cmd.project}`);
        const p = new YAMLMap<string, unknown>();
        p.set("cpe", flowList(doc, cmd.cpe, true));
        p.set("words", flowList(doc, []));
        p.set("pages", flowList(doc, []));
        products.set(cmd.project, p);
      }
      expect.set(cmd.cve, flowList(doc, [cmd.project]));
      blockOrEmpty(expect);
      message = cmd.cpe.length
        ? `Expect NVD to name ${cmd.project} (${cmd.cpe.join(", ")}) for ${cmd.cve}, as the owner asked in the admin, because its record is rightly that project's.`
        : `Expect NVD to name ${cmd.project} for ${cmd.cve}, as the owner asked in the admin, because its record is rightly that project's.`;
      break;
    }
    case "advisory.unexpect": {
      const expect = section(doc, "expect");
      const before = AdvisoryMap.parse(parse(text));
      const drop = projectsToDrop(before, cmd.cve);
      if (!expect.delete(cmd.cve)) throw new Error(`the map expects nothing for ${cmd.cve}`);
      blockOrEmpty(expect);
      const products = section(doc, "products");
      for (const name of drop) products.delete(name);
      message = `Take back the owner's expectation for ${cmd.cve}${drop.length ? ` and the project ${drop.join(" and ")} it made` : ""}, as the owner asked in the admin, so the NVD check reads it again.`;
      break;
    }
  }
  return { text: doc.toString(TO_STRING), message };
}

/**
 * The edited text as the job is about to write it: it must parse as the map, name only threats and
 * projects that exist, hold no dash the style check refuses, and say what the command asked.
 */
export function checkAdvisoryMap(
  text: string,
  cmd: AdvisoryCommand,
  threats: readonly { id: string }[],
): AdvisoryMap {
  const parsed = AdvisoryMap.safeParse(parse(text));
  if (!parsed.success)
    throw new Error(`the edited map does not match its schema: ${parsed.error.issues[0]?.message}`);
  const map = parsed.data;
  const errors = advisoryMapIssues(map, threats).filter((i) => i.level === "error");
  if (errors.length) throw new Error(`the edited map ${errors[0]?.where}: ${errors[0]?.message}`);
  if (hasDash(text)) throw new Error("the edited map holds a dash the style check refuses");
  const same = (a: readonly string[] | undefined, b: readonly string[]) =>
    !!a && a.length === b.length && a.every((x, i) => x === b[i]);
  const says =
    cmd.type === "advisory.assign"
      ? same(map.assign[cmd.advisory], cmd.threats)
      : cmd.type === "advisory.unassign"
        ? !(cmd.advisory in map.assign)
        : cmd.type === "advisory.expect"
          ? same(map.expect[cmd.cve], [cmd.project]) &&
            cmd.cpe.every((p) => map.products[cmd.project]?.cpe.includes(p))
          : !(cmd.cve in map.expect);
  if (!says) throw new Error("the edited map does not say what the owner asked");
  return map;
}
