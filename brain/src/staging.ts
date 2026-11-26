// A research run's working folder (var/staging/<run>/): what the research role proposes, what the
// checks found and what the verifier decided. Everything here is parsed at the edge; a file that
// fails its schema is rejected, never repaired by a model (SECURITY.md, T3).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CHANGES, Claim, Debate, Section, Topic } from "@blocklore/core";
import { parse } from "yaml";
import { z } from "zod";
import { STAGING } from "./env.ts";

/** A proposed claim: what it says and why, before the publisher gives it a history. */
export const Candidate = Claim.omit({
  first_seen: true,
  last_verified: true,
  run: true,
  revisions: true,
  review: true,
}).extend({
  /** For a change to a published claim: what kind of change, and why. */
  change: z.enum(CHANGES).exclude(["created", "reviewed"]).optional(),
  note: z.string().min(3).max(600).optional(),
});
export type Candidate = z.infer<typeof Candidate>;

/** A proposed topic layout. Sections may name candidates from the same run. */
export const TopicProposal = Topic;
export type TopicProposal = z.infer<typeof TopicProposal>;

export const Verdict = z.strictObject({
  id: z.string(),
  verdict: z.enum(["accept", "revise", "reject"]),
  reason: z.string().min(3).max(1200),
  /** For revise: the corrected candidate the verifier stands behind. */
  revised: Candidate.optional(),
  /** Per source: whether the quote supports the statement as written. */
  sources: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        supports: z.enum(["yes", "partly", "no"]),
        why: z.string().max(400),
      }),
    )
    .optional(),
});
export type Verdict = z.infer<typeof Verdict>;

/** The research role's account of its run, merged into the public run log. */
export const RunNotes = z.strictObject({
  summary: z.string().min(10).max(1200),
  read: z.array(z.strictObject({ url: z.url(), why: z.string().max(200).optional() })),
  skipped: z.array(z.strictObject({ statement: z.string(), reason: z.string() })).default([]),
  open: z.array(z.string()).default([]),
  injections: z.array(z.strictObject({ url: z.url(), excerpt: z.string().max(300) })).default([]),
  /** The threats on the security map this run's claims explain or defend against, by threat id. */
  threats: z
    .array(
      z.strictObject({
        threat: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        explains: z.array(z.string()).max(20).default([]),
        defends: z.array(z.string()).max(20).default([]),
      }),
    )
    .default([]),
  /** The claims that answer each reader question the task carried, by its id (brain/src/answers.ts). */
  answers: z
    .array(
      z.strictObject({
        question: z.string().regex(/^[0-9a-f]{16}$/),
        claims: z.array(z.string()).min(1).max(20),
      }),
    )
    .default([]),
});
export type RunNotes = z.infer<typeof RunNotes>;

/** Written by the runner when a run starts: when, at what height, and which agent and model. */
export const RunMeta = z.strictObject({
  started: z.strictObject({ time: z.string(), height: z.number().int() }),
  agent: z.string(),
  task: z.string(),
  /** The reader questions the task carried (brain/src/plan.ts), by research queue id. */
  asked: z.array(z.string().regex(/^[0-9a-f]{16}$/)).optional(),
});
export type RunMeta = z.infer<typeof RunMeta>;

export interface StagedFile<T> {
  file: string;
  value?: T;
  errors: string[];
}

function readDir<T>(dir: string, schema: z.ZodType<T>): StagedFile<T>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      try {
        const r = schema.safeParse(parse(readFileSync(file, "utf8"), { uniqueKeys: true }));
        return r.success
          ? { file, value: r.data, errors: [] }
          : {
              file,
              errors: r.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`),
            };
      } catch (e) {
        return { file, errors: [`not parseable YAML: ${String(e).slice(0, 300)}`] };
      }
    });
}

export function runDir(run: string): string {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(run)) throw new Error(`not a run id: ${run}`);
  return path.join(STAGING, run);
}

export function loadRun(run: string) {
  const dir = runDir(run);
  const notesFile = path.join(dir, "run.yaml");
  let notes: StagedFile<RunNotes> = { file: notesFile, errors: ["missing run.yaml"] };
  if (existsSync(notesFile)) {
    try {
      const r = RunNotes.safeParse(parse(readFileSync(notesFile, "utf8")));
      notes = r.success
        ? { file: notesFile, value: r.data, errors: [] }
        : {
            file: notesFile,
            errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          };
    } catch (e) {
      notes = { file: notesFile, errors: [String(e)] };
    }
  }
  const metaFile = path.join(dir, "meta.json");
  const meta = existsSync(metaFile)
    ? RunMeta.parse(JSON.parse(readFileSync(metaFile, "utf8")))
    : null;
  return {
    dir,
    meta,
    candidates: readDir(path.join(dir, "claims"), Candidate),
    topics: readDir(path.join(dir, "topics"), TopicProposal),
    /** Debate maps over the run's and the store's claims (brain/src/debates.ts). */
    debates: readDir(path.join(dir, "debates"), Debate),
    verdicts: readDir(path.join(dir, "verdicts"), Verdict),
    notes,
  };
}

export { Section };
