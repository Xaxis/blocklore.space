import type { WireItem } from "@blocklore/core";
import { dateTime } from "@/lib/format";
import { FEED_LABEL } from "@/lib/sources";
import { TierTag } from "./bits";
import { FeedItem } from "./ui";

/** Upstream items as their authors titled them, newest first. Text only; never HTML. */
export function Wire({ items }: { items: WireItem[] }) {
  return (
    <ol className="feed">
      {items.map((i) => (
        <FeedItem key={i.url} when={dateTime(i.published)}>
          <div className="feed-title">
            <TierTag tier={i.tier} />
            <span className="small muted">{FEED_LABEL[i.source] ?? i.source}</span>
          </div>
          <p>
            <a href={i.url} rel="noopener noreferrer nofollow">
              {i.title}
            </a>
          </p>
        </FeedItem>
      ))}
    </ol>
  );
}
