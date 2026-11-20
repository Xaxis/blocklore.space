import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  return { title: `Run ${run}` };
}

export default async function RunPage({ params }: { params: Promise<{ run: string }> }) {
  const { run: id } = await params;
  const run = bundle.runs.find((r) => r.id === id);
  if (!run) notFound();
  return (
    <div className="wrap" style={{ maxWidth: "56rem" }}>
      <header className="page-head">
        <div className="crumbs">
          <Link href="/log">Research log</Link> / {run.kind}
        </div>
        <h1 className="mono" style={{ fontSize: "1.6rem" }}>
          {run.id}
        </h1>
        <p className="lede">{run.summary}</p>
        <dl className="kv" style={{ marginTop: "1.25rem" }}>
          <dt>Started</dt>
          <dd>
            {dateTime(run.started.time)}, block {height(run.started.height)}
          </dd>
          <dt>Finished</dt>
          <dd>
            {dateTime(run.finished.time)}, block {height(run.finished.height)}
          </dd>
          <dt>Agent</dt>
          <dd>{run.agent}</dd>
        </dl>
      </header>

      <div className="section-head">
        <h2>Published</h2>
        <span className="muted">{plural(run.published.length, "claim")}</span>
      </div>
      <ul className="feed">
        {run.published.map((cid) => {
          const c = getClaim(cid);
          return (
            <li key={cid} style={{ gridTemplateColumns: "1fr" }}>
              <Link href={`/claims/${cid}`} className="what" style={{ color: "inherit" }}>
                {c ? c.statement : cid}
              </Link>
            </li>
          );
        })}
      </ul>

      {run.revised.length > 0 && (
        <>
          <div className="section-head">
            <h2>Revised</h2>
          </div>
          <ul className="feed">
            {run.revised.map((r) => (
              <li key={r.id} style={{ gridTemplateColumns: "1fr" }}>
                <div>
                  <span className={`change ${r.change}`}>{r.change}</span>{" "}
                  <Link href={`/claims/${r.id}`}>{r.id}</Link>: {r.note}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {run.gated.length > 0 && (
        <>
          <div className="section-head">
            <h2>Held for the owner</h2>
          </div>
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            Their text stays private until the owner approves it.
          </p>
          <ul className="feed">
            {run.gated.map((g) => (
              <li key={g.topic} style={{ gridTemplateColumns: "1fr" }}>
                <div>
                  {plural(g.count, "claim")} on <strong>{g.topic}</strong>: {g.reasons.join("; ")}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-head">
        <h2>Rejected</h2>
        <span className="muted">{plural(run.rejected.length, "candidate")}</span>
      </div>
      {run.rejected.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="feed">
          {run.rejected.map((r, i) => (
            <li key={`${i}-${r.statement.slice(0, 20)}`} style={{ gridTemplateColumns: "1fr" }}>
              <div className="what" style={{ color: "var(--ink-2)" }}>
                {r.statement}
              </div>
              <div className="meta">{r.reason}</div>
            </li>
          ))}
        </ul>
      )}

      {run.open.length > 0 && (
        <>
          <div className="section-head">
            <h2>Could not settle</h2>
          </div>
          <ul className="feed">
            {run.open.map((o) => (
              <li key={o} style={{ gridTemplateColumns: "1fr" }}>
                <div>{o}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-head">
        <h2>Injection attempts</h2>
      </div>
      {run.injections.length === 0 ? (
        <p className="muted">No text in any source this run read tried to give the brain orders.</p>
      ) : (
        <ul className="feed">
          {run.injections.map((j) => (
            <li key={j.url} style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <a href={j.url} rel="noopener noreferrer nofollow">
                  {j.url}
                </a>
              </div>
              <div className="meta">{j.excerpt}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="section-head">
        <h2>Read</h2>
        <span className="muted">{plural(run.read.length, "source")}</span>
      </div>
      <ul className="feed">
        {run.read.map((r) => (
          <li key={r.url} style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <a href={r.url} rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>
                {r.url}
              </a>
              {r.why && <span className="muted">: {r.why}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
