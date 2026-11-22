import { RELEASE_CHECK, watchSpec } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimLine } from "@/components/ClaimLine";
import {
  LevelChip,
  Sparkline,
  THREAT_HINT,
  THREAT_LABEL,
  ThreatChip,
  watchContext,
  watchValue,
} from "@/components/security/parts";
import s from "@/components/security/Security.module.css";
import { Block, Page, PageHeader } from "@/components/ui";
import { getTopic } from "@/lib/data";
import { date, dateTime, height, plural } from "@/lib/format";
import { allThreats, claimsOf, getThreat, layerLabel, watchById } from "@/lib/security";

export const dynamicParams = false;

export function generateStaticParams() {
  return allThreats().map((t) => ({ threat: t.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threat: string }>;
}): Promise<Metadata> {
  const t = getThreat((await params).threat);
  if (!t) return {};
  return {
    title: t.title,
    description: `${layerLabel(t.layer)}: ${THREAT_LABEL[t.live].toLowerCase()}. The published claims that explain it and what defends against it, the watches and the lab tests that cover it.`,
    alternates: { canonical: `/security/${t.id}` },
  };
}

export default async function ThreatPage({ params }: { params: Promise<{ threat: string }> }) {
  const t = getThreat((await params).threat);
  if (!t) notFound();
  const explains = claimsOf(t.published.claims);
  const defends = claimsOf(t.published.mitigations);
  const watches = t.watches.map((id) => ({ id, w: watchById(id) }));
  const tests = t.lab.map((name) => ({ name, r: t.results.find((x) => x.name === name) }));
  const topic = getTopic(t.topic);
  let n = 0;

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: "/security", label: "Security" },
          { href: `/security#${t.layer}`, label: layerLabel(t.layer) },
        ]}
        title={t.title}
        meta={
          <>
            <ThreatChip status={t.live} />
            <span>{THREAT_HINT[t.live]}</span>
            {t.raisedBy.length > 0 && (
              <span className={s.raised}>
                Raised from {THREAT_LABEL[t.status].toLowerCase()} by{" "}
                {t.raisedBy.map((id) => watchSpec(id).title.toLowerCase()).join(" and ")}
              </span>
            )}
          </>
        }
      />

      <Block id="what" title="What it is">
        {explains.length ? (
          <div className="claims">
            {explains.map((c) => {
              n += 1;
              return <ClaimLine key={c.id} claim={c} n={n} />;
            })}
          </div>
        ) : (
          <p className="empty">
            Being researched: no published claim explains it yet. It is on the brain&apos;s research
            list, and a claim appears here only once its sources check out.
          </p>
        )}
      </Block>

      <Block id="defenses" title="What defends against it">
        {defends.length ? (
          <div className="claims">
            {defends.map((c) => {
              n += 1;
              return <ClaimLine key={c.id} claim={c} n={n} />;
            })}
          </div>
        ) : (
          <p className="empty">
            Being researched: no published claim describes its defenses yet. It is on the
            brain&apos;s research list.
          </p>
        )}
      </Block>

      {watches.length > 0 && (
        <Block id="watches" title="What Blocklore watches">
          <div className="stack">
            {watches.map(({ id, w }) => {
              const spec = watchSpec(id);
              const context = w ? watchContext(w) : null;
              return (
                <section key={id} className="panel" aria-labelledby={`w-${id}`}>
                  <div className="panel-body">
                    <div className={s.readingTitle}>
                      <h3 id={`w-${id}`}>
                        <Link href={`/security#watch-${id}`}>{spec.title}</Link>
                      </h3>
                      <LevelChip level={w?.status ?? "unknown"} />
                    </div>
                    <div className={s.reading}>
                      <div>
                        <div className={s.readingValue}>
                          {w ? watchValue(w, spec) : "Not read yet"}
                        </div>
                        {context && <div className={s.readingNote}>{context}</div>}
                      </div>
                      {w && <Sparkline w={w} wide />}
                    </div>
                    <dl className={s.watchMore} style={{ margin: 0 }}>
                      <dt>Measures</dt>
                      <dd>{spec.measures}.</dd>
                      <dt>Thresholds</dt>
                      <dd>{spec.thresholds}</dd>
                      <dt>Source</dt>
                      <dd>{spec.source}.</dd>
                      {w && (
                        <>
                          <dt>Last read</dt>
                          <dd>
                            {dateTime(w.at)}
                            {w.height !== null && `, block ${height(w.height)}`}
                          </dd>
                        </>
                      )}
                    </dl>
                  </div>
                </section>
              );
            })}
          </div>
        </Block>
      )}

      {tests.length > 0 && (
        <Block
          id="lab"
          title="What the lab tests"
          aside={<span className="small muted">{plural(tests.length, "test")}</span>}
        >
          <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
            Bitcoin Core&apos;s own tests, run on a private test network against the newest release.
          </p>
          <ul className={s.tests}>
            {tests.map(({ name, r }) => (
              <li key={name}>
                <code>
                  {name === RELEASE_CHECK
                    ? "Download checked against SHA256SUMS and signatures"
                    : name}
                </code>
                {r ? (
                  <span className={`badge ${r.ok ? "badge-ok" : "badge-bad"}`}>
                    {r.ok ? "Passed" : "Failed"}
                  </span>
                ) : (
                  <span className="badge badge-outline">Not run yet</span>
                )}
                {r && (
                  <small>
                    Bitcoin Core {r.version}, {date(r.at)}
                  </small>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {t.history.length > 0 && (
        <Block id="history" title="Public record">
          <ul className="lines">
            {t.history.map((h) => (
              <li key={h.url + h.ref} className={s.advisory}>
                <a href={h.url} rel="noopener noreferrer">
                  {h.ref}
                </a>
                <span className={s.advisoryMeta}>
                  <span>{new URL(h.url).host.replace(/^www\./, "")}</span>
                  {h.date && <span>{h.date.length === 10 ? date(h.date) : h.date}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <aside className="rail block" aria-label="About this threat">
        <section className="rail-block">
          <h3>Where research files it</h3>
          <p>
            {topic ? <Link href={`/topics/${topic.slug}`}>{topic.title}</Link> : t.topic}
            {" in Knowledge. "}
            {plural(explains.length + defends.length, "published claim")} so far.
          </p>
        </section>
        <section className="rail-block">
          <h3>{layerLabel(t.layer)}</h3>
          <p>
            <Link href={`/security#${t.layer}`}>Every threat in this layer</Link>
          </p>
        </section>
      </aside>
    </Page>
  );
}
