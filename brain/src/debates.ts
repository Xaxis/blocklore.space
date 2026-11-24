// Debate maps on the brain's side (CLAIMS.md, "Debates"; BACKLOG 24). Research writes a debate into
// its run folder as debates/<slug>.yaml. `brain check` reports the rules it breaks
// (core/src/debateview.ts) in the same report research repairs its claims from. The publisher
// writes knowledge/debates/<slug>.yaml only when the debate breaks no rule against the claims as
// they stand after that commit. A debate whose only fault is that some of its claims still wait
// for the evaluator waits beside them, in var/review/debates/, and every later commit of the store
// (a research run, an evaluator batch, an approval, a withdrawal) tries it again. A debate built on
// a test claim, or on a claim that will never publish, is dropped. Deterministic: no model writes
// knowledge/, and the debate's own words get the same style, name and loaded-word rules as any
// sentence Blocklore writes.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Claim,
  canonicalJson,
  claimId,
  Debate,
  type DebateClaim,
  type DebateProblem,
  debateProblems,
  type GateTopic,
  type Issue,
  Stamp,
  type Store,
  type Topic,
} from "@blocklore/core";
import { parse } from "yaml";
import { z } from "zod";
import { canaryClash } from "./canary.ts";
import type { ClaimReport } from "./check.ts";
import { KNOWLEDGE, REVIEW } from "./env.ts";
import type { Candidate, StagedFile } from "./staging.ts";
import {
  loadPolicy,
  type Pending,
  type Policy,
  policyFlags,
  readLayouts,
  readPending,
  toYaml,
} from "./store.ts";

/** A debate waiting for claims the evaluator has not decided yet (var/review/debates/<slug>.yaml). */
export const WaitingDebate = z.strictObject({
  debate: Debate,
  /** The research run that wrote it. */
  run: z.string().min(1),
  proposed: Stamp,
  /** The claims it waited for at the last try. */
  waiting: z.array(claimId).min(1),
});
export type WaitingDebate = z.infer<typeof WaitingDebate>;

const waitingDir = () => path.join(REVIEW, "debates");

export function readWaitingDebates(): WaitingDebate[] {
  const dir = waitingDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => WaitingDebate.parse(parse(readFileSync(path.join(dir, f), "utf8"))));
}

export function writeWaitingDebate(w: WaitingDebate) {
  mkdirSync(waitingDir(), { recursive: true });
  writeFileSync(path.join(waitingDir(), `${w.debate.slug}.yaml`), toYaml(w));
}

export function removeWaitingDebate(slug: string) {
  rmSync(path.join(waitingDir(), `${slug}.yaml`), { force: true });
}

export function debatePath(slug: string): string {
  return path.join(KNOWLEDGE, "debates", `${slug}.yaml`);
}

/** A debate as YAML in the order a reader takes it in: the question, the sides, the claims. */
export function debateYaml(d: Debate): string {
  return toYaml({
    slug: d.slug,
    question: d.question,
    topics: d.topics,
    positions: d.positions,
    nodes: d.nodes,
    edges: d.edges,
    ...(d.withdrawn ? { withdrawn: d.withdrawn } : {}),
  });
}

/** Why a slug the owner withdrew cannot take a map again, or null when it can. */
export function withdrawnSlug(debates: readonly Debate[], slug: string): string | null {
  const w = debates.find((d) => d.slug === slug)?.withdrawn;
  return w
    ? `the owner withdrew the map at this slug on ${w.at.time.slice(0, 10)} (${w.note}); no map publishes under it again`
    : null;
}

/**
 * Gate flags for the topics that exist, from the owner's policy. A slug neither the policy nor any
 * topic knows is left out, so it never counts as contested (the gate treats an unknown topic as
 * contested to hold its claims; here that would let a made-up topic carry a debate).
 */
export function knownFlags(
  policy: Policy,
  topics: readonly Pick<Topic, "slug">[],
): Map<string, GateTopic> {
  const slugs = new Set([...Object.keys(policy.topics), ...topics.map((t) => t.slug)]);
  return new Map([...slugs].map((s) => [s, policyFlags(policy, s)]));
}

