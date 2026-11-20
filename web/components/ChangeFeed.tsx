import type { ChangeEvent } from "@blocklore/core";
import Link from "next/link";
import { dateTime, height } from "@/lib/format";

const VERB: Record<ChangeEvent["change"], string> = {
  created: "New",
  corrected: "Corrected",
  refined: "Refined",
  sources: "Sources",
  status: "Status",
  confidence: "Confidence",
  depth: "Depth",
  superseded: "Superseded",
  reviewed: "Reviewed",
};

export function ChangeFeed({ events }: { events: ChangeEvent[] }) {
  return (
    <ol className="feed">
      {events.map((e) => (
        <li key={`${e.claim}-${e.rev}`}>
          <div className="when">
            <div>{dateTime(e.at.time)}</div>
            <div>block {height(e.at.height)}</div>
          </div>
          <div>
            <span className={`change ${e.change}`}>{VERB[e.change]}</span>
            <div className="what">
              <Link
                href={`/claims/${e.claim}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {e.statement}
              </Link>
            </div>
            {e.before?.statement && e.before.statement !== e.statement && (
              <div className="diff">
                <del>{e.before.statement}</del>
              </div>
            )}
            <div className="meta">
              {e.note && <span>{e.note}</span>}
              <Link href={`/log/${e.run}`}>run {e.run}</Link>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
