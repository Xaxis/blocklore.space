// Reads knowledge/ into a Store. The only part of core that touches the filesystem.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import { AdvisoryLog, AdvisoryMap } from "../advisories.ts";
import type { FileIssue, Store, StoredSnapshot } from "../bundle.ts";
import { NostrChannel } from "../nostr.ts";
import {
  AttestationRecordSchema,
  DelegationEnvelopeSchema,
  type OcRecords,
  RevocationEnvelopeSchema,
} from "../orangecheck.ts";
import {
  BipIndex,
  Claim,
  CoreBips,
  Debate,
  EvaluatorRecord,
  Proposal,
  Rechecks,
  ReviewCount,
  Run,
  Scorecard,
  Snapshot,
  Topic,
  Wire,
} from "../schema.ts";
import { Lab, type SecurityStore, Threat, Watches } from "../security.ts";
import { Signaling } from "../signaling.ts";
import { proofFile, snapshotFile } from "../snapshot.ts";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const KNOWLEDGE = path.join(REPO_ROOT, "knowledge");

function walk(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (ext.test(e.name)) out.push(p);
  }
  return out.sort();
}

function zodIssues(file: string, error: z.ZodError): FileIssue[] {
  return error.issues.map((i) => ({
    file,
    level: "error" as const,
    where: i.path.join(".") || "(file)",
    message: i.message,
  }));
}

export function readYaml(file: string): unknown {
  return parse(readFileSync(file, "utf8"), { uniqueKeys: true });
}

function loadDir<T>(
  dir: string,
  schema: z.ZodType<T>,
  issues: FileIssue[],
  root: string,
  ext = /\.ya?ml$/,
): Array<{ file: string; value: T }> {
  const out: Array<{ file: string; value: T }> = [];
  for (const file of walk(dir, ext)) {
    const rel = path.relative(root, file);
    let raw: unknown;
    try {
      raw = file.endsWith(".json") ? JSON.parse(readFileSync(file, "utf8")) : readYaml(file);
    } catch (e) {
      issues.push({
        file: rel,
        level: "error",
        where: "(file)",
        message: `not parseable: ${String(e)}`,
      });
      continue;
    }
    const r = schema.safeParse(raw);
    if (!r.success) issues.push(...zodIssues(rel, r.error));
    else out.push({ file: rel, value: r.data });
  }
  return out;
}

/** Snapshot manifests with their exact text (the bytes a proof commits to) and their proofs. */
function loadSnapshots(dir: string, issues: FileIssue[], root: string): StoredSnapshot[] {
  return loadDir(dir, Snapshot, issues, root, /^\d+\.json$/).flatMap(({ file, value }) => {
    const abs = path.join(root, file);
    if (path.basename(file) !== snapshotFile(value.n)) {
      issues.push({
        file,
        level: "error",
        where: "n",
        message: `the file should be ${snapshotFile(value.n)}`,
      });
      return [];
    }
    const ots = path.join(dir, proofFile(value.n));
    const stamp = path.join(dir, `${snapshotFile(value.n)}.stamp`);
    return [
      {
        manifest: value,
        text: readFileSync(abs, "utf8"),
        proof: existsSync(ots) ? new Uint8Array(readFileSync(ots)) : null,
        stamp: existsSync(stamp) ? readFileSync(stamp, "utf8") : null,
      },
    ];
  });
}

/**
 * The threat map, the watches' readings, the lab's runs, every advisory read with its NVD records,
 * and the owner's advisory map (knowledge/security/).
 */
function loadSecurity(dir: string, issues: FileIssue[], root: string): SecurityStore {
  const threats = loadDir(path.join(dir, "threats"), Threat, issues, root);
  for (const { file, value } of threats)
    if (path.basename(file, ".yaml") !== value.id)
      issues.push({ file, level: "error", where: "id", message: "file name and id differ" });
  const json = <T>(name: string, schema: z.ZodType<T>): T | null => {
    const file = path.join(dir, name);
    if (!existsSync(file)) return null;
    const r = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (r.success) return r.data;
    issues.push(...zodIssues(path.relative(root, file), r.error));
    return null;
  };
  const mapFile = path.join(dir, "advisory-map.yaml");
  let advisoryMap: AdvisoryMap | null = null;
  if (existsSync(mapFile)) {
    const r = AdvisoryMap.safeParse(readYaml(mapFile));
    if (r.success) advisoryMap = r.data;
    else issues.push(...zodIssues(path.relative(root, mapFile), r.error));
  }
  return {
    threats: threats.map((t) => t.value),
    watches: json("watches.json", Watches),
    lab: json("lab.json", Lab),
    advisories: json("advisories.json", AdvisoryLog),
    advisoryMap,
  };
}

/** The OrangeCheck records (ORANGECHECK.md), each file named by its id. */
function loadOrangecheck(dir: string, issues: FileIssue[], root: string): OcRecords {
  const named = <T>(sub: string, schema: z.ZodType<T>, id: (v: T) => string): T[] =>
    loadDir(path.join(dir, sub), schema, issues, root, /\.json$/).flatMap(({ file, value }) => {
      if (path.basename(file, ".json") === id(value)) return [value];
      issues.push({ file, level: "error", where: "id", message: "file name and id differ" });
      return [];
    });
  return {
    attestations: named("attestations", AttestationRecordSchema, (a) => a.attestation_id),
    delegations: named("delegations", DelegationEnvelopeSchema, (d) => d.id),
    revocations: named("revocations", RevocationEnvelopeSchema, (r) => r.id),
  } as OcRecords;
}

