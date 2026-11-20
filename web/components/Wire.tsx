import type { WireItem } from "@blocklore/core";
import { dateTime } from "@/lib/format";
import { FEED_LABEL } from "@/lib/sources";
import { TierTag } from "./bits";

/** Upstream items as their authors titled them, newest first. Text only; never HTML. */
export function Wire({ items }: { items: WireItem[] }) {
  return (
    <ol className="feed wire">
      {items.map((i) => (
        <li key={i.url}>
          <div className="when">{dateTime(i.published)}</div>
          <div>
            <div className="meta" style={{ marginTop: 0, marginBottom: "0.2rem" }}>
              <TierTag tier={i.tier} />
              <span>{FEED_LABEL[i.source] ?? i.source}</span>
            </div>
            <a
              className="what"
              href={i.url}
              rel="noopener noreferrer nofollow"
              style={{ color: "inherit" }}
            >
              {i.title}
            </a>
          </div>
        </li>
      ))}
    </ol>
  );
}
