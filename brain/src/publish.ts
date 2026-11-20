// The publisher (ARCHITECTURE.md, "Data flow of one claim", step 5): deterministic code, never a
// model. It takes what a run proposed and the verifier accepted, re-runs every check, sends gated
// claims to the owner's private queue, gives the rest their history, recompiles the whole store and
// only then writes and commits. Any compile error leaves the store untouched.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Claim,
  canonicalJson,
  compile,
  type GateTopic,
  gateReasons,
  type ReviewCount,
  type Run,
  type Stamp,
  type Store,
  type Topic,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { type ChainSource, chainSource } from "./chain.ts";
import { checkClaim } from "./check.ts";
import { ROOT } from "./env.ts";
import { type Candidate, loadRun } from "./staging.ts";
import {
  claimPath,
  claimYaml,
  loadPolicy,
  nowStamp,
  type Pending,
  type Policy,
  policyFlags,
  publicTopic,
  readLayouts,
  readPending,
  removePending,
  topicYaml,
  toYaml,
  writeLayout,
  writePending,
} from "./store.ts";

const REVISABLE = [
  "statement",
  "kind",
  "depth",
  "status",
  "confidence",
  "topics",
  "sources",
  "checks",
  "people",
  "superseded_by",
] as const;

function contentOf(c: Candidate): Omit<Candidate, "change" | "note"> {
  const { change: _c, note: _n, ...rest } = c;
  return rest;
}

export function createClaim(
  c: Candidate,
  now: Stamp,
  run: string,
  method: string,
  review?: Claim["review"],
): Claim {
  return {
    ...contentOf(c),
    first_seen: now,
    last_verified: { ...now, run, method },
    run,
    ...(review ? { review } : {}),
    revisions: [{ rev: 1, at: now, run, change: "created" }],
  };
}

/** A new revision of a published claim, or only a fresh last_verified when nothing changed. */
export function updateClaim(
  old: Claim,
  c: Candidate,
  now: Stamp,
  run: string,
  method: string,
  review?: Claim["review"],
): { claim: Claim; changed: boolean; error?: string } {
  const before: Record<string, unknown> = {};
  for (const f of REVISABLE)
    if (canonicalJson(old[f] ?? null) !== canonicalJson((c as Record<string, unknown>)[f] ?? null))
      before[f] = old[f] ?? null;
  const last_verified = { ...now, run, method };
  if (Object.keys(before).length === 0) return { claim: { ...old, last_verified }, changed: false };
  if (!c.change || !c.note)
    return {
      claim: old,
      changed: false,
      error: "a change to a published claim needs `change` and `note`",
    };
  const rev = old.revisions.length + 1;
  return {
    claim: {
      ...old,
      ...contentOf(c),
      first_seen: old.first_seen,
      last_verified,
      run,
      ...(review ? { review } : {}),
      revisions: [...old.revisions, { rev, at: now, run, change: c.change, note: c.note, before }],
    },
    changed: true,
  };
}

/** Topics whose flags come from the owner's policy, never from a run. */
export function gateTopics(policy: Policy, slugs: Iterable<string>): Map<string, GateTopic> {
  return new Map([...slugs].map((s) => [s, policyFlags(policy, s)]));
}

export function reviewCounts(pending: Pending[]): ReviewCount[] {
  const counts = new Map<string, number>();
  for (const p of pending) {
    const t = p.candidate.topics[0] as string;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, count]) => ({ topic, count }));
}

/** Rebuilds every public topic from the stored layouts and the published claims. */
export function publicTopics(store: Store, claims: Map<string, Claim>, policy: Policy): Topic[] {
  const byslug = new Map(store.topics.map((t) => [t.slug, t]));
  const published = new Set(claims.keys());
  for (const layout of readLayouts()) {
    const t = publicTopic(layout, published, policy);
    if (t) byslug.set(t.slug, t);
    else byslug.delete(layout.slug);
  }
  return [...byslug.values()];
}

