import type { ChangeEvent } from "@blocklore/core";
import Link from "next/link";
import { dateTime } from "@/lib/format";
import { FeedItem } from "./ui";

const VERB: Record<ChangeEvent["change"], { label: string; tone: string }> = {
  created: { label: "New", tone: "badge-ok" },
  corrected: { label: "Corrected", tone: "badge-bad" },
  refined: { label: "Refined", tone: "badge-info" },
  sources: { label: "Sources", tone: "" },
  status: { label: "Status", tone: "badge-warn" },
  confidence: { label: "Confidence", tone: "" },
  depth: { label: "Depth", tone: "" },
  superseded: { label: "Superseded", tone: "badge-outline" },
  reviewed: { label: "Reviewed", tone: "badge-accent" },
  withdrawn: { label: "Withdrawn", tone: "badge-bad" },
};

/** Changes to claims, newest first: what it says now, what it said before, and the run. */
export function ChangeFeed({ events, compact }: { events: ChangeEvent[]; compact?: boolean }) {
  return (
    <ol className={compact ? "feed compact" : "feed"}>
      {events.map((e) => (
        <FeedItem key={`${e.claim}-${e.rev}`} when={dateTime(e.at.time)} block={e.at.height}>
          <p>
            <span className={`badge ${VERB[e.change].tone}`}>{VERB[e.change].label}</span>{" "}
            <Link href={`/claims/${e.claim}`} style={{ textDecoration: "none" }}>
              {e.statement}
            </Link>
          </p>
          {!compact && e.before?.statement && e.before.statement !== e.statement && (
            <p className="small muted">
              Before: <del>{e.before.statement}</del>
            </p>
          )}
          {!compact && (
            <div className="feed-meta">
              {e.note && <span>{e.note}</span>}
              <Link href={`/log/${e.run}`}>Run {e.run}</Link>
            </div>
          )}
        </FeedItem>
      ))}
    </ol>
  );
}
