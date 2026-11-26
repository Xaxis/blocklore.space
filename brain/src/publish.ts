// The publisher (ARCHITECTURE.md, "Data flow of one claim", step 5): deterministic code, never a
// model. It takes what a run proposed and the verifier accepted, re-runs every check, sends gated
// claims to the evaluator's queue (var/review/), gives the rest their history, recompiles the whole
// store and only then writes and commits. Any compile error, and any claim that is one of the
// evaluator's test claims (canaries), leaves the store untouched. Every commit also decides debate
// maps (brain/src/debates.ts): a run's, and those waiting for their claims to clear the evaluator.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Claim,
  canonicalJson,
  compile,
  embargoReasons,
  type GateTopic,
  gateReasons,
  type ReviewCount,
  type Run,
  type Stamp,
  type Store,
  type Topic,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { recordAnswers, runAnswers } from "./answers.ts";
import { canaryClash } from "./canary.ts";
import { type ChainSource, chainSource } from "./chain.ts";
import { checkClaim } from "./check.ts";
import {
  type DebateOffer,
  debatePath,
  debateYaml,
  readWaitingDebates,
  removeWaitingDebate,
  type Settlement,
  settleDebates,
  settlementLines,
  settleWaiting,
  withDebates,
  writeWaitingDebate,
} from "./debates.ts";
import { KNOWLEDGE, ROOT } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { disclosureContext, holdCandidate, publicNotes } from "./security/gate.ts";
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
  if (old.status === "withdrawn")
    return {
      claim: old,
      changed: false,
      error: "the owner withdrew this claim; a new claim takes a new id",
    };
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

/**
 * Rebuilds every public topic from the stored layouts (or the topic's file when it has none) and
 * the current claims: a claim the owner withdrew drops out of every topic.
 */
export function publicTopics(store: Store, claims: Map<string, Claim>, policy: Policy): Topic[] {
  const byslug = new Map(store.topics.map((t) => [t.slug, t]));
  const published = new Set(
    [...claims.values()].filter((c) => c.status !== "withdrawn").map((c) => c.id),
  );
  for (const layout of readLayouts()) byslug.set(layout.slug, layout);
  return [...byslug.values()].flatMap((t) => publicTopic(t, published, policy) ?? []);
}

export interface Outcome {
  store: Store;
  claims: Map<string, Claim>;
  writeClaims: Claim[];
  extraFiles: Array<[string, string]>;
  message: string;
  /**
   * The debates this commit decides (a research run's, with those waiting). Left out, the debates
   * waiting in var/review/debates/ are tried again against the store being committed.
   */
  debates?: Settlement;
}

/** Compiles the would-be store; writes and commits only when it has no errors. */
export function commitStore(
  o: Outcome,
  now: Stamp,
  opts: { commit: boolean; push: boolean },
): number {
  // A canary is a deliberately false claim: recognised here, before anything is written.
  const canaries = canaryClash(o.writeClaims);
  if (canaries.length > 0) {
    for (const c of canaries) console.error(`refused  ${c}`);
    console.error("publish: a test claim (canary) reached the publisher; nothing written");
    return 1;
  }
  const debates = o.debates ?? settleWaiting(o.store);
  const store: Store = { ...o.store, debates: withDebates(o.store.debates, debates.publish) };
  const { issues } = compile(store, now);
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
    const f = path.join(KNOWLEDGE, "topics", `${t.slug}.yaml`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, topicYaml(t));
    written.push(f);
  }
  const queue = path.join(KNOWLEDGE, "review-queue.json");
  writeFileSync(queue, `${JSON.stringify(o.store.review, null, 2)}\n`);
  written.push(queue);
  for (const [f, body] of o.extraFiles) {
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, body);
    written.push(f);
  }
  for (const d of debates.publish) {
    const f = debatePath(d.slug);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, debateYaml(d));
    written.push(f);
  }
  // The waiting debates live beside the waiting claims, never in the public repository.
  for (const w of debates.wait) writeWaitingDebate(w);
  for (const slug of debates.settled) removeWaitingDebate(slug);
  for (const line of settlementLines(debates)) console.log(line);
  const shown = debates.publish.map((d) => d.slug);
  const message = shown.length
    ? `${o.message} It also publishes the debate map${shown.length > 1 ? "s" : ""} ${shown.join(", ")}: every claim in ${shown.length > 1 ? "each" : "it"} is published, and ${shown.length > 1 ? "each keeps" : "it keeps"} every debate rule.`
    : o.message;
  console.log(message);
  if (!opts.commit) return 0;
  if (
    !commitAsOwner(
      written.map((f) => path.relative(ROOT, f)),
      message,
      opts.push,
    )
  )
    console.log("publish: nothing changed");
  return 0;
}

