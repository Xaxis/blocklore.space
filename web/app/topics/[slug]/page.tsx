import { DEPTH_LABEL, DEPTH_RANK, DEPTHS, type Depth } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimLine } from "@/components/ClaimLine";
import { DepthDial } from "@/components/DepthDial";
import { Ladder } from "@/components/Ladder";
import { Page, PageHeader } from "@/components/ui";
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
  const gap = bundle.gaps.topics.find((g) => g.slug === topic.slug);
  const group = GROUPS.find((g) => g.id === topic.group);
  const counts = DEPTHS.map((d) => countAtDepth(topic, d));
  const sources = new Set(claims.flatMap((c) => c.sources.map((s) => s.url ?? s.locator))).size;
  const checks = claims.reduce((n, c) => n + (c.checks?.length ?? 0), 0);
  const related = (topic.related ?? []).map((s) => getTopic(s)).filter((t) => t !== undefined);
  const sections = topic.sections
    .map((s) => ({
      ...s,
      items: s.claims
        .filter((id) => id !== topic.lede)
        .map((id) => getClaim(id))
        .filter((c) => c !== undefined),
    }))
    .filter((s) => s.items.length > 0);
  let n = 0;

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: "/topics", label: "Topics" },
          { href: `/topics#${topic.group}`, label: group?.label ?? topic.group },
        ]}
        title={topic.title}
        lede={
          lede && (
            <p className="topic-lede">
              <Link
                href={`/claims/${lede.id}`}
                title="Sources, checks and history for this sentence"
              >
                {lede.statement}
                <span className="cite">sources</span>
              </Link>
            </p>
          )
        }
        meta={
          <>
            <span>{plural(claims.length, "claim")}</span>
            <span>{plural(sources, "source")}</span>
            <span>{plural(checks, "machine check")}</span>
            <span>
              Updated {date(topic.updated.time)}, block{" "}
              <span className="mono">{height(topic.updated.height)}</span>
            </span>
            {topic.contested && <span className="badge badge-warn">Contested topic</span>}
            {topic.pendingReview > 0 && (
              <span className="badge">{plural(topic.pendingReview, "claim")} in review</span>
            )}
          </>
        }
      />
      {lede?.recheck && (
        <p
          className="callout callout-bad"
          style={{ marginTop: "calc(var(--s5) * -1)", marginBottom: "var(--s6)" }}
        >
          <span>
            <strong>Recheck failed.</strong> The opening sentence did not hold as cited when its
            sources were read again at block {height(lede.recheck.at.height)}.{" "}
            <Link href={`/claims/${lede.id}`}>See what changed</Link>
          </span>
        </p>
      )}

      <div className="with-rail" id="topic" data-dial={DEPTHS.indexOf(START)}>
        <div>
          <DepthDial target="topic" counts={counts} initial={START} />
          <noscript>
            <style>{"[data-dial] [data-d] { display: revert !important; }"}</style>
          </noscript>
          <div>
            {sections.map((s) => {
              const shallowest = Math.min(...s.items.map((c) => DEPTH_RANK[c.depth]));
              return (
                <section className="topic-section" key={s.id} id={s.id} data-d={shallowest}>
                  <h2>
                    {s.title}
                    <small>{DEPTH_LABEL[s.depth]}</small>
                  </h2>
                  <div className="claims">
                    {s.items.map((c) => {
                      n += 1;
                      return <ClaimLine key={c.id} claim={c} n={n} />;
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="rail" aria-label="On this page, sources and context">
          <section className="rail-block" aria-label="On this page">
            <h3>On this page</h3>
            <ul className="toc">
              {sections.map((s) => (
                <li key={s.id} data-d={Math.min(...s.items.map((c) => DEPTH_RANK[c.depth]))}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ul>
          </section>
          {topic.contested && (
            <section className="rail-block callout callout-warn" aria-label="A contested topic">
              <h3>A contested topic</h3>
              <p>
                Informed people disagree here. Positions are attributed, dated and in their
                proponents&apos; own words. Blocklore takes no side on questions of value, and the
                owner reviewed every claim before it was published.
              </p>
            </section>
          )}
          {topic.safety && (
            <section className="rail-block callout callout-info" aria-label="Safety">
              <h3>Safety</h3>
              <p>
                Blocklore never asks for a seed phrase, a key, an xpub or an address, and nobody
                legitimate will. The owner reviewed every safety claim before it was published.
              </p>
            </section>
          )}
          <Ladder rungs={topic.ladder} />
          {gap && gap.score > 0 && (
            <section className="rail-block" aria-label="Open gaps">
              <h3>Not covered yet</h3>
              <p>
                {gap.questions.length > 0
                  ? `${plural(gap.questions.length, "question")} near this topic that the claims answer only in part.`
                  : "Depths with few claims, or claims to recheck."}{" "}
                <Link href={`/gaps#${topic.slug}`}>Open gaps</Link>
              </p>
            </section>
          )}
          {related.length > 0 && (
            <section className="rail-block" aria-label="Related topics">
              <h3>Related topics</h3>
              <ul>
                {related.map((t) => (
                  <li key={t.slug}>
                    <Link href={`/topics/${t.slug}`}>{t.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </Page>
  );
}
