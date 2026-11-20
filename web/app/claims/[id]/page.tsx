import { DEPTH_LABEL, type Revision } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/bits";
import { Evidence } from "@/components/Evidence";
import { allClaims, bundle, eventsFor, getClaim, snapshotFor } from "@/lib/data";
import { dateTime, height } from "@/lib/format";
import { CONFIDENCE_LABEL, KIND_LABEL, STATUS_HINT } from "@/lib/labels";
import { SITE } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return allClaims().map((c) => ({ id: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const c = getClaim((await params).id);
  if (!c) return {};
  return {
    title: c.statement.length > 70 ? `${c.statement.slice(0, 67)}...` : c.statement,
    description: c.statement,
  };
}

const CHANGE_LABEL: Record<Revision["change"], string> = {
  created: "Published",
  corrected: "Corrected",
  refined: "Refined",
  sources: "Sources changed",
  status: "Status changed",
  confidence: "Confidence changed",
  depth: "Depth changed",
  superseded: "Superseded",
  reviewed: "Reviewed",
};

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const claim = getClaim((await params).id);
  if (!claim) notFound();
  const events = eventsFor(claim.id);
  const snapshot = snapshotFor(claim);
  const related = (claim.related ?? []).map((id) => getClaim(id)).filter((c) => c !== undefined);
  const supersededBy = claim.superseded_by ? getClaim(claim.superseded_by) : undefined;
  const file = `${SITE.repo}/blob/main/knowledge/claims/${claim.topics[0]}/${claim.id}.yaml`;

  return (
    <div className="wrap claim-page">
      <div className="crumbs">
        {claim.shownIn.length > 0
          ? claim.shownIn.map((s, i) => (
              <span key={`${s.kind}-${s.slug}`}>
                {i > 0 && ", "}
                <Link href={`/topics/${s.slug}#${claim.id}`}>{s.title}</Link>
              </span>
            ))
          : "Not shown on a topic page"}
      </div>
      <p className="eyebrow">
        {KIND_LABEL[claim.kind]} · {DEPTH_LABEL[claim.depth]}
      </p>
      <h1 className="statement">{claim.statement}</h1>
      <div className="badges">
        <StatusChip status={claim.status} />
        <span>{STATUS_HINT[claim.status]}</span>
        <span>{CONFIDENCE_LABEL[claim.confidence]}.</span>
        {claim.attributed_to && claim.attributed_to.length > 0 && (
          <span>
            Attributed to{" "}
            {claim.attributed_to.map((p, i) => (
              <span key={p.name}>
                {i > 0 && ", "}
                {p.url ? (
                  <a href={p.url} rel="noopener noreferrer">
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
              </span>
            ))}
          </span>
        )}
      </div>
      {supersededBy && (
        <p className="callout" style={{ marginTop: "1.25rem" }}>
          Superseded by <Link href={`/claims/${supersededBy.id}`}>{supersededBy.statement}</Link>
        </p>
      )}

      {claim.recheck && (
        <div className="callout recheck" role="note">
          <p>
            <strong>
              The recheck at block {height(claim.recheck.at.height)} could not confirm this claim as
              cited.
            </strong>{" "}
            It stays as published until a later recheck passes or a correction lands (
            {dateTime(claim.recheck.at.time)}).
          </p>
          <ul>
            {claim.recheck.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-head">
        <h2>Evidence</h2>
      </div>
      <Evidence claim={claim} link={false} />

      <div className="section-head">
        <h2>History</h2>
        <span className="muted">Nothing is edited silently.</span>
      </div>
      <ol className="timeline">
        {events
          .slice()
          .reverse()
          .map((e) => (
            <li key={e.rev}>
              <div className="when">
                rev {e.rev}, {dateTime(e.at.time)}, block {height(e.at.height)}
              </div>
              <div>
                <strong>{CHANGE_LABEL[e.change]}</strong> in run{" "}
                <Link href={`/log/${e.run}`}>{e.run}</Link>
                {e.note ? `: ${e.note}` : ""}
              </div>
              {e.before && (
                <div className="diff">
                  {e.before.statement !== undefined && <del>{e.before.statement}</del>}
                  {e.before.status && <del>status: {e.before.status}</del>}
                  {e.before.confidence && <del>confidence: {e.before.confidence}</del>}
                  {e.before.depth && <del>depth: {e.before.depth}</del>}
                  {e.before.sources && <del>{e.before.sources.length} sources before</del>}
                </div>
              )}
            </li>
          ))}
      </ol>

      <div className="section-head">
        <h2>Record</h2>
      </div>
      <dl className="kv">
        <dt>Id</dt>
        <dd className="hash">{claim.id}</dd>
        <dt>Hash</dt>
        <dd className="hash" title="SHA-256 of the claim's canonical JSON, without last_verified">
          {claim.hash}
        </dd>
        <dt>First seen</dt>
        <dd>
          {dateTime(claim.first_seen.time)}, block {height(claim.first_seen.height)}
        </dd>
        <dt>Last checked</dt>
        <dd>
          {dateTime(claim.last_verified.time)}, block {height(claim.last_verified.height)}, run{" "}
          <Link href={`/log/${claim.last_verified.run}`}>{claim.last_verified.run}</Link>
        </dd>
        <dt>Snapshot</dt>
        <dd>
          {snapshot ? (
            <>
              <Link href={`/verify#snapshot-${snapshot.n}`}>Snapshot {snapshot.n}</Link>, block{" "}
              {height(snapshot.at.height)}, claim {snapshot.index + 1} of {snapshot.count}.
              <details>
                <summary>Audit path to the root</summary>
                <ol className="mono audit-path">
                  {snapshot.path.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ol>
                <p className="muted">
                  Root <span className="mono">{snapshot.root}</span>.{" "}
                  <Link href="/verify#claim">How to check it</Link>.
                </p>
              </details>
            </>
          ) : bundle.snapshots[0] ? (
            `Changed after snapshot ${bundle.snapshots[0].n}; the next snapshot will hold this version.`
          ) : (
            "Not in a timestamped snapshot yet"
          )}
        </dd>
        {claim.review && (
          <>
            <dt>Owner review</dt>
            <dd>
              {claim.review.by}, {dateTime(claim.review.at)}: held for{" "}
              {claim.review.reasons.join("; ")}
              {claim.review.note ? `. ${claim.review.note}` : ""}
            </dd>
          </>
        )}
        <dt>Source file</dt>
        <dd>
          <a href={file}>
            knowledge/claims/{claim.topics[0]}/{claim.id}.yaml
          </a>
        </dd>
      </dl>

      {related.length > 0 && (
        <>
          <div className="section-head">
            <h2>Related claims</h2>
          </div>
          <ul className="feed">
            {related.map((r) => (
              <li key={r.id} style={{ gridTemplateColumns: "1fr" }}>
                <Link href={`/claims/${r.id}`} className="what" style={{ color: "inherit" }}>
                  {r.statement}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
