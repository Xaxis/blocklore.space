// The embargo (core/src/disclosure.ts; SECURITY.md, T9): findings that may be undisclosed
// vulnerabilities, kept privately on the devbox for the owner and nowhere else. Nothing here is ever
// written to knowledge/, counted in the review queue, put in a run log or sent to the public feed.
// The admin shows the owner each item with the project's responsible-disclosure path; only the
// owner releases or dismisses one.
//
//   var/embargo/<id>.json      one finding: what, why it was held, the detail, where to report it
//   var/embargo/closed.jsonl   what the owner decided, and when
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type DisclosureContact,
  disclosureContacts,
  disclosurePath,
  LAB_PROJECT_LABEL,
  type LabProject,
} from "@blocklore/core";
import { EmbargoView } from "@blocklore/core/control";
import { VAR } from "../env.ts";

export const EMBARGO_DIR = process.env.BLOCKLORE_EMBARGO_DIR || path.join(VAR, "embargo");

export interface EmbargoItem {
  /** Stable for the same finding: a hash of its kind and key. */
  id: string;
  kind: "lab" | "research";
  /** When it was first held. */
  at: string;
  /** A short private title for the owner: the test or the candidate id. */
  title: string;
  /** Why the disclosure gate held it, in the gate's words. */
  reasons: string[];
  /** Where to report it privately. */
  contacts: DisclosureContact[];
  /** The full finding: a lab run with its logs' tail, or the candidate with its sources. */
  detail: unknown;
}

const file = (id: string) => path.join(EMBARGO_DIR, `${id}.json`);

/** Holds a finding. Holding the same finding again keeps its first time and updates the rest. */
export function hold(input: {
  kind: EmbargoItem["kind"];
  key: string;
  title: string;
  reasons: string[];
  /** The finding's text, read for the projects to report it to. */
  text: string;
  /** The projects to report it to, by name, when the finding says whose it is (an LND lab run). */
  projects?: string[];
  detail: unknown;
  at: string;
}): EmbargoItem {
  mkdirSync(EMBARGO_DIR, { recursive: true, mode: 0o700 });
  const id = createHash("sha256").update(`${input.kind}\n${input.key}`).digest("hex").slice(0, 16);
  const prev = readItem(id);
  const named = input.projects ? disclosureContacts(input.projects) : [];
  const item: EmbargoItem = {
    id,
    kind: input.kind,
    at: prev?.at ?? input.at,
    title: input.title.slice(0, 200),
    reasons: input.reasons,
    contacts: named.length ? named : disclosurePath(input.text),
    detail: input.detail,
  };
  writeFileSync(file(id), `${JSON.stringify(item, null, 2)}\n`, { mode: 0o600 });
  return item;
}

export function readItem(id: string): EmbargoItem | null {
  if (!/^[0-9a-f]{16}$/.test(id) || !existsSync(file(id))) return null;
  return JSON.parse(readFileSync(file(id), "utf8")) as EmbargoItem;
}

/** Everything held, oldest first. */
export function listEmbargo(): EmbargoItem[] {
  if (!existsSync(EMBARGO_DIR)) return [];
  return readdirSync(EMBARGO_DIR)
    .filter((f) => /^[0-9a-f]{16}\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(path.join(EMBARGO_DIR, f), "utf8")) as EmbargoItem)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/**
 * One item as the admin shows it to the owner (EmbargoView in core/src/control.ts): what was found,
 * why it was held and where to report it. It goes only to the owner's signed-in admin.
 */
export function embargoView(item: EmbargoItem): EmbargoView {
  const d = (item.detail ?? {}) as {
    candidate?: { statement?: string; sources?: { url?: string; quote?: string }[] };
    run?: {
      project?: LabProject;
      version?: string;
      tests?: { name: string; ok: boolean }[];
      verified?: { sha256?: boolean; signatures?: number | null };
    };
    lnd?: { required?: number | null };
    tail?: string;
  };
  let summary = item.title;
  if (d.candidate?.statement) summary = d.candidate.statement;
  else if (d.run) {
    const failed = (d.run.tests ?? []).filter((t) => !t.ok).map((t) => t.name);
    const sigs = d.run.verified?.signatures;
    const lnd = d.run.project === "lnd";
    summary = [
      `${LAB_PROJECT_LABEL[d.run.project ?? "bitcoin-core"]} ${d.run.version ?? "?"}: ${failed.length ? `failed ${failed.join(", ")}` : "every test passed"}.`,
      `${lnd ? "The signed manifest" : "SHA256SUMS"} ${d.run.verified?.sha256 ? "matched" : "did not match"}.`,
      sigs === null || sigs === undefined
        ? "Signatures were not checked."
        : lnd
          ? `${sigs} good maintainer signatures; LND requires ${d.lnd?.required ?? "?"}.`
          : `${sigs} good builder signatures.`,
    ].join(" ");
  }
  return EmbargoView.parse({
    id: item.id,
    kind: item.kind,
    at: item.at,
    title: item.title.slice(0, 200),
    reasons: item.reasons.slice(0, 10).map((r) => r.slice(0, 300)),
    contacts: item.contacts.slice(0, 10).map(({ project, email, policy }) => ({
      project,
      email,
      policy,
    })),
    summary: summary.slice(0, 2000),
    sources: (d.candidate?.sources ?? []).slice(0, 20).map((s) => ({
      url: s.url ?? null,
      quote: s.quote ?? null,
    })),
    tail: d.tail ? d.tail.slice(-4000) : null,
  });
}

export type Decision = "release" | "dismiss";

/**
 * What releasing does, per kind: the lab publishes the run as it stands, research moves the
 * candidate into the ordinary review queue (the evaluator still decides it). Registered by
 * the modules that own each kind, so this file stays free of their dependencies.
 */
const releasers = new Map<EmbargoItem["kind"], (item: EmbargoItem) => Promise<string>>();
export function onRelease(kind: EmbargoItem["kind"], fn: (item: EmbargoItem) => Promise<string>) {
  releasers.set(kind, fn);
}

/** The owner's decision on one item. Dismiss forgets it; release hands it to its kind. */
export async function decide(id: string, decision: Decision, at: string): Promise<string> {
  const item = readItem(id);
  if (!item) throw new Error(`no embargoed finding ${id}`);
  let note = "dismissed: nothing was published";
  if (decision === "release") {
    const fn = releasers.get(item.kind);
    if (!fn) throw new Error(`nothing can release a ${item.kind} finding`);
    note = await fn(item);
  }
  appendFileSync(
    path.join(EMBARGO_DIR, "closed.jsonl"),
    `${JSON.stringify({ id, kind: item.kind, title: item.title, decision, at, note })}\n`,
    { mode: 0o600 },
  );
  rmSync(file(id));
  return note;
}
