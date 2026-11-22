// The security watch's public events (core/src/feed.ts): an append-only log the daemon turns into
// FeedEvents of kind `watch` and `lab`. Only what is already public goes in: a watch's reading
// after it is written to knowledge/security/watches.json, a lab run after it is written to
// knowledge/security/lab.json. Anything embargoed never reaches this file.
//
//   var/security/events.jsonl
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FeedEvent } from "@blocklore/core/feed";
import { VAR } from "../env.ts";

export const SECURITY_DIR = process.env.BLOCKLORE_SECURITY_DIR || path.join(VAR, "security");
const LOG = () => path.join(SECURITY_DIR, "events.jsonl");

/** Appends one event; refuses anything that is not a valid public FeedEvent of kind watch or lab. */
export function logEvent(e: FeedEvent): FeedEvent {
  const ev = FeedEvent.parse(e);
  if (ev.kind !== "watch" && ev.kind !== "lab")
    throw new Error(`the security log takes watch and lab events, not ${ev.kind}`);
  mkdirSync(SECURITY_DIR, { recursive: true });
  appendFileSync(LOG(), `${JSON.stringify(ev)}\n`);
  return ev;
}

/**
 * The newest events, newest first, for the daemon's BrainFeed. Lines that no longer parse are
 * skipped, so a bad line can never break the feed.
 */
export function securityEvents(limit = 20, since?: string): FeedEvent[] {
  if (!existsSync(LOG())) return [];
  const out: FeedEvent[] = [];
  const lines = readFileSync(LOG(), "utf8").trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const ev = FeedEvent.parse(JSON.parse(lines[i] as string));
      if (since && ev.at <= since) break;
      out.push(ev);
    } catch {
      // skip
    }
  }
  return out;
}