/** What a debate's rules read of a candidate or a claim. */
function asDebateClaim(c: Candidate | Claim): DebateClaim {
  return {
    id: c.id,
    statement: c.statement,
    kind: c.kind,
    status: c.status,
    people: c.people,
    attributed_to: c.attributed_to,
  };
}

/** Claims by id, each later list replacing an earlier one's claim with the same id. */
function overlay(...lists: ReadonlyArray<Candidate | Claim>[]): Map<string, DebateClaim> {
  const out = new Map<string, DebateClaim>();
  for (const list of lists) for (const c of list) out.set(c.id, asDebateClaim(c));
  return out;
}

const said = (problems: DebateProblem[]) =>
  problems.map((p) => `${p.rule}: ${p.detail}`).join("; ");

// --- brain check ---------------------------------------------------------------------------------

/** Debate reports in a run's check report carry this method, so counts of claims can leave them out. */
export const DEBATE_METHOD = "debate rules";

export function isDebateReport(r: ClaimReport): boolean {
  return r.method === DEBATE_METHOD;
}

/**
 * The report for each debate in a run folder, beside the claims' reports. A debate is checked
 * against the claims it will meet: the published ones, then those waiting for the evaluator, then
 * this run's candidates (which may publish or wait); and against every topic the policy, the store,
 * a waiting layout or this run knows.
 */
export function checkDebates(
  run: {
    debates: StagedFile<Debate>[];
    candidates: StagedFile<Candidate>[];
    topics: StagedFile<Topic>[];
  },
  store: Pick<Store, "claims" | "topics" | "debates">,
  pending: readonly Pending[],
  layouts: readonly Topic[],
  policy: Policy,
): ClaimReport[] {
  const claims = overlay(
    store.claims,
    pending.map((p) => p.candidate),
    run.candidates.flatMap((f) => (f.value ? [f.value] : [])),
  );
  const flags = knownFlags(policy, [
    ...store.topics,
    ...layouts,
    ...run.topics.flatMap((f) => (f.value ? [f.value] : [])),
  ]);
  return run.debates.map((f) => {
    const name = path.basename(f.file, ".yaml");
    const issues: Issue[] = f.value
      ? debateProblems(f.value, claims, flags).map((p) => ({
          level: "error",
          where: `debate: ${p.rule}`,
          message: p.detail,
        }))
      : f.errors.map((m) => ({ level: "error", where: "debate schema", message: m }));
    if (f.value && f.value.slug !== name)
      issues.unshift({
        level: "error",
        where: "file",
        message: `the file must be named ${f.value.slug}.yaml`,
      });
    const gone = f.value ? withdrawnSlug(store.debates, f.value.slug) : null;
    if (gone) issues.unshift({ level: "error", where: "debate: withdrawn", message: gone });
    return {
      id: `debate ${name}`,
      ok: issues.length === 0,
      issues,
      sources: [],
      checks: [],
      method: DEBATE_METHOD,
    };
  });
}

// --- publishing ----------------------------------------------------------------------------------

/** A debate a research run offers to publish. */
export interface DebateOffer {
  debate: Debate;
  run: string;
  proposed: Stamp;
}

export interface Settlement {
  /** Debates to write to knowledge/debates/: new, or changed from what is published. */
  publish: Debate[];
  /** Debates to keep (or start) waiting in var/review/debates/. */
  wait: WaitingDebate[];
  /** Debates given up, each with why: the rules by name, and in full for the devbox's log. */
  drop: { slug: string; run: string; rules: string[]; why: string }[];
  /** Slugs whose waiting file goes: published or dropped. */
  settled: string[];
}

export const NO_DEBATES: Settlement = { publish: [], wait: [], drop: [], settled: [] };

/**
 * Decides every debate a run offers and every debate already waiting, against the store as it will
 * stand after this commit (`store`: its claims and public topics) and the review queue after it.
 * Pure but for `canaries`, which names the claims that are the evaluator's test claims.
 *
 *  - at a slug the owner withdrew a map from: dropped;
 *  - built on a test claim: dropped, whatever else holds;
 *  - breaks a rule even once every waiting claim publishes as it stands: dropped, with the rules;
 *  - breaks no rule against the claims as they stand: published (unless the same is published);
 *  - otherwise, while some of its claims wait in the review queue: waits for them;
 *  - otherwise: dropped, with the rules it breaks.
 *
 * An offer replaces a waiting debate with the same slug: the newer research wins.
 */
