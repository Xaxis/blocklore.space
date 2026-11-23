// The evaluator (EDITORIAL.md, "The evaluator"): it decides by itself which gated claims publish,
// and it checks itself. One batch takes the claims waiting in var/review/ that are due, mixes in
// blind test claims (canaries), and runs the ensemble on every one:
//
//   recheck      brain check again, now: every quote found at its URL, locators, code and chain
//   rules        the structural rules each gate reason calls for (core/src/evaluate.ts)
//   verifier a   the owner-reviewed verifier role (brain/prompts/verifier.md, unchanged), in a fresh
//   verifier b   run folder each, knowing nothing of the other, on two models; both must accept
//
// It fails closed: a failed stage rejects, a stage that could not run holds, and a claim publishes
// only when every stage passed and the canaries keep being caught (the calibration). Applying a
// batch is deterministic code under the tick lock, and canaries never reach it: the batch file it
// reads holds real claims only, and the publisher refuses any registered canary besides.
//
//   var/evaluator/decisions.jsonl   every decision with every stage's reason (private: statements)
//   var/evaluator/outcomes.jsonl    one short line per decision, for the counts and calibration
//   var/evaluator/canaries.jsonl    every canary ever made (canary.ts)
//   var/evaluator/cases.jsonl       claims the owner revoked, as they were: canary material
//   var/evaluator/batches/<id>.json what a batch decided for real claims; apply reads it
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type ActionEnvelope,
  type Authority,
  batchPublishing,
  type CanaryResult,
  type Claim,
  type ClaimContent,
  calibration,
  canonicalJson,
  claimHash,
  contentOf,
  type Decision,
  decide,
  EMPTY_RECORDS,
  type EvaluatorRecord,
  type EvaluatorView,
  embargoReasons,
  gate,
  MIN_CANARIES,
  type Mutation,
  makeCanaries,
  type Outcome,
  type Review,
  type Run,
  type Stage,
  type Stamp,
  type StampEnvelope,
  type Store,
  scrutinyOf,
  sha256Hex,
  structuralRules,
  verdictStage,
} from "@blocklore/core";
import { candidateHash, type Settings } from "@blocklore/core/control";
import type { FeedEvent } from "@blocklore/core/feed";
import { loadStore } from "@blocklore/core/node";
import { prepareContext, type RunResult, runRole } from "./agent.ts";
import { canaryEntries, registerCanaries } from "./canary.ts";
import type { ClaimReport } from "./check.ts";
import { EVALUATOR_DIR, KNOWLEDGE } from "./env.ts";
import { feedEvent } from "./feed.ts";
import { type Publisher, publisherFrom, publishPending, stampJson } from "./orangecheck.ts";
import {
  commitStore,
  createClaim,
  gateTopics,
  publicTopics,
  reviewCounts,
  updateClaim,
} from "./publish.ts";
import { disclosureContext, holdPending, RELEASED } from "./security/gate.ts";
import { type Candidate, loadRun, runDir, type Verdict } from "./staging.ts";
import {
  claimYaml,
  loadPolicy,
  type Pending,
  readPending,
  removePending,
  toYaml,
  writePending,
} from "./store.ts";

/** The same task the research pipeline gives its verifier, word for word. */
export const VERIFY_TASK =
  "Verify every candidate in claims/ as your instructions describe, using checks.json for what code already confirmed. Write one verdict per candidate to verdicts/<id>.yaml.";

export const WAITING =
  "waiting for the subscription token: the evaluator runs its verifiers on the owner's Claude subscription, and CLAUDE_CODE_OAUTH_TOKEN is not in .env yet (claude setup-token makes one)";

/** A held claim is tried again after this long. */
const HOLD_RETRY_MS = 12 * 3600_000;

/** Whether the model steps can run: the owner's subscription token is on the devbox. */
export function modelReady(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.CLAUDE_CODE_OAUTH_TOKEN;
}

/** The two verifier models: the research model and the other of opus and sonnet. */
export function verifierModels(s: Settings): [string, string] {
  const a = s.research.model;
  return [a, a === "opus" ? "sonnet" : "opus"];
}

// --- files -------------------------------------------------------------------------------------

function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