const SENSITIVE = (c: Candidate, reasons: string[]) => reasons.length > 0 || c.people.length > 0;

export async function publish(
  runId: string,
  opts: { commit: boolean; push: boolean },
  chain: ChainSource = chainSource(),
) {
  if (runId.includes("-evaluate-")) {
    console.error(`publish: ${runId} is an evaluation batch; only the evaluator applies one`);
    return 1;
  }
  const run = loadRun(runId);
  const policy = loadPolicy();
  const now = await nowStamp(chain);
  const { store, issues } = loadStore(KNOWLEDGE);
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
  const open: string[] = [];

  const slugs = new Set([...store.topics.map((t) => t.slug), ...Object.keys(policy.topics)]);
  const known = new Set(slugs);
  for (const f of run.candidates) for (const t of f.value?.topics ?? []) slugs.add(t);
  const flags = gateTopics(policy, slugs);
  const disclosure = disclosureContext(store);
  let held = 0;

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
    // The disclosure gate comes first: a held finding leaves no public trace (security/gate.ts).
    const embargo = [f.value, ...(v?.verdict === "revise" && v.revised ? [v.revised] : [])].flatMap(
      (c) => embargoReasons(c, disclosure),
    );
    if (embargo.length) {
      held++;
      await holdCandidate({
        candidate: f.value,
        reasons: [...new Set(embargo)],
        verdict: v,
        runId,
        now,
        chain,
        updates: claims.has(f.value.id),
      });
      continue;
    }
    const reasons0 = gateReasons(f.value, flags, policy.contested_terms);
    const shown = (c: Candidate) =>
      SENSITIVE(c, reasons0) ? `(${c.id}: withheld, it touches a gated subject)` : c.statement;
    if (!v) {
      open.push(`${f.value.id} was proposed but not verified in this run`);
      continue;
    }
    if (canaryClash([f.value]).length > 0) {
      rejected.push({
        statement: shown(f.value),
        reason: "it matches one of the evaluator's test claims",
      });
      continue;
    }
    if (v.verdict === "reject") {
      rejected.push({ statement: shown(f.value), reason: `verifier: ${v.reason}` });
      continue;
    }
    const proposed = v.verdict === "revise" ? v.revised : f.value;
    // Further topics are kept only when the owner's policy or the store knows them; a guessed slug
    // is dropped before the claim is first written.
    const final = proposed && {
      ...proposed,
      topics: proposed.topics.filter((t, i) => i === 0 || known.has(t)),
    };
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
    // Related topics are kept only when the owner's policy knows them; the rest are guesses.
    const related = f.value.related?.filter((r) => r in policy.topics && r !== f.value?.slug);
    writeLayout({ ...f.value, related, contested: fl.contested, safety: fl.safety });
  }

  // Debate maps: decided below against the store as this run leaves it. A debate is always on a
  // contested topic, so the log names it by slug and its rules, never its words.
  const offered: DebateOffer[] = [];
  for (const f of run.debates) {
    const name = path.basename(f.file, ".yaml");
    if (!f.value || f.value.slug !== name) {
      rejected.push({
        statement: `(debate ${name}: withheld, it touches a gated subject)`,
        reason: f.value
          ? `the file must be named ${f.value.slug}.yaml`
          : `not a valid debate: ${f.errors.slice(0, 3).join("; ")}`,
      });
      continue;
    }
    offered.push({ debate: f.value, run: runId, proposed: now });
  }

  const allPending = readPending();
  // A link may point at a published claim or one waiting for review (it lights up when approved);
  // a link to a claim that exists nowhere is dropped before it is written.
  const linkable = new Set([...claims.keys(), ...allPending.map((p) => p.candidate.id)]);
  for (const [i, c] of writeClaims.entries()) {
    const kept = c.related?.filter((r) => linkable.has(r));
    if (kept?.length === c.related?.length) continue;
    const dropped = (c.related ?? []).filter((r) => !linkable.has(r));
    console.log(`publish: ${c.id} drops links to ${dropped.join(", ")}: no such claim`);
    const fixed = { ...c, related: kept?.length ? kept : undefined };
    writeClaims[i] = fixed;
    claims.set(c.id, fixed);
  }
  const newStore: Store = {
    ...store,
    claims: [...claims.values()],
    topics: publicTopics(store, claims, policy),
    review: reviewCounts(allPending),
  };
  const debates = settleDebates({
    store: newStore,
    pending: allPending,
    layouts: readLayouts(),
    policy,
    offered,
    waiting: readWaitingDebates(),
    canaries: (c) => canaryClash(c),
  });
  for (const x of debates.drop.filter((x) => x.run === runId))
    rejected.push({
      statement: `(debate ${x.slug}: withheld, it touches a gated subject)`,
      reason:
        x.rules[0] === "test claim"
          ? "it is built on one of the evaluator's test claims"
          : `it breaks the debate rules: ${x.rules.join(", ")}`,
    });
  for (const w of debates.wait.filter((w) => w.run === runId))
    open.push(
      `debate ${w.debate.slug} waits for ${w.waiting.length} of its claims to pass the evaluator`,
    );
  if (run.notes.errors.length)
    console.warn(
      `publish: run.yaml did not parse, so the log keeps no notes for this run: ${run.notes.errors.slice(0, 3).join("; ")}`,
    );
  const notes = publicNotes(run.notes.value, disclosure, held);
  for (const s of notes.skipped)
    rejected.push({ statement: s.statement, reason: `research: ${s.reason}` });

  const log: Run = {
    id: runId,
    kind: runId.includes("seed") ? "seed" : runId.includes("queue") ? "queue" : "daily",
    started: run.meta?.started ?? now,
    finished: now,
    agent: run.meta?.agent ?? "unknown agent",
    summary: notes.summary,
    read: notes.read,
    published,
    revised,
    rejected,
    gated: [...gatedByTopic].map(([topic, g]) => ({
      topic,
      count: g.count,
      reasons: [...g.reasons],
    })),
    open: [...notes.open, ...open],
    injections: notes.injections,
    ...(run.meta?.asked?.length ? { asked: run.meta.asked } : {}),
  };
  const logFile = path.join(KNOWLEDGE, "runs", runId.slice(0, 4), `${runId}.yaml`);
  const gated = [...gatedByTopic.values()].reduce((n, g) => n + g.count, 0);
  const message = `Publish what run ${runId} verified: ${published.length} new, ${revised.length} revised, ${gated} held for review, ${rejected.length} rejected.`;
  const code = commitStore(
    {
      store: newStore,
      claims,
      writeClaims,
      extraFiles: [[logFile, toYaml(log)]],
      message,
      debates,
    },
    now,
    opts,
  );
  // Which claims answer the reader questions the task carried, kept privately until they publish
  // (brain/src/answers.ts): only questions the task carried and claims now published or waiting.
  if (code === 0)
    recordAnswers(runAnswers(run.notes.value?.answers ?? [], run.meta?.asked ?? [], linkable));
  return code;
}
