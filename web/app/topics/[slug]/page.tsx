import { DEPTH_LABEL, DEPTH_RANK, DEPTHS, type Depth } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimLine } from "@/components/ClaimLine";
import { DepthDial } from "@/components/DepthDial";
import { Ladder } from "@/components/Ladder";
import { bundle, countAtDepth, GROUPS, getClaim, getTopic, topicClaims } from "@/lib/data";
import { date, height, plural } from "@/lib/format";

export const dynamicParams = false;

/** Where the dial starts: enough to hold your own coins, with Builder and Researcher one tap away. */
const START: Depth = "holder";

export function generateStaticParams() {
  return bundle.topics.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const t = getTopic((await params).slug);
  if (!t) return {};
  return {
    title: t.title,
    description: getClaim(t.lede)?.statement,
    alternates: { canonical: `/topics/${t.slug}` },
  };
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = getTopic((await params).slug);
  if (!topic) notFound();
  const claims = topicClaims(topic);
  const lede = getClaim(topic.lede);
  const group = GROUPS.find((g) => g.id === topic.group);
  const counts = DEPTHS.map((d) => countAtDepth(topic, d));
  const sources = new Set(claims.flatMap((c) => c.sources.map((s) => s.url ?? s.locator))).size;
  const checks = claims.reduce((n, c) => n + (c.checks?.length ?? 0), 0);
  const related = (topic.related ?? []).map((s) => getTopic(s)).filter((t) => t !== undefined);
  let n = 0;

  return (
    <div className="wrap">
      <header className="topic-head">
        <div className="crumbs">
          <Link href="/topics">Topics</Link> / {group?.label}
        </div>
        <h1>{topic.title}</h1>
        {lede && (
          <p className="lede">
            <Link href={`/claims/${lede.id}`} title="Sources, checks and history for this sentence">
              {lede.statement}
              <span className="cite">sources</span>
            </Link>
          </p>
        )}
        {lede?.recheck && (
          <p className="lede-recheck">
            <span className="chip warn">Recheck failed</span>{" "}
            <Link href={`/claims/${lede.id}`}>
              This sentence did not hold as cited at block {height(lede.recheck.at.height)}
            </Link>
          </p>
        )}
        <div className="facts">
          <span>{plural(claims.length, "claim")}</span>
          <span>{plural(sources, "source")}</span>
          <span>{plural(checks, "machine check")}</span>
          <span>
            updated {date(topic.updated.time)} at block {height(topic.updated.height)}
          </span>
          {topic.contested && <span className="chip contested">Contested topic</span>}
          {topic.pendingReview > 0 && (
            <span className="chip plain">
              {plural(topic.pendingReview, "claim")} awaiting review
            </span>
          )}
        </div>
      </header>

      <div className="topic-layout">
        <div>
          <DepthDial target="topic-body" counts={counts} initial={START} />
          <noscript>
            <style>{"[data-dial] [data-d] { display: revert !important; }"}</style>
          </noscript>
          <div id="topic-body" data-dial={DEPTHS.indexOf(START)}>
            {topic.sections.map((s) => {
              // The lede already opens the page; the body does not repeat it.
              const inSection = s.claims
                .filter((id) => id !== topic.lede)
                .map((id) => getClaim(id))
                .filter((c) => c !== undefined);
              if (inSection.length === 0) return null;
              const shallowest = Math.min(...inSection.map((c) => DEPTH_RANK[c.depth]));
              return (
                <section className="prose-section" key={s.id} id={s.id} data-d={shallowest}>
                  <h2>
                    {s.title}
                    <span className="depth-tag">{DEPTH_LABEL[s.depth]}</span>
                  </h2>
                  {inSection.map((c) => {
                    n += 1;
                    return <ClaimLine key={c.id} claim={c} n={n} />;
                  })}
                </section>
              );
            })}
          </div>
        </div>

        <aside className="rail" aria-label="Sources and context">
          {topic.contested && (
            <div className="side-box">
              <h3>A contested topic</h3>
              <p>
                Informed people disagree here. Positions are attributed, dated and given in their
                proponents&apos; own words, and Blocklore takes no side on questions of value. Every
                claim on this page was reviewed by the owner before it was published.
              </p>
            </div>
          )}
          {topic.safety && (
            <div className="side-box">
              <h3>Safety</h3>
              <p>
                Blocklore never asks for a seed phrase, a key, an xpub or an address, and nobody
                legitimate will. Safety claims were reviewed by the owner before they were
                published.
              </p>
            </div>
          )}
          <Ladder rungs={topic.ladder} />
          {related.length > 0 && (
            <div className="side-box">
              <h3>Related topics</h3>
              {related.map((t) => (
                <Link key={t.slug} href={`/topics/${t.slug}`}>
                  {t.title}
                </Link>
              ))}
            </div>
          )}
          <div className="side-box">
            <h3>Open a claim</h3>
            <p>
              Each sentence opens to show its sources, the exact quote code found at each link, and
              the command to repeat every check yourself.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
