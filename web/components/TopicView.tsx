import {
  type BundleClaim,
  DEPTH_LABEL,
  DEPTH_RANK,
  DEPTHS,
  type Depth,
  type Rung,
  type Stamp,
  type Topic,
  type TopicGap,
} from "@blocklore/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { AsOfForm } from "@/components/AsOfForm";
import { ClaimLine } from "@/components/ClaimLine";
import { DepthDial } from "@/components/DepthDial";
import { Ladder } from "@/components/Ladder";
import { Page, PageHeader } from "@/components/ui";
import { GROUPS, getTopic } from "@/lib/data";
import { date, height, plural } from "@/lib/format";

/** Where the dial starts: enough to hold your own coins, with Builder and Researcher one tap away. */
const START: Depth = "holder";

export interface TopicViewProps {
  topic: Pick<Topic, "slug" | "title" | "group" | "contested" | "safety" | "related">;
  lede: BundleClaim | null;
  sections: { id: string; title: string; depth: Depth; claims: BundleClaim[] }[];
  /** Every claim the sections show, each once. */
  claims: BundleClaim[];
  ladder: Rung[];
  updated: Stamp | null;
  /** The live page only: claims waiting for closer checks, and the topic's open gaps. */
  pendingReview?: number;
  gap?: TopicGap;
  /** The live page only: debate maps filed under the topic. */
  debates?: { slug: string; question: string }[];
  /**
   * The time machine only: the moment as written in the URL, its name for the crumbs ("As of
   * block 976,771"), the notice that names it, and what to say when the topic had no claims yet.
   */
  at?: { path: string; label: string; notice: ReactNode; empty?: ReactNode };
}

/**
 * A topic page: its lede, its claims by section under the depth dial, and the rail. The live page
 * and the time machine render through here, so a topic looks the same now and as it stood then.
 */
export function TopicView({
  topic,
  lede,
  sections,
  claims,
  ladder,
  updated,
  pendingReview = 0,
  gap,
  debates = [],
  at,
}: TopicViewProps) {
  const there = at ? `/at/${at.path}` : "";
  const claimHref = (id: string) => `/claims/${id}${there}`;
  const group = GROUPS.find((g) => g.id === topic.group);
  const counts = DEPTHS.map(
    (d) => claims.filter((c) => DEPTH_RANK[c.depth] <= DEPTH_RANK[d]).length,
  );
  const sources = new Set(claims.flatMap((c) => c.sources.map((s) => s.url ?? s.locator))).size;
  const checks = claims.reduce((n, c) => n + (c.checks?.length ?? 0), 0);
  const related = (topic.related ?? []).map((s) => getTopic(s)).filter((t) => t !== undefined);
  const body = sections
    .map((s) => ({ ...s, items: s.claims.filter((c) => c.id !== lede?.id) }))
    .filter((s) => s.items.length > 0);
  let n = 0;

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: at ? `/topics/at/${at.path}` : "/topics", label: "Topics" },
          {
            href: `${at ? `/topics/at/${at.path}` : "/topics"}#${topic.group}`,
            label: group?.label ?? topic.group,
          },
          ...(at ? [{ label: at.label }] : []),
        ]}
        title={topic.title}
        lede={
          lede && (
            <p className="topic-lede">
              <Link href={claimHref(lede.id)} title="Sources, checks and history for this sentence">
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
            {updated && (
              <span>
                Updated {date(updated.time)}, block{" "}
                <span className="mono">{height(updated.height)}</span>
              </span>
            )}
            {topic.contested && <span className="badge badge-warn">Contested topic</span>}
            {pendingReview > 0 && (
              <span className="badge">{plural(pendingReview, "claim")} in review</span>
            )}
          </>
        }
      />
      {at?.notice}
      {lede?.recheck && (
        <p
          className="callout callout-bad"
          style={{ marginTop: "calc(var(--s5) * -1)", marginBottom: "var(--s6)" }}
        >
          <span>
            <strong>Recheck failed.</strong> The opening sentence did not hold as cited when its
            sources were read again at block {height(lede.recheck.at.height)}.{" "}
            <Link href={claimHref(lede.id)}>See what changed</Link>
          </span>
        </p>
      )}

      <div className="with-rail" id="topic" data-dial={DEPTHS.indexOf(START)}>
        <div>
          {claims.length === 0 && at?.empty}
          {claims.length > 0 && <DepthDial target="topic" counts={counts} initial={START} />}
          <noscript>
            <style>{"[data-dial] [data-d] { display: revert !important; }"}</style>
          </noscript>
          <div>
            {body.map((s) => {
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
                      return <ClaimLine key={c.id} claim={c} n={n} href={claimHref(c.id)} />;
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="rail" aria-label="On this page, sources and context">
          {body.length > 0 && (
            <section className="rail-block" aria-label="On this page">
              <h3>On this page</h3>
              <ul className="toc">
                {body.map((s) => (
                  <li key={s.id} data-d={Math.min(...s.items.map((c) => DEPTH_RANK[c.depth]))}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
          {debates.length > 0 && (
            <section className="rail-block" aria-labelledby="debates-h">
              <h3 id="debates-h">Debate maps</h3>
              <p>The positions side by side, and what evidence could settle.</p>
              <ul>
                {debates.map((d) => (
                  <li key={d.slug}>
                    <Link href={`/debates/${d.slug}`}>{d.question}</Link>
                  </li>
                ))}
              </ul>
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
          <Ladder rungs={ladder} />
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
                    <Link href={`/topics/${t.slug}${there}`}>{t.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!at && (
            <section className="rail-block" aria-labelledby="follow-h">
              <h3 id="follow-h">Follow this topic</h3>
              <p className="small muted">
                Every new claim and every change on this topic, as it publishes.
              </p>
              <ul>
                <li>
                  <a href={`/topics/${topic.slug}/changes.xml`}>Atom feed</a>
                </li>
              </ul>
            </section>
          )}
          <AsOfForm base={`/topics/${topic.slug}`} what="this topic" value={at?.path} />
        </aside>
      </div>
    </Page>
  );
}
