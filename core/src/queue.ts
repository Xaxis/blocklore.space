// The public research queue, the pure part: what a queued question looks like, how one is cleaned
// and identified, and what the brain may say about it. Questions arrive only from Ask results the
// model judged to be about Bitcoin and not yet covered (the site checks a ticket for that).
import { z } from "zod";
import { sha256Hex } from "./hash.ts";
import { claimId } from "./schema.ts";

export const QUEUE_STATUSES = ["queued", "researching", "answered", "declined"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "Waiting",
  researching: "Being researched",
  answered: "Answered",
  declined: "Declined",
};

/** Questions each visitor may queue per UTC day. */
export const QUEUE_VISITOR_DAY = 5;

export const QueueItem = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  q: z.string().min(1).max(300),
  /** What Ask said Blocklore does not cover yet, when it said. */
  missing: z.string().max(300).nullable(),
  /** ISO time the question was first queued. */
  at: z.string(),
  /** How many times readers queued it. */
  asks: z.number().int().min(1),
  status: z.enum(QUEUE_STATUSES),
  /** For answered: the published claims that answer it now. */
  claims: z.array(claimId),
  /** For declined, or a note from the brain: in Blocklore's words, at most 300 characters. */
  note: z.string().max(300).nullable(),
  updated: z.string(),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const QueueUpdate = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  status: z.enum(QUEUE_STATUSES),
  claims: z.array(claimId).max(12).optional(),
  note: z.string().max(300).nullable().optional(),
});
export type QueueUpdate = z.infer<typeof QueueUpdate>;

// Ways to reach someone or somewhere: links, bare domains, email addresses, Nostr keys, handles.
const CONTACT = [
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|xyz|space|dev|info|me|co|app)\b(?:\/\S*)?/gi,
  /\b(?:npub|nprofile|nsec)1[02-9ac-hj-np-z]{20,}\b/gi,
  /(^|\s)@[\w.]{2,}/g,
];

/** A question as it may appear in public: contacts and links removed, whitespace collapsed. */
export function cleanQuestion(q: string): string {
  return CONTACT.reduce((s, re) => s.replace(re, " "), q)
    .replace(/\s+/g, " ")
    .trim();
}

/** The same question asked twice, in any case or punctuation, has one id. */
export function queueId(q: string): string {
  const norm = cleanQuestion(q)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return sha256Hex(norm).slice(0, 16);
}

/** Public order: answered last; among the rest, the most asked first, then the oldest. */
export function queueOrder(a: QueueItem, b: QueueItem): number {
  const rank = (s: QueueStatus) => (s === "answered" ? 1 : 0);
  return rank(a.status) - rank(b.status) || b.asks - a.asks || a.at.localeCompare(b.at);
}
