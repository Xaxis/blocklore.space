import { idsIn, labTestLabel, labTestProject, SECP256K1_PREFIX, watchSpec } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimLine } from "@/components/ClaimLine";
import {
  Advisories,
  CveChecks,
  LabMatrix,
  LevelChip,
  matchReason,
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
import { allThreats, claimsOf, getThreat, layerLabel, security, watchById } from "@/lib/security";

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
    description: `${layerLabel(t.layer)}: ${THREAT_LABEL[t.live].toLowerCase()}. The published claims that explain it and what defends against it, its advisories, the watches and the lab tests that cover it.`,
    alternates: { canonical: `/security/${t.id}` },
  };
}

export default async function ThreatPage({ params }: { params: Promise<{ threat: string }> }) {
  const t = getThreat((await params).threat);
  if (!t) notFound();
  const explains = claimsOf(t.published.claims);
  const defends = claimsOf(t.published.mitigations);
  const watches = t.watches.map((id) => ({ id, w: watchById(id) }));
  const tests = t.lab.map((name) => ({
    name,
    label: labTestLabel(name),
    results: t.results.filter((x) => x.name === name),
  }));
  const topic = getTopic(t.topic);
  const findings = t.cves.filter((c) => c.finding);
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
            {tests.some((x) => labTestProject(x.name) === "bitcoin-core") && (
              <>
                Bitcoin Core&apos;s own tests, run on a private test network against the newest
                release of each major version Bitcoin Core maintains, newest first. An older release
                runs the tests it has.{" "}
              </>
            )}
            {tests.some((x) => x.name.startsWith(SECP256K1_PREFIX)) && (
              <>
                The libsecp256k1 rows are that library&apos;s own test programs, built from the copy
                each release ships with the modules Bitcoin Core turns on, in their default
                settings.{" "}
              </>
            )}
            {tests.some((x) => labTestProject(x.name) === "lnd") && (
              <>
                The LND rows are LND&apos;s own unit tests, one Go package each, built from the
                source of its newest release once the release&apos;s signed manifest checks out.{" "}
              </>
            )}
            See <Link href="/security#lab">each release&apos;s run</Link>.
          </p>
          <LabMatrix tests={tests} runs={security.labReleases} />
        </Block>
      )}

      {(t.advisories.length > 0 || t.watches.includes("advisories")) && (
        <Block
          id="advisories"
          title="Its advisories"
          aside={
            <span className="small muted">
              {plural(t.advisories.length, "advisory", "advisories")}
            </span>
          }
        >
          <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
            Published by the projects themselves, and filed here by code under the rules of the
            advisory map. Each says which rule filed it; a match by words shows the words.
          </p>
          {t.advisories.length ? (
            <Advisories
              items={t.advisories.map((a) => ({ ...a, why: matchReason(a.rule, a.by) }))}
            />
          ) : (
            <p className="empty">No advisory the watch has read is filed under this threat.</p>
          )}
        </Block>
      )}

      {t.cves.length > 0 && (
        <Block
          id="nvd"
          title="Checked against NVD"
          aside={<span className="small muted">{plural(t.cves.length, "CVE id")}</span>}
        >
          <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
            Each CVE id this threat&apos;s record names, looked up in NVD, the public vulnerability
            database: whether the id exists, what NVD says it affects, and since when. A
            disagreement is listed for the owner; the record is never changed to match.
          </p>
          {findings.length > 0 && (
            <p className="callout callout-warn" style={{ marginBottom: "var(--s3)" }}>
              <span>
                {plural(findings.length, "finding")} for the owner:{" "}
                {findings.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <span className="nowrap">{c.id}</span>
                  </span>
                ))}
                .
              </span>
            </p>
          )}
          <CveChecks cves={t.cves} threat={t.id} />
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
                  {idsIn(`${h.ref} ${h.url}`).flatMap((id) => {
                    const c = t.cves.find((x) => x.id === id);
                    if (!c || c.nvd.state === "unchecked") return [];
                    return [
                      <a
                        key={id}
                        href="#nvd"
                        className={c.finding ? "badge badge-warn" : undefined}
                      >
                        {c.finding
                          ? `${id}: see the NVD check`
                          : `${id} in NVD${c.nvd.published ? ` since ${date(c.nvd.published)}` : ""}`}
                      </a>,
                    ];
                  })}
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