function appendLines(file: string, values: unknown[]) {
  if (values.length === 0) return;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${values.map((v) => JSON.stringify(v)).join("\n")}\n`, { mode: 0o600 });
}

/** The newest `bytes` of a JSON-lines file, whole lines only. */
function tailLines<T>(file: string, bytes = 512 * 1024): T[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const text = readFileSync(file)
    .subarray(Math.max(0, size - bytes))
    .toString("utf8");
  const from = size > bytes ? text.indexOf("\n") + 1 : 0;
  return text
    .slice(from)
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

/** The short line kept for every decision. */
export interface OutcomeLine {
  at: string;
  batch: string;
  id: string;
  hash: string;
  topic: string;
  canary: string | null;
  raw: Outcome;
  outcome: Outcome;
  /** The stage that stopped it, or "calibration"; null when it published. */
  stopped: string | null;
}

export interface BatchItem {
  id: string;
  hash: string;
  topic: string;
  outcome: Outcome;
  /** What the public run log may say: the stage and rule names, never a model's words. */
  public: string;
  method: string;
  review: Extract<Review, { by: "evaluator" }> | null;
}

export interface BatchFile {
  id: string;
  at: Stamp;
  models: [string, string];
  publishing: { allowed: boolean; why: string | null };
  items: BatchItem[];
}

/**
 * A decision's signature by the publisher key (ORANGECHECK.md), kept beside decisions.jsonl. The
 * envelope covers the decision line exactly as recorded (RFC 8785 JSON); `authority` says whether
 * the owner's delegation was in force when it was signed.
 */
export interface SignedDecision {
  batch: string;
  id: string;
  envelope: StampEnvelope | ActionEnvelope;
  authority: Authority["state"];
}

export interface RevokedCase {
  id: string;
  at: string;
  reason: string;
  claim: ClaimContent;
}

export function evaluatorFiles(dir = EVALUATOR_DIR) {
  const f = (n: string) => path.join(dir, n);
  return {
    dir,
    /** The newest decisions, about the last 512 KB unless `bytes` asks for more. */
    decisions: (bytes?: number) => tailLines<Decision>(f("decisions.jsonl"), bytes),
    outcomes: () => readLines<OutcomeLine>(f("outcomes.jsonl")),
    cases: () => readLines<RevokedCase>(f("cases.jsonl")),
    addCase: (c: RevokedCase) => appendLines(f("cases.jsonl"), [c]),
    signatures: () => tailLines<SignedDecision>(f("signatures.jsonl")),
    sign: (s: SignedDecision[]) => appendLines(f("signatures.jsonl"), s),
    record(decisions: Decision[]) {
      appendLines(f("decisions.jsonl"), decisions);
      appendLines(
        f("outcomes.jsonl"),
        decisions.map((d) => outcomeLine(d)),
      );
    },
    batchFile: (id: string) => path.join(dir, "batches", `${id}.json`),
    readBatch(id: string): BatchFile {
      if (!/^\d{4}-\d{2}-\d{2}-evaluate-[a-z0-9-]+$/.test(id))
        throw new Error(`not a batch id: ${id}`);
      return JSON.parse(readFileSync(path.join(dir, "batches", `${id}.json`), "utf8")) as BatchFile;
    },
    writeBatch(b: BatchFile) {
      mkdirSync(path.join(dir, "batches"), { recursive: true, mode: 0o700 });
      writeFileSync(path.join(dir, "batches", `${b.id}.json`), `${JSON.stringify(b, null, 2)}\n`, {
        mode: 0o600,
      });
    },
    lastBatch(): BatchFile | null {
      const d = path.join(dir, "batches");
      if (!existsSync(d)) return null;
      const last = readdirSync(d)
        .filter((x) => x.endsWith(".json"))
        .map((x) => ({ x, t: statSync(path.join(d, x)).mtimeMs }))
        .sort((a, b) => a.t - b.t)
        .pop();
      return last ? (JSON.parse(readFileSync(path.join(d, last.x), "utf8")) as BatchFile) : null;
    },
  };
}
export type EvaluatorFiles = ReturnType<typeof evaluatorFiles>;

function outcomeLine(d: Decision): OutcomeLine {
  const stopper = d.stages.find((s) => s.ok === false) ?? d.stages.find((s) => s.ok !== true);
  return {
    at: d.at,
    batch: d.batch,
    id: d.id,
    hash: d.hash,
    topic: d.topic,
    canary: d.canary?.kind ?? null,
    raw: d.raw,
    outcome: d.outcome,
    stopped:
      d.outcome === "publish"
        ? null
        : (stopper?.stage ?? (d.raw === "publish" ? "calibration" : "unknown")),
  };
}

/** Canary results for calibration, oldest first; a canary that only held proves nothing. */
export function canaryResults(lines: readonly OutcomeLine[]): CanaryResult[] {
  return lines
    .filter((l) => l.canary && l.raw !== "hold")
    .map((l) => ({ at: l.at, kind: l.canary as string, caught: l.raw === "reject" }));
}

// --- the backlog -------------------------------------------------------------------------------

/** Waiting claims the evaluator should look at now, the never-evaluated first. */
export function dueItems(
  pending: readonly Pending[],
  lines: readonly OutcomeLine[],
  now: Date,
): Pending[] {
  const last = new Map<string, OutcomeLine>();
  for (const l of lines) if (!l.canary) last.set(`${l.id}:${l.hash}`, l);
  const scored = pending.flatMap((p) => {
    const l = last.get(`${p.candidate.id}:${candidateHash(p.candidate)}`);
    if (!l) return [{ p, order: 0, at: p.proposed.time }];
    const age = now.getTime() - Date.parse(l.at);
    // A decided claim still waiting means its batch did not apply; try again after an hour.
    const wait = l.outcome === "hold" ? HOLD_RETRY_MS : 3600_000;
    return age >= wait ? [{ p, order: 1, at: l.at }] : [];
  });
  return scored
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.at.localeCompare(b.at) ||
        a.p.candidate.id.localeCompare(b.p.candidate.id),
    )
    .map((x) => x.p);
}

// --- one batch ---------------------------------------------------------------------------------

export interface EvaluatorDeps {
  files: EvaluatorFiles;
  settings: () => Settings;
  now: () => Promise<Stamp>;
  check: (c: Candidate) => Promise<ClaimReport>;
  /** Runs the verifier role in a folder on a model; the default is runRole. */
  verify: (dir: string, task: string, model: string) => Promise<RunResult | undefined>;
  modelReady: () => boolean;
  /** The store as published now. */
  store: () => Store;
  pending: () => Pending[];
  /** A line for the admin's live feed. */
  say?: (text: string) => void;
  /** The publisher key that signs each decision; without one nothing is signed. */
  publisher?: () => Publisher | null;
}

/**
 * The disclosure gate (security/gate.ts) over the review queue, before anything is evaluated or
 * published: a claim that waited from before the gate, or that what counts as public now flags,
 * leaves the queue for the owner's embargo list. One the owner released stays.
 */
export function screenEmbargo(pending: Pending[], store: Store, at: string): Pending[] {
  const ctx = disclosureContext(store);
  return pending.filter((p) => {
    if (p.reasons.includes(RELEASED)) return true;
    const reasons = embargoReasons(p.candidate, ctx);
    if (reasons.length === 0) return true;
    holdPending(p, reasons, at);
    return false;
  });
}

/** The recheck as a stage: a quote not found or a failed check is final; an unreadable page holds. */
export function recheckStage(r: ClaimReport): Stage {
  if (r.ok) return { stage: "recheck", ok: true, detail: `found again: ${r.method}` };
  const problems = [
    ...r.issues.filter((i) => i.level === "error").map((i) => `${i.where}: ${i.message}`),
    ...r.sources
      .filter((s) => !s.ok)
      .map((s) => `source ${s.index}: ${s.error ?? "not confirmed"}`),
    ...r.checks.filter((k) => !k.ok).map((k) => `check ${k.index}: ${k.detail}`),
  ];
  const transient =
    r.issues.every((i) => i.level !== "error") &&
    r.checks.every((k) => k.ok) &&
    r.sources.every(
      (s) => s.ok || (s.error !== undefined && s.error !== "quote not found at the locator"),
    );
  return {
    stage: "recheck",
    ok: transient ? null : false,
    detail:
      `${transient ? "could not read a source now" : "no longer holds as cited"}: ${problems.slice(0, 3).join("; ")}`.slice(
        0,
        1500,
      ),
  };
}

interface Entry {
  id: string;
  candidate: Candidate;
  canary: { kind: Mutation; source: string } | null;
  pending: Pending | null;
  reasons: string[];
  stages: Stage[];
  method: string;
}

const order = (seed: string, id: string) => sha256Hex(`${seed}:order:${id}`);

/** Writes one verifier's run folder: the candidates, the check reports, the rules and context. */
function verifierFolder(
  name: string,
  entries: Entry[],
  reports: Map<string, ClaimReport>,
  store: Store,
) {
  const dir = runDir(name);
  for (const d of ["claims", "verdicts", "context/existing"])
    mkdirSync(path.join(dir, d), { recursive: true });
  prepareContext(dir);
  for (const e of entries)
    writeFileSync(path.join(dir, "claims", `${e.id}.yaml`), toYaml(e.candidate));
  writeFileSync(
    path.join(dir, "checks.json"),
    `${JSON.stringify(
      entries.map((e) => reports.get(e.id)),
      null,
      2,
    )}\n`,
  );
  // Published claims on the same topics, less the claims the canaries were made from.
  const hidden = new Set(entries.flatMap((e) => (e.canary ? [e.canary.source] : [])));
  const topics = new Set(entries.flatMap((e) => e.candidate.topics));
  for (const c of store.claims)
    if (c.status !== "withdrawn" && !hidden.has(c.id) && c.topics.some((t) => topics.has(t)))
      writeFileSync(path.join(dir, "context", "existing", `${c.id}.yaml`), claimYaml(c));
  return dir;
}

function readVerdicts(name: string): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  for (const f of loadRun(name).verdicts) if (f.value) out.set(f.value.id, f.value);
  return out;
}

export interface BatchOutcome {
  batch: string | null;
  message: string;
  decisions: Decision[];
}

/**
 * Evaluates one batch and writes its decisions and batch file; publishing is apply's job. Returns
 * without a batch when the owner decides, the token is missing, or nothing is due.
 */
export async function evaluateBatch(d: EvaluatorDeps): Promise<BatchOutcome> {
  const settings = d.settings();
  const ev = settings.evaluator;
  if (ev.decides === "owner")
    return {
      batch: null,
      message: "the owner decides gated claims; nothing was evaluated",
      decisions: [],
    };
  if (!d.modelReady()) return { batch: null, message: WAITING, decisions: [] };
  const now = await d.now();
  const lines = d.files.outcomes();
  const store = d.store();
  // The disclosure gate first: an embargoed claim is never evaluated (screenEmbargo).
  const waiting = screenEmbargo(d.pending(), store, now.time);
  const due = dueItems(waiting, lines, new Date(now.time)).slice(0, ev.batchSize);
  if (due.length === 0)
    return { batch: null, message: "nothing waits for the evaluator", decisions: [] };

  const policy = loadPolicy();
  const before = calibration(canaryResults(lines), ev);
  const seed = sha256Hex(`${now.time}:${due.map((p) => candidateHash(p.candidate)).join(",")}`);
  const batch = `${now.time.slice(0, 10)}-evaluate-${seed.slice(0, 10)}`;
  const [modelA, modelB] = verifierModels(settings);

  // Canaries: made from published claims and revoked ones, registered before anything is written.
  const current = store.claims.filter((c) => c.status !== "withdrawn");
  const taken = new Set([
    ...store.claims.map((c) => c.id),
    ...d.pending().map((p) => p.candidate.id),
    ...canaryEntries(d.files.dir).map((c) => c.id),
  ]);
  const want = Math.min(10, ev.canaries + Math.max(0, MIN_CANARIES - before.recent));
  const canaries = makeCanaries(
    seed,
    current.map(contentOf),
    d.files.cases().map((c) => c.claim),
    want,
    taken,
  );
  registerCanaries(canaries, batch, now.time, d.files.dir);

  const slugs = new Set([...store.topics.map((t) => t.slug), ...Object.keys(policy.topics)]);
  const flags = gateTopics(policy, slugs);
  const entries: Entry[] = [
    ...due.map((p) => ({
      id: p.candidate.id,
      candidate: p.candidate,
      canary: null,
      pending: p,
      reasons: [] as string[],
      stages: [] as Stage[],
      method: p.method,
    })),
    ...canaries.map((c) => ({
      id: c.id,
      candidate: c.candidate as Candidate,
      canary: { kind: c.kind, source: c.source },
      pending: null,
      reasons: [] as string[],
      stages: [] as Stage[],
      method: "",
    })),
  ].sort((a, b) => order(seed, a.id).localeCompare(order(seed, b.id)));

  d.say?.(
    `evaluating ${entries.length} candidates: recheck, rules, then two verifiers (${modelA}, ${modelB})`,
  );
  const reports = new Map<string, ClaimReport>();
  for (const e of entries) {
    for (const t of e.candidate.topics)
      if (!flags.has(t)) flags.set(t, { slug: t, contested: true, safety: false });
    const g = gate(e.candidate, flags, policy.contested_terms);
    e.reasons = g.map((r) => r.text);
    const report = await d.check(e.candidate);
    reports.set(e.id, report);
    e.method = report.method;
    e.stages.push(recheckStage(report));
    const rules = structuralRules(e.candidate, scrutinyOf(g));
    const broken = rules.filter((r) => !r.ok);
    e.stages.push({
      stage: "rules",
      ok: broken.length === 0,
      detail:
        broken.length === 0
          ? `held: ${rules.map((r) => r.rule).join(", ")}`
          : broken.map((r) => `${r.rule}: ${r.detail}`).join("; "),
    });
  }

  // Only what code passed goes to the models, in two folders that share nothing but the inputs.
  const toVerify = entries.filter((e) => e.stages.every((s) => s.ok === true));
  if (toVerify.length > 0) {
    for (const [stage, model, suffix] of [
      ["verifier-a", modelA, "a"],
      ["verifier-b", modelB, "b"],
    ] as const) {
      const name = `${batch}-${suffix}`;
      let problem: string | undefined;
      let verdicts = new Map<string, Verdict>();
      try {
        const dir = verifierFolder(name, toVerify, reports, store);
        d.say?.(
          `${stage}: a fresh ${model} session tries to falsify ${toVerify.length} candidates`,
        );
        const r = await d.verify(dir, VERIFY_TASK, model);
        if (r && !r.ok) problem = `the ${model} session ended ${r.subtype}`;
        verdicts = readVerdicts(name);
      } catch (err) {
        problem = `the ${model} verifier could not run: ${err instanceof Error ? err.message : String(err)}`;
      }
      for (const e of toVerify) {
        const v = verdicts.get(e.id) ?? null;
        e.stages.push(
          verdictStage(stage, model, v, problem ?? "the verifier wrote no valid verdict for it"),
        );
      }
    }
  }

  // Calibration: this batch's canaries count, and one that slipped holds the whole batch.
  const raw = new Map(entries.map((e) => [e.id, decide(e.stages, { allowed: true, why: null })]));
  const batchResults: CanaryResult[] = entries.flatMap((e) => {
    const r = raw.get(e.id)?.outcome;
    return e.canary && r !== "hold"
      ? [{ at: now.time, kind: e.canary.kind, caught: r === "reject" }]
      : [];
  });
  const missed = entries.filter((e) => e.canary && raw.get(e.id)?.outcome === "publish").length;
  const cal = calibration([...canaryResults(lines), ...batchResults], ev);
  const publishing = batchPublishing(cal, missed);

  const decisions: Decision[] = entries.map((e) => {
    const r = raw.get(e.id) as { outcome: Outcome; why: string };
    const final = e.canary
      ? {
          outcome: (r.outcome === "publish" ? "hold" : r.outcome) as Outcome,
          why:
            r.outcome === "publish"
              ? "missed: this test claim passed every check"
              : r.outcome === "reject"
                ? `caught: ${r.why}`
                : `inconclusive: ${r.why}`,
        }
      : decide(e.stages, publishing);
    return {
      at: now.time,
      batch,
      id: e.id,
      topic: e.candidate.topics[0] as string,
      statement: e.candidate.statement,
      hash: candidateHash(e.candidate),
      updates: e.pending?.updates ?? false,
      canary: e.canary,
      reasons: e.reasons,
      stages: e.stages,
      raw: r.outcome,
      outcome: final.outcome,
      why: final.why.slice(0, 1500),
    };
  });
  d.files.record(decisions);

  const real = entries.filter((e) => !e.canary);
  const byId = new Map(decisions.map((x) => [x.id, x]));
  const items: BatchItem[] = real.map((e) => {
    const x = byId.get(e.id) as Decision;
    const failed = e.stages.find((s) => s.ok !== true);
    return {
      id: e.id,
      hash: x.hash,
      topic: x.topic,
      outcome: x.outcome,
      public:
        x.outcome === "publish"
          ? "every check passed"
          : publicReason(failed, x.outcome === "hold" && !failed ? publishing.why : null),
      method: e.method,
      review:
        x.outcome === "publish"
          ? {
              by: "evaluator",
              reasons: e.reasons.length ? e.reasons : ["held by the gate"],
              at: now.time,
              batch,
              checks: reviewChecks(e.stages),
              models: [modelA, modelB],
            }
          : null,
    };
  });
  d.files.writeBatch({ id: batch, at: now, models: [modelA, modelB], publishing, items });
  const count = (o: Outcome) => items.filter((i) => i.outcome === o).length;
  const caught = batchResults.filter((r) => r.caught).length;
  return {
    batch,
    decisions,
    message: `${batch}: ${count("publish")} to publish, ${count("hold")} held, ${count("reject")} rejected; ${caught} of ${batchResults.length} test claims caught${publishing.allowed ? "" : ` (${publishing.why})`}${signDecisions(d, batch, decisions, store)}`,
  };
}

/**
 * Signs every decision of a batch, test claims included, with the publisher key, after the batch
 * is written, so a signing failure never loses a decision; the batch's message says it instead.
 */
function signDecisions(d: EvaluatorDeps, batch: string, decisions: Decision[], store: Store) {
  try {
    const p = d.publisher?.() ?? null;
    if (!p) return "; not signed: no publisher key";
    const records = store.orangecheck ?? EMPTY_RECORDS;
    d.files.sign(
      decisions.map((x) => {
        const s = stampJson(x, { at: new Date(x.at), publisher: p, records });
        return { batch, id: x.id, envelope: s.envelope, authority: s.authority.state };
      }),
    );
    return `; signed by ${p.address}`;
  } catch (e) {
    return `; not signed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Puts the decisions' signatures on Nostr, the envelopes only (a hash of each decision, never its
 * words). Its own log, so it never races the hourly tick's; each batch retries what no two relays
 * hold yet.
 */
