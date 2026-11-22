// The security watch's public events (core/src/feed.ts): FeedEvents of kind `watch` and `lab`,
// written to the brain's one public feed log (brain/src/feed.ts), which the daemon sends to the
// site. Only what is already public goes in: a watch's reading after it is written to
// knowledge/security/watches.json, a lab run after it is written to knowledge/security/lab.json.
// Anything embargoed never reaches this log.
import path from "node:path";
import { FeedEvent } from "@blocklore/core/feed";
import { VAR } from "../env.ts";
import { feedEvent, feedEvents } from "../feed.ts";

/** The security watch's private working state (the blocks it follows, the lab's downloads). */
export const SECURITY_DIR = process.env.BLOCKLORE_SECURITY_DIR || path.join(VAR, "security");

/** Logs one event; refuses anything that is not a valid public FeedEvent of kind watch or lab. */
export function logEvent(e: FeedEvent): FeedEvent {
  const ev = FeedEvent.parse(e);
  if (ev.kind !== "watch" && ev.kind !== "lab")
    throw new Error(`the security watch logs watch and lab events, not ${ev.kind}`);
  feedEvent(ev);
  return ev;
}

/** The security events in the public feed, newest first, after `since` when given. */
export function securityEvents(limit = 20, since?: string, now = new Date()): FeedEvent[] {
  return feedEvents(now)
    .filter((e) => (e.kind === "watch" || e.kind === "lab") && (!since || e.at > since))
    .slice(0, limit);
}
