// Writing the store: claims and topics as YAML in a stable, readable key order, the gate policy, the
// moment stamp, and the private review queue under var/review/.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Claim,
  type GateTopic,
  type Stamp,
  type Topic,
  Topic as TopicSchema,
} from "@blocklore/core";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { ChainSource } from "./chain.ts";
import type { ClaimReport } from "./check.ts";
import { KNOWLEDGE, REVIEW, ROOT } from "./env.ts";
import { Candidate, Verdict } from "./staging.ts";

const CLAIM_ORDER: (keyof Claim)[] = [
  "id",
  "statement",
  "kind",
  "topics",
  "depth",
  "status",
  "confidence",
  "people",
  "attributed_to",
  "sources",
  "checks",
  "first_seen",
  "last_verified",
  "run",
  "related",
  "supersedes",
  "superseded_by",
  "review",
  "revisions",
];

function ordered<T extends object>(obj: T, order: (keyof T)[]): T {
  const out: Partial<T> = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj) as (keyof T)[])
    if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out as T;
}

export function toYaml(value: unknown): string {
  return stringify(value, { lineWidth: 100, minContentWidth: 40, aliasDuplicateObjects: false });
}

export function claimYaml(c: Claim): string {
  return toYaml(ordered(c, CLAIM_ORDER));
}

export function claimPath(c: Pick<Claim, "id" | "topics">): string {
  return path.join(KNOWLEDGE, "claims", c.topics[0] as string, `${c.id}.yaml`);
}

export function topicYaml(t: Topic): string {
  return toYaml(
    ordered(t, ["slug", "title", "lede", "group", "contested", "safety", "related", "sections"]),
  );
}

// --- the gate policy -----------------------------------------------------------------------------

const Policy = z.strictObject({
  topics: z.record(z.string(), z.strictObject({ contested: z.boolean(), safety: z.boolean() })),
  contested_terms: z.array(z.string()),
});
export type Policy = z.infer<typeof Policy>;

export function loadPolicy(): Policy {
  return Policy.parse(
    parse(readFileSync(path.join(ROOT, "brain", "policy", "topics.yaml"), "utf8")),
  );
}

/** The gate flags for a topic: the policy's, or contested when the policy does not list it. */
export function policyFlags(policy: Policy, slug: string): GateTopic {
  const p = policy.topics[slug];
  return { slug, contested: p ? p.contested : true, safety: p ? p.safety : false };
}

// --- the moment -----------------------------------------------------------------------------------

export async function nowStamp(chain: ChainSource): Promise<Stamp> {
  return {
    time: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    height: await chain.tipHeight(),
  };
}

// --- the private review queue (var/review/) ----------------------------------------------------------

export const Pending = z.strictObject({
  candidate: Candidate,
  reasons: z.array(z.string()).min(1),
  run: z.string(),
  proposed: z.strictObject({ time: z.string(), height: z.number() }),
  verdict: Verdict,
  method: z.string(),
  /** Set when the pending claim updates a published one. */
  updates: z.boolean(),
});
export type Pending = z.infer<typeof Pending>;

const pendingDir = path.join(REVIEW, "claims");
const layoutDir = path.join(REVIEW, "layouts");

export function readPending(): Pending[] {
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => Pending.parse(parse(readFileSync(path.join(pendingDir, f), "utf8"))));
}

export function writePending(p: Pending) {
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(path.join(pendingDir, `${p.candidate.id}.yaml`), toYaml(p));
}

export function removePending(id: string) {
  rmSync(path.join(pendingDir, `${id}.yaml`), { force: true });
}

/** The full layout a run proposed for a topic, pending claims included. */
export function readLayout(slug: string): Topic | null {
  const f = path.join(layoutDir, `${slug}.yaml`);
  return existsSync(f) ? TopicSchema.parse(parse(readFileSync(f, "utf8"))) : null;
}

export function writeLayout(t: Topic) {
  mkdirSync(layoutDir, { recursive: true });
  writeFileSync(path.join(layoutDir, `${t.slug}.yaml`), topicYaml(t));
}

export function readLayouts(): Topic[] {
  if (!existsSync(layoutDir)) return [];
  return readdirSync(layoutDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => readLayout(path.basename(f, ".yaml")) as Topic);
}

/**
 * The public face of a layout: only published claims, empty sections dropped, the lede replaced by
 * the first published claim when the intended one waits for review. Null when nothing is published.
 */
export function publicTopic(
  layout: Topic,
  published: ReadonlySet<string>,
  policy: Policy,
): Topic | null {
  const sections = layout.sections
    .map((s) => ({ ...s, claims: s.claims.filter((id) => published.has(id)) }))
    .filter((s) => s.claims.length > 0);
  if (sections.length === 0) return null;
  const lede = published.has(layout.lede) ? layout.lede : (sections[0]?.claims[0] as string);
  const flags = policyFlags(policy, layout.slug);
  return { ...layout, lede, contested: flags.contested, safety: flags.safety, sections };
}

/** The report for one candidate from a run's checks.json. */
export function reportFor(reports: ClaimReport[], id: string): ClaimReport | undefined {
  return reports.find((r) => r.id === id);
}
