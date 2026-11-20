import Link from "next/link";
import { ChangeFeed } from "@/components/ChangeFeed";
import { TopicCard, WaitingCard } from "@/components/TopicCard";
import { bundle, GROUPS } from "@/lib/data";
import { height } from "@/lib/format";

export default function Home() {
  const s = bundle.stats;
  const published = new Set(bundle.topics.map((t) => t.slug));
  const waiting = bundle.review.filter((r) => !published.has(r.topic) && r.count > 0);
  const recent = [...bundle.events].sort((a, b) => b.at.time.localeCompare(a.at.time)).slice(0, 8);
  const primaryShare = s.claims ? Math.round((s.withPrimary / s.claims) * 100) : 0;

  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <p className="eyebrow">Bitcoin knowledge, with receipts</p>
          <h1>
            What is true about Bitcoin, <em>and how to check it yourself.</em>
          </h1>
          <p className="lede">
            What is settled, what is contested and what changed. Every sentence is a claim with its
            sources, quotes that code found at each link, and checks against the chain and the code
            that you can run on your own node.
          </p>
          <p style={{ marginTop: "1.5rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <Link className="pill-link" href="/topics">
              Browse the topics
            </Link>
            <Link className="pill-link" href="/about">
              How a sentence gets here
            </Link>
          </p>
        </div>
        <aside className="ledger" aria-label="The store in numbers">
          <header>
            <span>This edition</span>
            <span>block {height(bundle.generated.height)}</span>
          </header>
          <dl>
            <dt>Claims published</dt>
            <dd>{s.claims.toLocaleString("en-US")}</dd>
            <dt>Topics</dt>
            <dd>{s.topics}</dd>
            <dt>Sources cited</dt>
            <dd>{s.sources.toLocaleString("en-US")}</dd>
            <dt>Machine checks against chain and code</dt>
            <dd>{s.checks.toLocaleString("en-US")}</dd>
            <dt>Claims with a primary source</dt>
            <dd>{primaryShare}%</dd>
            <dt>Re-checked in the last 7 days</dt>
            <dd>{s.verifiedWithin7Days.toLocaleString("en-US")}</dd>
            <dt>Waiting for the owner&apos;s review</dt>
            <dd>{s.pendingReview}</dd>
            <dt>Corrections</dt>
            <dd>
              <Link href="/changes/corrections">{s.corrections}</Link>
            </dd>
          </dl>
        </aside>
      </section>

      <section aria-labelledby="pipeline-h">
        <div className="section-head">
          <h2 id="pipeline-h">How a sentence gets here</h2>
          <Link href="/about">The full method</Link>
        </div>
        <ol className="pipeline">
          <li className="model">
            <strong>Research</strong>
            <span>
              A model reads the code, the BIPs, the chain and the archives, and drafts claims with
              exact quotes.
            </span>
          </li>
          <li className="code">
            <strong>Check</strong>
            <span>
              Code fetches every link, finds every quote, and runs each claim&apos;s checks against
              the chain and the code.
            </span>
          </li>
          <li className="model">
            <strong>Falsify</strong>
            <span>
              A second model, with fresh context and no stake in the draft, tries to break each
              claim.
            </span>
          </li>
          <li className="code">
            <strong>Gate</strong>
            <span>Contested topics, safety advice, stances and named people stop here.</span>
          </li>
          <li className="person">
            <strong>Review</strong>
            <span>The owner approves or rejects what the gate held. No model can.</span>
          </li>
          <li className="code">
            <strong>Publish</strong>
            <span>
              Committed to git, hashed, and every later change logged with what it replaced.
            </span>
          </li>
        </ol>
        <div className="legend">
          <span>
            <i style={{ background: "var(--speculative)" }} />a model
          </span>
          <span>
            <i style={{ background: "var(--ink)" }} />
            deterministic code
          </span>
          <span>
            <i style={{ background: "var(--btc)" }} />a person
          </span>
        </div>
      </section>

      <section aria-labelledby="topics-h">
        <div className="section-head">
          <h2 id="topics-h">Topics</h2>
          <Link href="/topics">All topics</Link>
        </div>
        {bundle.topics.length === 0 && waiting.length === 0 ? (
          <p className="callout">
            The first edition is being researched now. Each topic appears here once its claims have
            passed every check.
          </p>
        ) : (
          <div className="topic-grid">
            {GROUPS.flatMap((g) => bundle.topics.filter((t) => t.group === g.id)).map((t) => (
              <TopicCard key={t.slug} topic={t} />
            ))}
            {waiting.map((w) => (
              <WaitingCard key={w.topic} slug={w.topic} count={w.count} />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="changes-h">
          <div className="section-head">
            <h2 id="changes-h">Latest changes</h2>
            <Link href="/changes">Every change</Link>
          </div>
          <ChangeFeed events={recent} />
        </section>
      )}
    </div>
  );
}
