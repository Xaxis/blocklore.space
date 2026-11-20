import type { BundleTopic } from "@blocklore/core";
import Link from "next/link";
import { getClaim } from "@/lib/data";
import { date, plural } from "@/lib/format";

export function TopicCard({ topic }: { topic: BundleTopic }) {
  const lede = getClaim(topic.lede);
  return (
    <Link href={`/topics/${topic.slug}`} className="topic-card">
      <h3>{topic.title}</h3>
      {lede && <p>{lede.statement}</p>}
      <footer>
        <span>{plural(topic.claimCount, "claim")}</span>
        <span aria-hidden="true">·</span>
        <span>updated {date(topic.updated.time)}</span>
        {topic.contested && <span className="chip contested">Contested</span>}
        {topic.safety && <span className="chip plain">Safety</span>}
        {topic.pendingReview > 0 && (
          <span className="chip plain">{topic.pendingReview} awaiting review</span>
        )}
      </footer>
    </Link>
  );
}

/** A topic with claims waiting for the owner and none published yet. */
export function WaitingCard({ slug, count }: { slug: string; count: number }) {
  return (
    <div className="topic-card waiting">
      <h3>{slug.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase())}</h3>
      <p>
        {plural(count, "claim")} researched and checked, waiting for the owner&apos;s review because
        the topic is contested or touches safety.
      </p>
      <footer>
        <span className="chip plain">Under review</span>
      </footer>
    </div>
  );
}
