// Reader reports, the pure part: a reader says a published claim has a problem, the brain rechecks
// it and says what it found, and the public sees every report's kind, date and outcome. The site
// (web/lib/reports.ts) stores them; the brain (brain/src/reports.ts) pulls them and reports back.
//
// A reader's note is for the brain and the owner only. It is checked for secrets before anything
// else reads it, its links and contacts are stripped, and no public view carries it: publicReport
// builds what readers see field by field, so a note cannot leak through a new field by accident.
import { z } from "zod";
import { sha256Hex } from "./hash.ts";
import { cleanQuestion } from "./queue.ts";
import { claimId, Stamp } from "./schema.ts";
import { detectSecrets, SECRET_LABEL } from "./secrets.ts";
import { hasDash } from "./style.ts";

export const REPORT_KINDS = ["wrong", "outdated", "unsupported", "broken-link", "unclear"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  wrong: "Wrong",
  outdated: "Outdated",
  unsupported: "The source does not say this",
  "broken-link": "Broken link",
  unclear: "Unclear",
};

/** Kinds that, when the claim still passes its recheck, send research looking for newer evidence. */
export const RESEARCH_KINDS: ReadonlySet<ReportKind> = new Set(["wrong", "outdated"]);

export const REPORT_STATUSES = [
  "received",
  "holds",
  "failed",
  "researching",
  "researched",
  "dismissed",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  received: "Waiting for a recheck",
  holds: "Still holds",
  failed: "Failed a recheck",
  researching: "Still holds; being researched",
  researched: "Researched",
  dismissed: "Dismissed as abuse",
};

/** Reports each visitor may file per UTC day, and the whole site. */
export const REPORT_VISITOR_DAY = 5;
export const REPORT_SITE_DAY = 200;
/** The longest note a reader may leave, and how many notes a report keeps. */
export const REPORT_NOTE_MAX = 500;
export const REPORT_NOTES_KEPT = 10;

const reportIdRe = /^[0-9a-f]{16}$/;
const runId = z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
const iso = z.string().min(10).max(40);

/** What the brain found, in the checker's words (never a model's). */
export const ReportOutcome = z.strictObject({
  at: Stamp,
  /** The recheck or research run that decided it, shown at /log/<run>. */
  run: runId.nullable(),
  /** What the recheck confirmed: "quotes 2/2, code 1/1, chain 1/1 (esplora pair agreed)". */
  checked: z.string().max(300).nullable(),
  /** What did not hold, one line each; empty when the claim held. */
  problems: z.array(z.string().min(1).max(600)).max(12),
  /** For researched: whether the run revised the claim. */
  changed: z.boolean().nullable(),
});
export type ReportOutcome = z.infer<typeof ReportOutcome>;

export const ReportNote = z.strictObject({ at: iso, text: z.string().min(1).max(REPORT_NOTE_MAX) });
export type ReportNote = z.infer<typeof ReportNote>;

/** One report as the site stores it and the brain pulls it: one per claim, kind and claim hash. */
export const ReportItem = z.strictObject({
  id: z.string().regex(reportIdRe),
  claim: claimId,
  kind: z.enum(REPORT_KINDS),
  /** The claim's hash when it was reported: a report is about that version. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** First and latest time a reader filed it. */
  at: iso,
  last: iso,
  /** How many times readers filed it. */
  count: z.number().int().min(1),
  status: z.enum(REPORT_STATUSES),
  outcome: ReportOutcome.nullable(),
  /** Readers' notes, newest last. Private: never in a public view. */
  notes: z.array(ReportNote).max(REPORT_NOTES_KEPT),
  updated: iso,
});
export type ReportItem = z.infer<typeof ReportItem>;

/** What anyone may see of a report: everything but the readers' notes. */
export interface PublicReport {
  id: string;
  claim: string;
  kind: ReportKind;
  hash: string;
  at: string;
  last: string;
  count: number;
  status: ReportStatus;
  outcome: ReportOutcome | null;
  updated: string;
}

/** The public view of a report, built field by field so nothing private comes along. */
export function publicReport(r: ReportItem): PublicReport {
  return {
    id: r.id,
    claim: r.claim,
    kind: r.kind,
    hash: r.hash,
    at: r.at,
    last: r.last,
    count: r.count,
    status: r.status,
    outcome: r.outcome
      ? {
          at: r.outcome.at,
          run: r.outcome.run,
          checked: r.outcome.checked,
          problems: [...r.outcome.problems],
          changed: r.outcome.changed,
        }
      : null,
    updated: r.updated,
  };
}

