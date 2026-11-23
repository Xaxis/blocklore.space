// Every advisory the advisories watch has read, kept in knowledge/security/advisories.json with
// the NVD record of each CVE id it or the threat map names (BACKLOG 36 and 38). The inbox may be
// pruned; this file keeps what it once held, so a threat's page keeps its advisories. Core matches
// them to the threats (core/src/advisories.ts) when the bundle compiles and when this prints.
//
//   pnpm brain advisories [--nvd N | --nvd all] [--commit] [--push]
//
// The advisories watch calls refreshAdvisories on the hourly tick (every six hours, its cadence)
// with a small NVD allowance, so a tick never spends more than about a minute on NVD.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ADVISORY_KEEP,
  type AdvisoryLog,
  AdvisoryLog as AdvisoryLogSchema,
  type AdvisoryRecord,
  advisoryReport,
  cvesToCheck,
  idsIn,
  MISMATCHES,
  type NvdRecord,
  samePage,
  undash,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { INBOX, KNOWLEDGE, ROOT } from "../env.ts";
import { commitAsOwner } from "../git.ts";
import type { InboxItem } from "../ingest.ts";
import { ADVISORY_SOURCES } from "./advisories.ts";
import { fetchNvd, nvdQueue } from "./nvd.ts";

export const ADVISORIES_FILE = () =>
  process.env.BLOCKLORE_ADVISORIES_FILE || path.join(KNOWLEDGE, "security", "advisories.json");

/** How many NVD records one tick of the watch may ask for: about a minute at NVD's pace. */
export const NVD_PER_RUN = 8;

const stamp = (t: string) => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

export function readAdvisoryLog(file = ADVISORIES_FILE()): AdvisoryLog | null {
  if (!existsSync(file)) return null;
  return AdvisoryLogSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** The advisories the ingest feeds put in the inbox, each page once, with the ids it names. */
export function inboxAdvisoryRecords(dir = INBOX): AdvisoryRecord[] {
  const out: AdvisoryRecord[] = [];
  const seen = new Set<string>();
  for (const [source, name] of Object.entries(ADVISORY_SOURCES)) {
    const f = path.join(dir, `${source}.jsonl`);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const i = JSON.parse(line) as InboxItem;
      if (seen.has(samePage(i.url)) || !i.url.startsWith("https://")) continue;
      seen.add(samePage(i.url));
      const title = undash(i.title.replace(/\s+/g, " ").trim()).slice(0, 200);
      out.push({
        source: name,
        title,
        url: i.url,
        published: stamp(i.published),
        severity: i.severity ?? null,
        ids: idsIn(`${i.title} ${i.url} ${i.id}`).slice(0, 12),
      });
    }
  }
  return out;
}

/** The log's advisories and the inbox's, each page once; the inbox's copy wins, newest first. */
export function mergeAdvisories(
  previous: readonly AdvisoryRecord[],
  inbox: readonly AdvisoryRecord[],
): AdvisoryRecord[] {
  const byPage = new Map(previous.map((a) => [samePage(a.url), a]));
  for (const a of inbox) byPage.set(samePage(a.url), a);
  return [...byPage.values()]
    .sort((a, b) => b.published.localeCompare(a.published) || a.url.localeCompare(b.url))
    .slice(0, ADVISORY_KEEP);
}

export interface Refreshed {
  log: AdvisoryLog;
  written: boolean;
  added: number;
  asked: number;
  failed: string[];
}

/**
 * Brings the log up to date: the inbox's advisories merged in, and up to `nvd` NVD records asked
 * for (the due ones, oldest first). Writes the file only when something changed.
 */