export interface Outcome {
  store: Store;
  claims: Map<string, Claim>;
  writeClaims: Claim[];
  extraFiles: Array<[string, string]>;
  message: string;
}

/** Compiles the would-be store; writes and commits only when it has no errors. */
export function commitStore(
  o: Outcome,
  now: Stamp,
  opts: { commit: boolean; push: boolean },
): number {
  const { issues } = compile(o.store, now);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    for (const e of errors) console.error(`error  ${e.file}  ${e.where}: ${e.message}`);
    console.error(`publish: ${errors.length} compile errors; nothing written`);
    return 1;
  }
  const written: string[] = [];
  for (const c of o.writeClaims) {
    const f = claimPath(c);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, claimYaml(c));
    written.push(f);
  }
  for (const t of o.store.topics) {
    const f = path.join(ROOT, "knowledge", "topics", `${t.slug}.yaml`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, topicYaml(t));
    written.push(f);
  }
  const queue = path.join(ROOT, "knowledge", "review-queue.json");
  writeFileSync(queue, `${JSON.stringify(o.store.review, null, 2)}\n`);
  written.push(queue);
  for (const [f, body] of o.extraFiles) {
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, body);
    written.push(f);
  }
  console.log(o.message);
  if (!opts.commit) return 0;
  const rel = written.map((f) => path.relative(ROOT, f));
  execFileSync("git", ["add", "--", ...rel], { cwd: ROOT });
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--", ...rel], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (!staged) {
    console.log("publish: nothing changed");
    return 0;
  }
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Xaxis",
      "-c",
      "user.email=william.neeley@gmail.com",
      "commit",
      "-q",
      "-m",
      o.message,
      "--",
      ...rel,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (opts.push)
    execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: ROOT, stdio: "inherit" });
  return 0;
}

const SENSITIVE = (c: Candidate, reasons: string[]) => reasons.length > 0 || c.people.length > 0;

