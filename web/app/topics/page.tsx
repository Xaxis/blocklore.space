import type { Metadata } from "next";
import { TopicCard, WaitingCard } from "@/components/TopicCard";
import { bundle, GROUPS } from "@/lib/data";

export const metadata: Metadata = {
  title: "Topics",
  description: "Every topic Blocklore covers, each made of claims with sources and checks.",
};

export default function Topics() {
  const published = new Set(bundle.topics.map((t) => t.slug));
  const waiting = bundle.review.filter((r) => !published.has(r.topic) && r.count > 0);
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Topics</h1>
        <p className="lede">
          Each topic is a set of claims in reading order. Open any sentence to see its sources and
          how to check it.
        </p>
      </header>
      {GROUPS.map((g) => {
        const topics = bundle.topics.filter((t) => t.group === g.id);
        if (topics.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`g-${g.id}`}>
            <div className="section-head">
              <h2 id={`g-${g.id}`}>{g.label}</h2>
              <span className="muted">{g.blurb}</span>
            </div>
            <div className="topic-grid">
              {topics.map((t) => (
                <TopicCard key={t.slug} topic={t} />
              ))}
            </div>
          </section>
        );
      })}
      {waiting.length > 0 && (
        <section aria-labelledby="g-waiting">
          <div className="section-head">
            <h2 id="g-waiting">Under review</h2>
            <span className="muted">Researched and checked; waiting for the owner.</span>
          </div>
          <div className="topic-grid">
            {waiting.map((w) => (
              <WaitingCard key={w.topic} slug={w.topic} count={w.count} />
            ))}
          </div>
        </section>
      )}
      {bundle.topics.length === 0 && waiting.length === 0 && (
        <p className="callout">
          The first edition is being researched now. Topics appear here once their claims pass every
          check.
        </p>
      )}
    </div>
  );
}