export async function refreshAdvisories(opts: {
  now: string;
  nvd: number;
  inbox?: string;
  file?: string;
}): Promise<Refreshed> {
  const file = opts.file ?? ADVISORIES_FILE();
  const previous = readAdvisoryLog(file);
  const advisories = mergeAdvisories(previous?.advisories ?? [], inboxAdvisoryRecords(opts.inbox));
  const records = new Map((previous?.nvd ?? []).map((r) => [r.id, r]));
  const threats = loadStore(KNOWLEDGE).store.security?.threats ?? [];
  const queue = nvdQueue(cvesToCheck(threats, advisories), records, opts.now, opts.nvd);
  const failed: string[] = [];
  for (const id of queue) {
    try {
      records.set(id, await fetchNvd(id));
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
      // NVD refusing one answer usually means it is refusing all: try again next run.
      if (/HTTP (403|429)/.test(failed.at(-1) ?? "")) break;
    }
  }
  const nvd: NvdRecord[] = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  const same =
    previous &&
    JSON.stringify(previous.advisories) === JSON.stringify(advisories) &&
    JSON.stringify(previous.nvd) === JSON.stringify(nvd);
  const log = AdvisoryLogSchema.parse({
    updated: same ? previous.updated : opts.now,
    advisories,
    nvd,
  });
  if (!same) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(log, null, 1)}\n`);
  }
  const known = new Set((previous?.advisories ?? []).map((a) => samePage(a.url)));
  return {
    log,
    written: !same,
    added: advisories.filter((a) => !known.has(samePage(a.url))).length,
    asked: queue.length - failed.length,
    failed,
  };
}

const FINDING_TEXT: Record<string, string> = {
  missing: "NVD has no record of it",
  rejected: "NVD lists it as rejected",
  product: "NVD's record names a different product",
  unnamed: "NVD's record names no product the advisory map knows",
};

/** The matching and the NVD check, as `brain advisories` prints them. */
export function describeAdvisories(log: AdvisoryLog | null): string[] {
  const { store } = loadStore(KNOWLEDGE);
  const threats = store.security?.threats ?? [];
  const r = advisoryReport({ threats, log, map: store.security?.advisoryMap ?? null });
  const c = r.counts;
  const lines = [
    `advisories: ${c.advisories} read, ${c.matched} filed under a threat, ${c.unmatched} to map`,
  ];
  for (const a of r.advisories) {
    lines.push(`  ${a.published.slice(0, 10)}  ${a.source.padEnd(14)} ${a.title}`);
    if (a.matches.length)
      for (const m of a.matches) lines.push(`      ${m.threat} (${m.rule}: ${m.by.join(", ")})`);
    else
      lines.push(
        a.placed
          ? "      on no threat, by the owner's map"
          : "      TO MAP: no rule files it under a threat",
      );
  }
  lines.push(
    `nvd: ${c.cves} CVE ids on the threat map, ${c.checked} checked, ${c.found} found, ${c.mismatched} mismatched, ${c.unnamed} unconfirmed`,
  );
  for (const x of r.cves) {
    const where = x.threats.map((t) => `${t.id} (${t.where.join(", ")})`).join("; ");
    const nvd =
      x.nvd.state === "unchecked"
        ? "not checked yet"
        : x.nvd.state === "missing"
          ? "no record"
          : `${x.nvd.status}, published ${x.nvd.published?.slice(0, 10)}, names ${[...x.named, ...x.other].join(", ") || "nothing known"}`;
    const flag = x.finding
      ? `  FINDING ${x.finding}${MISMATCHES.has(x.finding) ? " (mismatch)" : ""}: ${FINDING_TEXT[x.finding]}${x.finding === "product" ? `; expected ${x.expected.join(", ") || "any project in the map"} (${x.basis})` : ""}`
      : "";
    lines.push(`  ${x.id.padEnd(16)} ${nvd}\n      on ${where}${flag ? `\n    ${flag}` : ""}`);
  }
  const adv = r.advisories.flatMap((a) => a.nvd);
  const ids = [...new Map(adv.map((b) => [b.id, b])).values()];
  lines.push(
    `nvd (advisories): ${ids.length} CVE ids, ${ids.filter((b) => b.state === "found").length} found, ${ids.filter((b) => b.state === "missing").length} not in NVD, ${ids.filter((b) => b.state === "unchecked").length} not checked yet`,
  );
  for (const b of ids.filter((x) => x.state === "missing"))
    lines.push(`  ${b.id}  no NVD record (checked ${b.checked})`);
  return lines;
}

export async function advisoriesCommand(opts: {
  nvd: number;
  commit: boolean;
  push: boolean;
}): Promise<number> {
  const now = stamp(new Date().toISOString());
  const r = await refreshAdvisories({ now, nvd: opts.nvd });
  console.log(
    `advisories: ${r.log.advisories.length} kept (${r.added} new), ${r.asked} NVD records read${r.failed.length ? `, ${r.failed.length} failed: ${r.failed.join("; ")}` : ""}${r.written ? "" : ", nothing changed"}`,
  );
  for (const l of describeAdvisories(r.log)) console.log(l);
  if (opts.commit && r.written)
    commitAsOwner(
      [path.relative(ROOT, ADVISORIES_FILE())],
      "Record the advisories the watch read and NVD's records of their CVE ids, so each threat's page lists its own advisories and its record is checked against NVD.",
      opts.push,
    );
  return r.failed.length ? 1 : 0;
}