export async function publishDecisions(files: EvaluatorFiles = evaluatorFiles()) {
  if (!publisherFrom()) return undefined;
  const r = await publishPending(
    files
      .signatures()
      .map((s) =>
        s.envelope.kind === "agent-action"
          ? { type: "action" as const, envelope: s.envelope }
          : { type: "stamp" as const, envelope: s.envelope },
      ),
    { log: path.join(files.dir, "published.json") },
  );
  return r.waiting.length
    ? `${r.waiting.length} decision signature(s) not yet on two relays`
    : `${r.published.length} decision signature(s) on Nostr`;
}

const STAGE_WORDS: Record<Stage["stage"], string> = {
  recheck: "quotes and checks again",
  rules: "structural rules",
  "verifier-a": "first verifier",
  "verifier-b": "second verifier",
};

/** What the public log says about a claim that did not publish: names, never a model's words. */
function publicReason(failed: Stage | undefined, paused: string | null): string {
  if (!failed) return paused ? "publishing paused by calibration" : "held";
  if (failed.stage === "rules") {
    const names = failed.detail
      .split("; ")
      .map((p) => p.split(":")[0])
      .filter(Boolean);
    return `${failed.ok === null ? "held" : "rejected"} by the structural rules: ${names.join(", ")}`;
  }
  const verdict =
    failed.stage.startsWith("verifier") && failed.ok === false ? failed.detail.split(":")[0] : null;
  const model = failed.model ? ` (${failed.model})` : "";
  if (verdict) return `the ${STAGE_WORDS[failed.stage]}${model} said ${verdict}`;
  return `${failed.ok === null ? "held" : "rejected"} at ${STAGE_WORDS[failed.stage]}${model}`;
}