/** Loads the store under `knowledge` and checks that each file sits where its id says. */
export function loadStore(knowledge = KNOWLEDGE): { store: Store; issues: FileIssue[] } {
  const issues: FileIssue[] = [];
  const root = path.dirname(knowledge);
  const claims = loadDir(path.join(knowledge, "claims"), Claim, issues, root);
  for (const { file, value } of claims) {
    const want = path.join("knowledge", "claims", value.topics[0] as string, `${value.id}.yaml`);
    if (file !== want)
      issues.push({ file, level: "error", where: "id", message: `belongs at ${want}` });
  }
  const topics = loadDir(path.join(knowledge, "topics"), Topic, issues, root);
  for (const { file, value } of topics)
    if (path.basename(file, ".yaml") !== value.slug)
      issues.push({ file, level: "error", where: "slug", message: "file name and slug differ" });
  const debates = loadDir(path.join(knowledge, "debates"), Debate, issues, root);
  for (const { file, value } of debates)
    if (path.basename(file, ".yaml") !== value.slug)
      issues.push({ file, level: "error", where: "slug", message: "file name and slug differ" });
  const reviewFile = path.join(knowledge, "review-queue.json");
  const review: ReviewCount[] = [];
  if (existsSync(reviewFile)) {
    const r = ReviewCount.array().safeParse(JSON.parse(readFileSync(reviewFile, "utf8")));
    if (r.success) review.push(...r.data);
    else issues.push(...zodIssues("knowledge/review-queue.json", r.error));
  }
  const bipsFile = path.join(knowledge, "bips.json");
  let bips: BipIndex | null = null;
  if (existsSync(bipsFile)) {
    const r = BipIndex.safeParse(JSON.parse(readFileSync(bipsFile, "utf8")));
    if (r.success) bips = r.data;
    else issues.push(...zodIssues("knowledge/bips.json", r.error));
  }
  const coreBipsFile = path.join(knowledge, "core-bips.json");
  let coreBips: CoreBips | null = null;
  if (existsSync(coreBipsFile)) {
    const r = CoreBips.safeParse(JSON.parse(readFileSync(coreBipsFile, "utf8")));
    if (r.success) coreBips = r.data;
    else issues.push(...zodIssues("knowledge/core-bips.json", r.error));
  }
  const wireFile = path.join(knowledge, "wire.json");
  let wire: Wire | null = null;
  if (existsSync(wireFile)) {
    const r = Wire.safeParse(JSON.parse(readFileSync(wireFile, "utf8")));
    if (r.success) wire = r.data;
    else issues.push(...zodIssues("knowledge/wire.json", r.error));
  }
  const rechecksFile = path.join(knowledge, "rechecks.json");
  let rechecks: Rechecks = {};
  if (existsSync(rechecksFile)) {
    const r = Rechecks.safeParse(JSON.parse(readFileSync(rechecksFile, "utf8")));
    if (r.success) rechecks = r.data;
    else issues.push(...zodIssues("knowledge/rechecks.json", r.error));
  }
  const benchFile = path.join(knowledge, "bench.json");
  let scorecard: Scorecard | null = null;
  if (existsSync(benchFile)) {
    const r = Scorecard.safeParse(JSON.parse(readFileSync(benchFile, "utf8")));
    if (r.success) scorecard = r.data;
    else issues.push(...zodIssues("knowledge/bench.json", r.error));
  }
  const nostrFile = path.join(knowledge, "nostr.json");
  let nostr: NostrChannel | null = null;
  if (existsSync(nostrFile)) {
    const r = NostrChannel.safeParse(JSON.parse(readFileSync(nostrFile, "utf8")));
    if (r.success) nostr = r.data;
    else issues.push(...zodIssues("knowledge/nostr.json", r.error));
  }
  const signalingFile = path.join(knowledge, "chain", "signaling.json");
  let signaling: Signaling | null = null;
  if (existsSync(signalingFile)) {
    const r = Signaling.safeParse(JSON.parse(readFileSync(signalingFile, "utf8")));
    if (r.success) signaling = r.data;
    else issues.push(...zodIssues("knowledge/chain/signaling.json", r.error));
  }
  const evaluatorFile = path.join(knowledge, "evaluator.json");
  let evaluator: EvaluatorRecord | null = null;
  if (existsSync(evaluatorFile)) {
    const r = EvaluatorRecord.safeParse(JSON.parse(readFileSync(evaluatorFile, "utf8")));
    if (r.success) evaluator = r.data;
    else issues.push(...zodIssues("knowledge/evaluator.json", r.error));
  }
  return {
    store: {
      security: loadSecurity(path.join(knowledge, "security"), issues, root),
      wire,
      rechecks,
      scorecard,
      evaluator,
      bips,
      coreBips,
      claims: claims.map((c) => c.value),
      topics: topics.map((t) => t.value),
      proposals: loadDir(path.join(knowledge, "proposals"), Proposal, issues, root).map(
        (p) => p.value,
      ),
      debates: debates.map((d) => d.value),
      runs: loadDir(path.join(knowledge, "runs"), Run, issues, root).map((r) => r.value),
      snapshots: loadSnapshots(path.join(knowledge, "snapshots"), issues, root),
      orangecheck: loadOrangecheck(path.join(knowledge, "orangecheck"), issues, root),
      nostr,
      signaling,
      review,
    },
    issues,
  };
}