/** What the brain reports back about one report. */
export const ReportUpdate = z.strictObject({
  id: z.string().regex(reportIdRe),
  status: z.enum(["holds", "failed", "researching", "researched"]),
  outcome: ReportOutcome,
});
export type ReportUpdate = z.infer<typeof ReportUpdate>;

/** What the owner may do from the admin: dismiss a report as abuse, or send it back for a recheck. */
export const ReportOwnerAction = z.strictObject({
  id: z.string().regex(reportIdRe),
  action: z.enum(["dismiss", "reopen"]),
});
export type ReportOwnerAction = z.infer<typeof ReportOwnerAction>;

/** One report per claim, kind and version of the claim, so a repeat counts instead of adding. */
export function reportId(claim: string, kind: ReportKind, hash: string): string {
  return sha256Hex(`${claim}\n${kind}\n${hash}`).slice(0, 16);
}

// Control and format characters (zero-width, bidi overrides), kept out of notes the way the brain
// strips them from fetched pages; ordinary whitespace stays until cleanQuestion collapses it.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/** A note as the brain and the owner may read it: no hidden characters, links or contacts. */
export function cleanNote(note: string): string {
  return cleanQuestion(note.replace(/[\t\n\r]/g, " ").replace(INVISIBLE, ""));
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

const Body = z.strictObject({
  kind: z.enum(REPORT_KINDS),
  note: z.string().max(REPORT_NOTE_MAX).optional(),
});

export const REPORT_USAGE = `Send JSON: {"kind": one of ${REPORT_KINDS.join(", ")}, "note": optional text of at most ${REPORT_NOTE_MAX} characters}.`;

export type ReadReport =
  | { kind: ReportKind; note: string | null }
  | { error: string; status: 400; secret?: true };

/**
 * A report's body, read at the edge. Every string in it goes through the secret detector before
 * anything else looks at it; a match is refused without repeating it. Then the shape: a kind, an
 * optional note, nothing else.
 */
export function readReport(body: unknown): ReadReport {
  const found = strings(body).flatMap((s) => detectSecrets(s));
  if (found.length) {
    const kinds = [...new Set(found.map((f) => SECRET_LABEL[f.kind]))];
    return {
      status: 400,
      secret: true,
      error: `That looks like ${kinds.join(" and ")}. Blocklore never accepts seeds, keys or addresses, and it did not keep or send your report. If it is real, treat it as exposed.`,
    };
  }
  const p = Body.safeParse(body);
  if (!p.success) return { status: 400, error: REPORT_USAGE };
  const note = p.data.note === undefined ? "" : cleanNote(p.data.note);
  return { kind: p.data.kind, note: note || null };
}

/** The site's store, as intake needs it. */
export interface ReportStore {
  get(id: string): Promise<ReportItem | null>;
  /** Writes the report; `fresh` puts it where the brain's next pull finds it. */
  put(item: ReportItem, fresh: boolean): Promise<void>;
  /** Counts one more for `who` on `day` (a UTC date) and returns the new count. */
  count(who: string, day: string): Promise<number>;
}

export type ReportResult =
  | { ok: true; item: PublicReport; added: boolean }
  | { ok: false; status: 400 | 404 | 429; error: string };

/**
 * Takes one report. In order: the secret check and the shape (readReport), a published claim, the
 * site's daily cap, the visitor's daily cap (`visitor` is the site's daily-rotating hash of the
 * address, never the address), then a new report or one more count on the same one. Refusals for
 * content count toward no cap; a repeat counts toward both, as the suggestion queue does.
 */
export async function intakeReport(
  input: {
    claim: { id: string; hash: string } | null;
    body: unknown;
    visitor: string;
    now: Date;
  },
  store: ReportStore,
): Promise<ReportResult> {
  const r = readReport(input.body);
  if ("error" in r) return { ok: false, status: r.status, error: r.error };
  if (!input.claim)
    return { ok: false, status: 404, error: "No published claim has that id; nothing was kept." };
  const day = input.now.toISOString().slice(0, 10);
  if ((await store.count("site", day)) > REPORT_SITE_DAY)
    return {
      ok: false,
      status: 429,
      error: "Blocklore has taken all the reports it can today. Try again tomorrow.",
    };
  if ((await store.count(input.visitor, day)) > REPORT_VISITOR_DAY)
    return {
      ok: false,
      status: 429,
      error: `Each visitor can report ${REPORT_VISITOR_DAY} problems a day. Thank you; try again tomorrow.`,
    };
  const at = input.now.toISOString();
  const id = reportId(input.claim.id, r.kind, input.claim.hash);
  const old = await store.get(id);
  const note = r.note ? [{ at, text: r.note }] : [];
  const item: ReportItem = old
    ? {
        ...old,
        count: old.count + 1,
        last: at,
        notes: old.notes.some((n) => n.text === r.note)
          ? old.notes
          : [...old.notes, ...note].slice(-REPORT_NOTES_KEPT),
        updated: at,
      }
    : {
        id,
        claim: input.claim.id,
        kind: r.kind,
        hash: input.claim.hash,
        at,
        last: at,
        count: 1,
        status: "received",
        outcome: null,
        notes: note,
        updated: at,
      };
  // Every report, new or repeated, reaches the brain's next pull: a repeat may bring a new note.
  await store.put(item, true);
  return { ok: true, item: publicReport(item), added: !old };
}

/**
 * Why the brain's update cannot be applied, or null. The owner's dismissal wins over the brain,
 * and everything the brain says is public, so it keeps the house style and holds no secret (a
 * 64-hex hash in a failed check's detail is public chain data, not a key).
 */
export function reportUpdateProblem(old: ReportItem | null, u: ReportUpdate): string | null {
  if (!old) return `No report ${u.id}.`;
  if (old.status === "dismissed") return "The owner dismissed this report; it stays dismissed.";
  const text = [u.outcome.checked ?? "", ...u.outcome.problems];
  if (text.some(hasDash)) return "The outcome contains an em dash, en dash or horizontal bar.";
  const secret = text.flatMap((t) => detectSecrets(t)).filter((f) => f.kind !== "hex-64");
  if (secret.length) return "The outcome looks like it holds a secret.";
  if (u.status === "failed" && !u.outcome.problems.length)
    return "A failed recheck says what failed.";
  if (u.status !== "failed" && u.outcome.problems.length)
    return "Only a failed recheck lists problems.";
  return null;
}

/** The report after the brain's update (checked first with reportUpdateProblem). */
export function applyReportUpdate(old: ReportItem, u: ReportUpdate, at: string): ReportItem {
  return { ...old, status: u.status, outcome: u.outcome, updated: at };
}

/** The report after the owner's action: dismissed as abuse, or back to waiting for a recheck. */
export function applyOwnerAction(old: ReportItem, a: ReportOwnerAction, at: string): ReportItem {
  return a.action === "dismiss"
    ? { ...old, status: "dismissed", updated: at }
    : { ...old, status: "received", outcome: null, updated: at };
}

/** Public order: the most recently filed first, then by id. */
export function reportOrder(a: PublicReport, b: PublicReport): number {
  return b.last.localeCompare(a.last) || a.id.localeCompare(b.id);
}

/**
 * One sentence on what became of a report, in Blocklore's words, for every public surface. The run
 * that decided it is `outcome.run`; pages link it beside the sentence.
 */
export function reportOutcomeText(r: PublicReport): string {
  const o = r.outcome;
  const block = o ? `block ${o.at.height.toLocaleString("en-US")}` : "";
  const held = `the claim still holds as cited. ${o?.checked ? `Passed: ${o.checked}.` : "Every check passed."}`;
  switch (r.status) {
    case "received":
      return "Waiting for the brain's next recheck, which runs every hour.";
    case "holds":
      return `Rechecked at ${block}: ${held}`;
    case "failed":
      return `Rechecked at ${block}: the claim did not hold as cited. It is marked on its page until a correction lands or a later recheck passes.`;
    case "researching":
      return `Rechecked at ${block}: ${held} A research session will look for newer or contrary evidence.`;
    case "researched":
      return o?.changed
        ? `Researched at ${block}: the claim was revised, and its history shows what it said before.`
        : `Researched at ${block}: no newer or contrary evidence was found that changes the claim.`;
    case "dismissed":
      return "Dismissed by the owner as abuse.";
  }
}
