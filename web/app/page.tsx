import Link from "next/link";
import { BrainDay, BrainEvents, BrainNext, BrainNow, BrainStatus } from "@/components/brain/Live";
import { ChangeFeed } from "@/components/ChangeFeed";
import { Block } from "@/components/ui";
import { bundle } from "@/lib/data";
import { height } from "@/lib/format";

// The Brain view, and the app's front door: what Blocklore is, in words a newcomer gets at once,
// and what its research brain is doing this minute. The live parts come from /api/v1/brain on the
// client; everything else is the published store.

export default function BrainView() {
  const s = bundle.stats;
  const snap = bundle.snapshots[0];
  const anchor = snap?.proof?.blocks[0]?.height ?? snap?.at.height;
  const primary = s.claims ? Math.round((s.withPrimary / s.claims) * 100) : 0;
  const recent = [...bundle.events].sort((a, b) => b.at.time.localeCompare(a.at.time)).slice(0, 4);
  const learning = bundle.gaps.topics.filter((t) => t.score > 0).slice(0, 3);
  const topics = [...bundle.topics].sort((a, b) => b.claimCount - a.claimCount).slice(0, 8);

  return (
    <>
      <section className="brain-hero" aria-labelledby="hero-h">
        <BrainStatus />
        <h1 id="hero-h">A library of Bitcoin facts that checks itself.</h1>
        <p>
          Blocklore's research brain reads Bitcoin's primary sources around the clock: the code, the
          proposals, the mailing lists and the chain itself. Every fact it keeps shows its source
          and the exact quote, gets checked again and again, and is sealed in a Bitcoin block, so
          anyone can prove what it said and when.
        </p>
      </section>

      <section className="brain-live" aria-label="The brain, right now">
        <BrainNow />
        <BrainDay />
      </section>

      <ol className="brain-steps" aria-label="How it works">
        <li>
          <span className="brain-step-n">1</span>
          <h2>It reads</h2>
          <p>
            Code, proposals, mailing lists, forums and the chain.{" "}
            <strong>{s.sources.toLocaleString("en-US")}</strong> sources cited so far.
          </p>
        </li>
        <li>
          <span className="brain-step-n">2</span>
          <h2>It checks</h2>
          <p>
            Code confirms each quote is really at its link and each number matches the chain, then
            an independent verifier tries to break the fact. <strong>{s.checks}</strong> machine
            checks.
          </p>
        </li>
        <li>
          <span className="brain-step-n">3</span>
          <h2>It seals</h2>
          <p>
            Each edition is timestamped in a Bitcoin block, so no one can quietly rewrite it.
            {anchor ? (
              <>
                {" "}
                Last sealed in <Link href="/verify">block {height(anchor)}</Link>.
              </>
            ) : null}
          </p>
        </li>
      </ol>

      <Block id="did" title="What it did lately" aside={<Link href="/log">Research log</Link>}>
        <BrainEvents />
        <BrainNext />
      </Block>

      <Block id="knows" title="What it knows" aside={<Link href="/topics">All topics</Link>}>
        <p className="brain-knows">
          <strong>{s.claims.toLocaleString("en-US")}</strong> facts in{" "}
          <strong>{bundle.topics.length}</strong> topics, <strong>{primary}%</strong> backed by a
          primary source.
        </p>
        <ul className="brain-topics">
          {topics.map((t) => (
            <li key={t.slug}>
              <Link href={`/topics/${t.slug}`}>
                {t.title}
                <span className="muted">{t.claimCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Block>

      {learning.length > 0 && (
        <Block id="next" title="Learning next" aside={<Link href="/gaps">Every gap</Link>}>
          <ul className="rows">
            {learning.map((t) => (
              <li key={t.slug} className="row-item">
                <p>
                  <Link href={`/topics/${t.slug}`}>{t.title ?? t.slug}</Link>
                  <span className="muted">
                    {" "}
                    {[
                      t.thin.length ? `thin at ${t.thin.map((x) => x.depth).join(", ")}` : null,
                      t.questions.length ? `${t.questions.length} open questions` : null,
                      t.rechecks.length ? `${t.rechecks.length} to correct` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block id="changes" title="Latest changes" aside={<Link href="/changes">Every change</Link>}>
        {recent.length ? (
          <ChangeFeed events={recent} compact />
        ) : (
          <p className="empty">No changes yet.</p>
        )}
      </Block>

      <section className="brain-connect" aria-labelledby="connect-h">
        <h2 id="connect-h">Bring your own AI</h2>
        <p>
          Blocklore runs no AI for you. Connect your own assistant and it reads these facts, with
          their sources, and cites them.
        </p>
        <Link className="btn btn-primary" href="/connect">
          Connect your AI
        </Link>
      </section>
    </>
  );
}