export async function publish(
  runId: string,
  opts: { commit: boolean; push: boolean },
  chain: ChainSource = chainSource(),
) {
  const run = loadRun(runId);
  const policy = loadPolicy();
  const now = await nowStamp(chain);
  const { store, issues } = loadStore();
  const loadErrors = issues.filter((i) => i.level === "error");
  if (loadErrors.length) {
    for (const e of loadErrors) console.error(`error  ${e.file}  ${e.where}: ${e.message}`);
    return 1;
  }
  const claims = new Map(store.claims.map((c) => [c.id, c]));
  const verdicts = new Map(
    run.verdicts.flatMap((v) => (v.value ? [[v.value.id, v.value] as const] : [])),
  );
  const pending = new Map(readPending().map((p) => [p.candidate.id, p]));

  const published: string[] = [];
  const revised: Run["revised"] = [];
  const rejected: Run["rejected"] = [];
  const gatedByTopic = new Map<string, { count: number; reasons: Set<string> }>();
  const writeClaims: Claim[] = [];
  const open: string[] = [...(run.notes.value?.open ?? [])];

  const slugs = new Set([...store.topics.map((t) => t.slug), ...Object.keys(policy.topics)]);
  for (const f of run.candidates) for (const t of f.value?.topics ?? []) slugs.add(t);
  const flags = gateTopics(policy, slugs);

  for (const f of run.candidates) {
    const name = path.basename(f.file, ".yaml");
    if (!f.value) {
      rejected.push({
        statement: `(${name}: not a valid candidate)`,
        reason: f.errors.slice(0, 3).join("; "),
      });
      continue;
    }
    const v = verdicts.get(f.value.id);
    const reasons0 = gateReasons(f.value, flags, policy.contested_terms);
    const shown = (c: Candidate) =>
      SENSITIVE(c, reasons0) ? `(${c.id}: withheld, it touches a gated subject)` : c.statement;
    if (!v) {
      open.push(`${f.value.id} was proposed but not verified in this run`);
      continue;
    }
    if (v.verdict === "reject") {
      rejected.push({ statement: shown(f.value), reason: `verifier: ${v.reason}` });
      continue;
    }
    const final = v.verdict === "revise" ? v.revised : f.value;
    if (!final || final.id !== f.value.id) {
      rejected.push({
        statement: shown(f.value),
        reason: "the verifier asked for a revision but gave none for this id",
      });
      continue;
    }
    const report = await checkClaim(final, chain);
    if (!report.ok) {
      const why = [
        ...report.issues.filter((i) => i.level === "error").map((i) => `${i.where}: ${i.message}`),
        ...report.sources.filter((s) => !s.ok).map((s) => `source ${s.index}: ${s.error}`),
        ...report.checks.filter((k) => !k.ok).map((k) => `check ${k.index}: ${k.detail}`),
      ];
      rejected.push({
        statement: shown(final),
        reason: `checks failed: ${why.slice(0, 3).join("; ")}`,
      });
      continue;
    }
    const reasons = gateReasons(final, flags, policy.contested_terms);
    const existing = claims.get(final.id);
    if (reasons.length > 0) {
      writePending({
        candidate: final,
        reasons,
        run: runId,
        proposed: now,
        verdict: v,
        method: report.method,
        updates: !!existing,
      });
      const topic = final.topics[0] as string;
      const g = gatedByTopic.get(topic) ?? { count: 0, reasons: new Set<string>() };
      g.count++;
      for (const r of reasons) g.reasons.add(r.replace(/: .*/, ""));
      gatedByTopic.set(topic, g);
      continue;
    }
    if (pending.has(final.id)) removePending(final.id);
    if (existing) {
      const u = updateClaim(existing, final, now, runId, report.method);
      if (u.error) {
        rejected.push({ statement: shown(final), reason: u.error });
        continue;
      }
      claims.set(final.id, u.claim);
      writeClaims.push(u.claim);
      if (u.changed)
        revised.push({ id: final.id, change: final.change ?? "refined", note: final.note ?? "" });
    } else {
      const c = createClaim(final, now, runId, report.method);
      claims.set(c.id, c);
      writeClaims.push(c);
      published.push(c.id);
    }
  }

  for (const f of run.topics) {
    if (!f.value) {
      open.push(
        `topic layout ${path.basename(f.file)} was not valid: ${f.errors.slice(0, 2).join("; ")}`,
      );
      continue;
    }
    const fl = policyFlags(policy, f.value.slug);
    writeLayout({ ...f.value, contested: fl.contested, safety: fl.safety });
  }

  const allPending = readPending();
  const newStore: Store = {
    ...store,
    claims: [...claims.values()],
    topics: publicTopics(store, claims, policy),
    review: reviewCounts(allPending),
  };
  for (const s of run.notes.value?.skipped ?? [])
    rejected.push({ statement: s.statement, reason: `research: ${s.reason}` });

  const notes = run.notes.value;
  const log: Run = {
    id: runId,
    kind: runId.includes("seed") ? "seed" : runId.includes("queue") ? "queue" : "daily",
    started: run.meta?.started ?? now,
    finished: now,
    agent: run.meta?.agent ?? "unknown agent",
    summary: notes?.summary ?? "The run left no notes.",
    read: notes?.read ?? [],
    published,
    revised,
    rejected,
    gated: [...gatedByTopic].map(([topic, g]) => ({
      topic,
      count: g.count,
      reasons: [...g.reasons],
    })),
    open,
    injections: notes?.injections ?? [],
  };
  const logFile = path.join(ROOT, "knowledge", "runs", runId.slice(0, 4), `${runId}.yaml`);
  const gated = [...gatedByTopic.values()].reduce((n, g) => n + g.count, 0);
  const message = `Publish what run ${runId} verified: ${published.length} new, ${revised.length} revised, ${gated} held for review, ${rejected.length} rejected.`;
  return commitStore(
    { store: newStore, claims, writeClaims, extraFiles: [[logFile, toYaml(log)]], message },
    now,
    opts,
  );
}
