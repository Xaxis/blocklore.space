import Link from "next/link";
import { ChangeFeed } from "@/components/ChangeFeed";
import { TopicTable } from "@/components/TopicTable";
import { Block } from "@/components/ui";
import { bundle } from "@/lib/data";
import { height } from "@/lib/format";

export default function Explore() {
  const s = bundle.stats;
  const recent = [...bundle.events].sort((a, b) => b.at.time.localeCompare(a.at.time)).slice(0, 5);
  const primaryShare = s.claims ? Math.round((s.withPrimary / s.claims) * 100) : 0;
  const snap = bundle.snapshots[0];
  const anchor = snap?.proof?.blocks[0]?.height;

  return (
    <>
      <section className="explore-intro" aria-labelledby="intro-h">
        <h1 id="intro-h">The verifiable state of Bitcoin knowledge.</h1>
        <p>
          What is settled, what is contested and what changed. Every sentence is a claim with its
          sources, a quote that code found at each link, and checks against the chain and the code
          you can run on your own node. Pick a topic here or in the model of the store beside this
          panel.
        </p>
        <p className="explore-facts">
          <span>
            <strong>{s.claims.toLocaleString("en-US")}</strong> claims
          </span>
          <span>
            <strong>{s.sources.toLocaleString("en-US")}</strong> sources
          </span>
          <span>
            <strong>{s.checks.toLocaleString("en-US")}</strong> machine checks
          </span>
          <span>
            <strong>{primaryShare}%</strong> with a primary source
          </span>
          {anchor && (
            <span>
              timestamped in block <strong>{height(anchor)}</strong>
            </span>
          )}
        </p>
      </section>

      <Block id="topics" title="Topics">
        <TopicTable />
      </Block>

      <Block id="changes" title="Latest changes" aside={<Link href="/changes">Every change</Link>}>
        {recent.length ? (
          <ChangeFeed events={recent} compact />
        ) : (
          <p className="empty">No changes yet.</p>
        )}
      </Block>

      <Block id="next" title="Go further">
        <ul className="rows">
          <li className="row-item">
            <p>
              <Link href="/connect">Connect your own model</Link>: your assistant reads these claims
              over MCP and cites them.
            </p>
          </li>
          <li className="row-item">
            <p>
              <Link href="/gaps">What it does not know</Link>, and where to suggest a question.
            </p>
          </li>
          <li className="row-item">
            <p>
              <Link href="/about">How a claim gets here</Link>, and{" "}
              <Link href="/verify">how to check this edition</Link> against Bitcoin yourself.
            </p>
          </li>
        </ul>
      </Block>
    </>
  );
}