/** The checks a published claim's review record lists, in plain words. */
function reviewChecks(stages: Stage[]): string[] {
  const out: string[] = [];
  for (const s of stages) {
    if (s.stage === "recheck")
      out.push(
        `every quote and check confirmed again (${s.detail.replace(/^found again: /, "")})`.slice(
          0,
          200,
        ),
      );
    if (s.stage === "rules") out.push(`structural rules ${s.detail}`.slice(0, 200));
    if (s.stage === "verifier-a" || s.stage === "verifier-b")
      out.push(`independent verifier (${s.model}) accepted`);
  }
  return out;
}

// --- applying a batch (under the tick lock) ------------------------------------------------------

/**
 * Publishes and rejects what a batch decided, as deterministic code: each claim only if it still
 * waits exactly as evaluated. Writes the run log and the public record, then commits. Returns the
 * exit code and a line for the owner.
 */
export function applyBatch(
  id: string,
  now: Stamp,
  opts: { commit: boolean; push: boolean },
  settings: Settings,
  files: EvaluatorFiles = evaluatorFiles(),
): { code: number; message: string; published: string[] } {
  const policy = loadPolicy();
  const { store } = loadStore(KNOWLEDGE);
  // The disclosure gate again, in case what counts as public changed since the batch was decided:
  // an embargoed item leaves no trace here, not even in the counts.
  const queue = readPending();
  const kept = screenEmbargo(queue, store, now.time);
  const embargoed = new Set(queue.filter((p) => !kept.includes(p)).map((p) => p.candidate.id));
  const raw = files.readBatch(id);
  const b = { ...raw, items: raw.items.filter((i) => !embargoed.has(i.id)) };
  const claims = new Map(store.claims.map((c) => [c.id, c]));
  const pending = new Map(kept.map((p) => [p.candidate.id, p]));
  const written: Claim[] = [];
  const published: string[] = [];
  const removed: Pending[] = [];
  const rejected: Run["rejected"] = [];
  const moved: string[] = [];
  const held = new Map<string, { count: number; reasons: Set<string> }>();
  for (const item of b.items) {
    const p = pending.get(item.id);
    if (!p || candidateHash(p.candidate) !== item.hash) {
      moved.push(item.id);
      continue;
    }
    if (item.outcome === "hold") {
      const h = held.get(item.topic) ?? { count: 0, reasons: new Set<string>() };
      h.count++;
      h.reasons.add(item.public);
      held.set(item.topic, h);
      continue;
    }
    if (item.outcome === "reject") {
      rejected.push({
        statement: `(${item.topic}: withheld, rejected by the evaluator)`,
        reason: item.public,
      });
      removed.push(p);
      continue;
    }
    if (!item.review) throw new Error(`${item.id} is marked publish without a review record`);
    const old = claims.get(item.id);
    let claim: Claim;
    if (old) {
      const u = updateClaim(old, p.candidate, now, p.run, item.method, item.review);
      if (u.error) {
        rejected.push({ statement: `(${item.topic}: withheld)`, reason: u.error });
        removed.push(p);
        continue;
      }
      claim = u.claim;
    } else claim = createClaim(p.candidate, now, p.run, item.method, item.review);
    claims.set(claim.id, claim);
    written.push(claim);
    published.push(claim.id);
    removed.push(p);
  }
  for (const p of removed) removePending(p.candidate.id);
  const remaining = readPending();
  const lines = files.outcomes();
  const record = evaluatorRecord(lines, settings, now);
  const log: Run = {
    id,
    kind: "review",
    started: b.at,
    finished: now,
    agent: `the evaluator: recheck, structural rules, two independent verifiers (${b.models.join(" and ")})`,
    summary:
      `The evaluator decided ${b.items.length - moved.length} waiting claim(s): ${published.length} published, ${rejected.length} rejected, ${[...held.values()].reduce((n, h) => n + h.count, 0)} held.${b.publishing.allowed ? "" : ` Automatic publishing was paused: ${b.publishing.why}.`}`.slice(
        0,
        1200,
      ),
    read: [],
    published,
    revised: [],
    rejected,
    gated: [...held].map(([topic, h]) => ({ topic, count: h.count, reasons: [...h.reasons] })),
    open: moved.length
      ? [
          `${moved.length} claim(s) changed or left the queue after evaluation; they wait for the next batch`,
        ]
      : [],
    injections: [],
  };
  const newStore: Store = {
    ...store,
    claims: [...claims.values()],
    topics: publicTopics(store, claims, policy),
    review: reviewCounts(remaining),
    evaluator: record,
  };
  const code = commitStore(
    {
      store: newStore,
      claims,
      writeClaims: written,
      extraFiles: [
        [path.join(KNOWLEDGE, "runs", id.slice(0, 4), `${id}.yaml`), toYaml(log)],
        [path.join(KNOWLEDGE, "evaluator.json"), `${JSON.stringify(record, null, 1)}\n`],
      ],
      message: `Publish what the evaluator passed in ${id}: ${published.length} published, ${rejected.length} rejected, every one checked again, by rule and by two verifiers.`,
    },
    now,
    opts,
  );
  if (code !== 0) {
    for (const p of removed) writePending(p);
    return { code, message: "applying the batch failed; the claims still wait", published: [] };
  }
  for (const e of feedEvents(b, published, store, now)) feedEvent(e);
  return {
    code,
    published,
    message: `${published.length} published, ${rejected.length} rejected, ${[...held.values()].reduce((n, h) => n + h.count, 0)} held${moved.length ? `, ${moved.length} moved since` : ""}`,
  };
}