export function settleDebates(input: {
  store: Pick<Store, "claims" | "topics" | "debates">;
  pending: readonly Pending[];
  layouts: readonly Topic[];
  policy: Policy;
  offered: readonly DebateOffer[];
  waiting: readonly WaitingDebate[];
  canaries: (claims: ReadonlyArray<{ id: string; statement: string }>) => string[];
}): Settlement {
  const out: Settlement = { publish: [], wait: [], drop: [], settled: [] };
  const now = new Map(input.store.claims.map((c) => [c.id, c]));
  const nowFlags = new Map(
    input.store.topics.map((t) => [
      t.slug,
      { slug: t.slug, contested: t.contested, safety: t.safety },
    ]),
  );
  const queued = new Map(input.pending.map((p) => [p.candidate.id, p.candidate]));
  const then = overlay(input.store.claims, [...queued.values()]);
  const thenFlags = knownFlags(input.policy, [...input.store.topics, ...input.layouts]);
  const published = new Map(input.store.debates.map((d) => [d.slug, d]));

  const offers = new Map<string, DebateOffer>();
  for (const w of input.waiting) offers.set(w.debate.slug, w);
  for (const o of input.offered) offers.set(o.debate.slug, o);
  const wasWaiting = new Set(input.waiting.map((w) => w.debate.slug));

  for (const o of offers.values()) {
    const d = o.debate;
    const drop = (rules: string[], why: string) => {
      out.drop.push({ slug: d.slug, run: o.run, rules: [...new Set(rules)], why });
      if (wasWaiting.has(d.slug)) out.settled.push(d.slug);
    };
    const gone = withdrawnSlug(input.store.debates, d.slug);
    if (gone) {
      drop(["withdrawn"], gone);
      continue;
    }
    const test = input.canaries(
      d.nodes.map((n) => ({
        id: n.claim,
        statement: now.get(n.claim)?.statement ?? queued.get(n.claim)?.statement ?? "",
      })),
    );
    if (test.length) {
      drop(["test claim"], `it is built on the evaluator's test claims: ${test.join("; ")}`);
      continue;
    }
    const ever = debateProblems(d, then, thenFlags);
    if (ever.length) {
      drop(
        ever.map((p) => p.rule),
        said(ever),
      );
      continue;
    }
    const today = debateProblems(d, now, nowFlags);
    if (today.length === 0) {
      const same = published.get(d.slug);
      if (!same || canonicalJson(same) !== canonicalJson(d)) out.publish.push(d);
      if (wasWaiting.has(d.slug)) out.settled.push(d.slug);
      continue;
    }
    const waiting = d.nodes
      .map((n) => n.claim)
      .filter((id) => queued.has(id) && now.get(id)?.status !== "withdrawn");
    if (waiting.length) {
      out.wait.push({ debate: d, run: o.run, proposed: o.proposed, waiting });
      continue;
    }
    drop(
      today.map((p) => p.rule),
      said(today),
    );
  }
  return out;
}

/** The waiting debates tried again against a store about to be committed. */
export function settleWaiting(store: Pick<Store, "claims" | "topics" | "debates">): Settlement {
  const waiting = readWaitingDebates();
  if (waiting.length === 0) return NO_DEBATES;
  return settleDebates({
    store,
    pending: readPending(),
    layouts: readLayouts(),
    policy: loadPolicy(),
    offered: [],
    waiting,
    canaries: (c) => canaryClash(c),
  });
}

/** The store's debates with these written over the ones of the same slug. */
export function withDebates(debates: readonly Debate[], publish: readonly Debate[]): Debate[] {
  const by = new Map(debates.map((d) => [d.slug, d]));
  for (const d of publish) by.set(d.slug, d);
  return [...by.values()];
}

/** One line per debate decided, for the log of the command that committed. */
export function settlementLines(s: Settlement): string[] {
  return [
    ...s.publish.map((d) => `debate ${d.slug}: published`),
    ...s.wait.map(
      (w) =>
        `debate ${w.debate.slug}: waits for ${w.waiting.length} claim(s) the evaluator has not decided (${w.waiting.join(", ")})`,
    ),
    ...s.drop.map((x) => `debate ${x.slug}: dropped, ${x.why}`),
  ];
}
