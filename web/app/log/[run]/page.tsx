import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Block, Page, PageHeader } from "@/components/ui";
import { bundle, getClaim } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";

export const dynamicParams = false;

export function generateStaticParams() {
  return bundle.runs.map((r) => ({ run: r.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ run: string }>;
}): Promise<Metadata> {
  const { run } = await params;
  return { title: `Run ${run}`, alternates: { canonical: `/log/${run}` } };
}

export default async function RunPage({ params }: { params: Promise<{ run: string }> }) {
  const { run: id } = await params;
  const run = bundle.runs.find((r) => r.id === id);
  if (!run) notFound();
  const held = run.gated.reduce((n, g) => n + g.count, 0);
  // Revised, held and unsettled sections show only when they have something; the rest always do.
  const parts = [
    { id: "published", label: "Published", n: run.published.length, always: true },
    { id: "revised", label: "Revised", n: run.revised.length, always: false },
    { id: "held", label: "Held for closer checks", n: held, always: false },
    { id: "rejected", label: "Rejected", n: run.rejected.length, always: true },
    { id: "open", label: "Could not settle", n: run.open.length, always: false },
    { id: "injections", label: "Injection attempts", n: run.injections.length, always: true },
    { id: "read", label: "Read", n: run.read.length, always: true },
  ];
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/log", label: "Research log" }, { label: run.kind }]}
        title={<span className="mono run-title">{run.id}</span>}
        lede={run.summary}
        meta={
          <>
            <span>
              Started {dateTime(run.started.time)}, block{" "}
              <span className="mono">{height(run.started.height)}</span>
            </span>
            <span>
              Finished {dateTime(run.finished.time)}, block{" "}
              <span className="mono">{height(run.finished.height)}</span>
            </span>
            <span>{run.agent}</span>
          </>
        }
      />

      <div className="with-rail">
        <div>
          <Block
            id="published"
            title="Published"
            aside={<p>{plural(run.published.length, "claim")}</p>}
          >
            {run.published.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="lines">
                {run.published.map((cid) => {
                  const c = getClaim(cid);
                  return (
                    <li key={cid}>
                      <Link href={`/claims/${cid}`}>{c ? c.statement : cid}</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>

          {run.revised.length > 0 && (
            <Block id="revised" title="Revised">
              <ul className="lines">
                {run.revised.map((r) => (
                  <li key={r.id}>
                    <span className="badge badge-info">{r.change}</span>{" "}
                    <Link href={`/claims/${r.id}`} className="mono small">
                      {r.id}
                    </Link>
                    <p className="small muted">{r.note}</p>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {run.gated.length > 0 && (
            <Block id="held" title="Held for closer checks">
              <p className="small muted block-note">
                Their text stays private until it passes the evaluator&apos;s checks.
              </p>
              <ul className="lines">
                {run.gated.map((g) => (
                  <li key={g.topic}>
                    {plural(g.count, "claim")} on <strong>{g.topic}</strong>
                    <p className="small muted">{g.reasons.join("; ")}</p>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <Block
            id="rejected"
            title="Rejected"
            aside={<p>{plural(run.rejected.length, "candidate")}</p>}
          >
            {run.rejected.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="lines">
                {run.rejected.map((r, i) => (
                  <li key={`${i}-${r.statement.slice(0, 20)}`}>
                    <span className="muted">{r.statement}</span>
                    <p className="small">{r.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {run.open.length > 0 && (
            <Block id="open" title="Could not settle">
              <ul className="lines">
                {run.open.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </Block>
          )}

          <Block id="injections" title="Injection attempts">
            {run.injections.length === 0 ? (
              <p className="muted">
                No text in any source this run read tried to give the brain orders.
              </p>
            ) : (
              <ul className="lines">
                {run.injections.map((j) => (
                  <li key={j.url}>
                    <a href={j.url} rel="noopener noreferrer nofollow" className="url">
                      {j.url}
                    </a>
                    <p className="small muted">{j.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block id="read" title="Read" aside={<p>{plural(run.read.length, "source")}</p>}>
            <ul className="lines">
              {run.read.map((r) => (
                <li key={r.url}>
                  <a href={r.url} rel="noopener noreferrer" className="url">
                    {r.url}
                  </a>
                  {r.why && <p className="small muted">{r.why}</p>}
                </li>
              ))}
            </ul>
          </Block>
        </div>

        <aside className="rail" aria-label="This run in numbers">
          <section className="rail-block" aria-label="This run">
            <h3>This run</h3>
            <dl className="dl">
              {parts.map((p) => (
                <Fragment key={p.id}>
                  <dt>{p.always || p.n > 0 ? <a href={`#${p.id}`}>{p.label}</a> : p.label}</dt>
                  <dd>{p.n}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
          <section className="rail-block" aria-label="About the log">
            <h3>About the log</h3>
            <p>
              Every run is logged whether or not it published anything. Rejections keep the reason
              the checks or the verifier gave.
            </p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