/** The public record: decisions per day, the canary catch rate, what stopped what. */
export function evaluatorRecord(
  lines: readonly OutcomeLine[],
  s: Settings,
  now: Stamp,
): EvaluatorRecord {
  const cal = calibration(canaryResults(lines), s.evaluator);
  const days = new Map<string, EvaluatorRecord["days"][number]>();
  const stopped = new Map<string, number>();
  for (const l of lines) {
    const day = l.at.slice(0, 10);
    const row = days.get(day) ?? {
      day,
      published: 0,
      held: 0,
      rejected: 0,
      canaries: 0,
      caught: 0,
    };
    if (l.canary) {
      if (l.raw !== "hold") {
        row.canaries++;
        if (l.raw === "reject") row.caught++;
      }
    } else {
      if (l.outcome === "publish") row.published++;
      else if (l.outcome === "reject") row.rejected++;
      else row.held++;
      if (l.stopped) {
        const word =
          l.stopped in STAGE_WORDS ? STAGE_WORDS[l.stopped as Stage["stage"]] : "calibration";
        stopped.set(word, (stopped.get(word) ?? 0) + 1);
      }
    }
    days.set(day, row);
  }
  return {
    updated: now,
    threshold: s.evaluator.minCatchRate,
    window: s.evaluator.window,
    paused: cal.publishing ? null : (cal.why as string).slice(0, 300),
    canaries: {
      total: cal.total,
      caught: cal.caught,
      recent: cal.recent,
      recentCaught: cal.recentCaught,
      kinds: cal.kinds,
    },
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-120),
    stopped: [...stopped].map(([check, n]) => ({ check, n })).sort((a, b) => b.n - a.n),
  };
}

/**
 * What readers see happen (core/src/feed.ts): the published ids, and for the rest only counts per
 * public topic. Counts ride in `n` so the day's numbers add up: published under `publish`,
 * rejected under `evaluate` with outcome failed.
 */
export function feedEvents(
  b: BatchFile,
  published: string[],
  store: Store,
  now: Stamp,
): FeedEvent[] {
  const out: FeedEvent[] = [];
  const at = now.time;
  if (published.length)
    out.push({
      at,
      kind: "publish",
      text: `The evaluator published ${published.length} claim${published.length === 1 ? "" : "s"} that passed every check and two independent verifiers`,
      claims: published.slice(0, 40),
      outcome: "ok",
      n: published.length,
    });
  const titles = new Map(store.topics.map((t) => [t.slug, t.title]));
  const tally = new Map<string, { held: number; rejected: number }>();
  for (const i of b.items) {
    if (i.outcome === "publish") continue;
    const key = titles.has(i.topic) ? i.topic : "";
    const t = tally.get(key) ?? { held: 0, rejected: 0 };
    if (i.outcome === "reject") t.rejected++;
    else t.held++;
    tally.set(key, t);
  }
  for (const [topic, t] of tally) {
    const where = topic ? `on ${titles.get(topic)}` : "on topics not public yet";
    const about = topic ? { topic } : {};
    if (t.rejected)
      out.push({
        at,
        kind: "evaluate",
        text: `Kept ${t.rejected} claim${t.rejected === 1 ? "" : "s"} ${where} out: a check failed`,
        ...about,
        outcome: "failed",
        n: t.rejected,
      });
    if (t.held)
      out.push({
        at,
        kind: "evaluate",
        text: `Held ${t.held} claim${t.held === 1 ? "" : "s"} ${where} for another look`,
        ...about,
        outcome: "changed",
      });
  }
  if (!b.publishing.allowed)
    out.push({
      at,
      kind: "evaluate",
      text: "Automatic publishing is paused until the evaluator catches its test claims again",
      outcome: "failed",
    });
  return out;
}

// --- what the admin shows ------------------------------------------------------------------------

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

export function evaluatorView(
  s: Settings,
  at: string,
  files: EvaluatorFiles = evaluatorFiles(),
  ready = modelReady(),
): EvaluatorView {
  const lines = files.outcomes();
  const cal = calibration(canaryResults(lines), s.evaluator);
  const pending = readPending();
  const due = dueItems(pending, lines, new Date(at)).length;
  const { store } = loadStore(KNOWLEDGE);
  const current = new Map(
    store.claims.filter((c) => c.status !== "withdrawn").map((c) => [c.id, c]),
  );
  const decisions = files
    .decisions()
    .slice(-60)
    .reverse()
    .map((d) => ({
      ...d,
      statement: clip(d.statement, 700),
      why: clip(d.why, 600),
      stages: d.stages.map((x) => ({ ...x, detail: clip(x.detail, 600) })),
    }));
  const published = files
    .decisions()
    .filter(
      (d) => !d.canary && d.outcome === "publish" && current.get(d.id)?.review?.by === "evaluator",
    )
    .reverse()
    .filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i)
    .slice(0, 60)
    .map((d) => {
      const c = current.get(d.id) as Claim;
      return {
        id: d.id,
        hash: claimHash(c),
        statement: clip(c.statement, 700),
        at: d.at,
        batch: d.batch,
      };
    });
  let state: EvaluatorView["state"] = "ready";
  let why = "it decides gated claims and publishes what passes every check";
  if (s.evaluator.decides === "owner") {
    state = "owner";
    why = "you decide: gated claims wait for your approval";
  } else if (!ready) {
    state = "waiting";
    why = WAITING;
  } else if (!cal.publishing) {
    state = cal.recent < MIN_CANARIES ? "calibrating" : "paused";
    why = cal.why as string;
  }
  const last = files.lastBatch();
  const sig = last ? files.signatures().find((x) => x.batch === last.id) : undefined;
  return {
    at,
    decides: s.evaluator.decides,
    state,
    why,
    backlog: pending.length,
    due,
    calibration: {
      total: cal.total,
      caught: cal.caught,
      recent: cal.recent,
      recentCaught: cal.recentCaught,
      rate: cal.rate,
      threshold: s.evaluator.minCatchRate,
      window: s.evaluator.window,
      kinds: cal.kinds,
    },
    decisions,
    published,
    lastBatch: last
      ? {
          id: last.id,
          at: last.at.time,
          note: `${last.items.filter((i) => i.outcome === "publish").length} passed, ${last.items.filter((i) => i.outcome === "hold").length} held, ${last.items.filter((i) => i.outcome === "reject").length} rejected`,
        }
      : null,
    signed: sig ? { by: sig.envelope.signer.address, authority: sig.authority } : null,
  };
}

/** A cheap fingerprint of what the view is built from, so the daemon rebuilds it only on change. */
export function evaluatorSignature(s: Settings, files: EvaluatorFiles = evaluatorFiles()): string {
  const stamp = (f: string) => (existsSync(f) ? `${statSync(f).size}:${statSync(f).mtimeMs}` : "-");
  return canonicalJson({
    s: s.evaluator,
    m: s.research.model,
    r: modelReady(),
    d: stamp(path.join(files.dir, "decisions.jsonl")),
    g: stamp(path.join(files.dir, "signatures.jsonl")),
    k: stamp(path.join(KNOWLEDGE, "evaluator.json")),
    h: Math.floor(Date.now() / 600_000),
  });
}

/** Whether a scheduled session slot should evaluate the backlog rather than research. */
export function evaluatorWanted(s: Settings, files: EvaluatorFiles = evaluatorFiles()): boolean {
  if (s.evaluator.decides !== "evaluator" || !modelReady()) return false;
  return dueItems(readPending(), files.outcomes(), new Date()).length > 0;
}

/** The default dependencies: the network check, the verifier role, the files as they are. */
export function defaultDeps(
  check: EvaluatorDeps["check"],
  now: EvaluatorDeps["now"],
  settings: () => Settings,
  say?: (t: string) => void,
): EvaluatorDeps {
  return {
    files: evaluatorFiles(),
    settings,
    now,
    check,
    verify: (dir, task, model) => runRole("verifier", dir, task, { model }),
    modelReady,
    store: () => loadStore(KNOWLEDGE).store,
    pending: readPending,
    say,
    publisher: () => publisherFrom(),
  };
}
