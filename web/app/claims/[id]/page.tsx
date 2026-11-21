import { DEPTH_LABEL, type Revision } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Confidence, StatusChip } from "@/components/bits";
import { CopyCommand } from "@/components/CopyCommand";
import { Evidence } from "@/components/Evidence";
import { Block, FeedItem, Page, PageHeader } from "@/components/ui";
import { allClaims, bundle, eventsFor, getClaim, snapshotFor } from "@/lib/data";
import { dateTime, height } from "@/lib/format";
import { KIND_LABEL, STATUS_HINT } from "@/lib/labels";
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
    alternates: { canonical: `/claims/${c.id}` },
  };
}

const CHANGE: Record<Revision["change"], { label: string; tone: string }> = {
  created: { label: "Published", tone: "badge-ok" },
  corrected: { label: "Corrected", tone: "badge-bad" },
  refined: { label: "Refined", tone: "badge-info" },
  sources: { label: "Sources changed", tone: "" },
  status: { label: "Status changed", tone: "badge-warn" },
  confidence: { label: "Confidence changed", tone: "" },
  depth: { label: "Depth changed", tone: "" },
  superseded: { label: "Superseded", tone: "badge-outline" },
  reviewed: { label: "Reviewed", tone: "badge-accent" },
};

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const claim = getClaim((await params).id);
  if (!claim) notFound();
  const events = eventsFor(claim.id).slice().reverse();
  const snapshot = snapshotFor(claim);
  const related = (claim.related ?? []).map((id) => getClaim(id)).filter((c) => c !== undefined);
  const supersededBy = claim.superseded_by ? getClaim(claim.superseded_by) : undefined;
  const path = `knowledge/claims/${claim.topics[0]}/${claim.id}.yaml`;
  const home = claim.shownIn[0];
  const url = `${SITE.url}/claims/${claim.id}`;

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: "/topics", label: "Topics" },
          ...(home ? [{ href: `/topics/${home.slug}#${claim.id}`, label: home.title }] : []),
          { label: "Claim" },
        ]}
        title={<span className="claim-statement">{claim.statement}</span>}
        meta={
          <>
            <span className="badge">{KIND_LABEL[claim.kind]}</span>
            <span className="badge">{DEPTH_LABEL[claim.depth]}</span>
            <StatusChip status={claim.status} />
            <Confidence level={claim.confidence} />
            <span>{STATUS_HINT[claim.status]}</span>
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
          </>
        }
      />

      <div className="with-rail">
        <div>
          {supersededBy && (
            <p className="callout callout-info block">
              <span>
                <strong>Superseded.</strong> A newer claim replaces this one:{" "}
                <Link href={`/claims/${supersededBy.id}`}>{supersededBy.statement}</Link>
              </span>
            </p>
          )}
          {claim.recheck && (
            <div className="callout callout-bad block" role="note">
              <p>
                <strong>
                  The recheck at block {height(claim.recheck.at.height)} could not confirm this
                  claim as cited.
                </strong>{" "}
                It stays published, marked, until a later recheck passes or a correction lands (
                {dateTime(claim.recheck.at.time)}).
              </p>
              <ul>
                {claim.recheck.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <Block id="evidence" title="Sources and checks">
            <Evidence claim={claim} link={false} facts={false} />
          </Block>

          <Block
            id="history"
            title="History"
            aside={<p>Nothing is edited silently; every revision keeps what it replaced.</p>}
          >
            <ol className="feed">
              {events.map((e) => (
                <FeedItem key={e.rev} when={dateTime(e.at.time)} block={e.at.height}>
                  <p>
                    <span className={`badge ${CHANGE[e.change].tone}`}>
                      {CHANGE[e.change].label}
                    </span>{" "}
                    <span className="small muted">
                      Revision {e.rev}, run <Link href={`/log/${e.run}`}>{e.run}</Link>
                      {e.note ? `: ${e.note}` : ""}
                    </span>
                  </p>
                  {e.before && (
                    <div className="small muted stack-sm">
                      {e.before.statement !== undefined && (
                        <span>
                          Before: <del>{e.before.statement}</del>
                        </span>
                      )}
                      {e.before.status && <span>Status before: {e.before.status}</span>}
                      {e.before.confidence && <span>Confidence before: {e.before.confidence}</span>}
                      {e.before.depth && <span>Depth before: {e.before.depth}</span>}
                      {e.before.sources && <span>{e.before.sources.length} sources before</span>}
                    </div>
                  )}
                </FeedItem>
              ))}
            </ol>
          </Block>

          {related.length > 0 && (
            <Block id="related" title="Related claims">
              <ul className="rows">
                {related.map((r) => (
                  <li key={r.id} className="row-item">
                    <p>
                      <Link href={`/claims/${r.id}`}>{r.statement}</Link>
                    </p>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>

        <aside className="rail" aria-label="The record">
          <section className="rail-block" aria-label="Cite this claim">
            <h3>Cite this claim</h3>
            <CopyCommand command={`Blocklore, ${url}, CC BY 4.0`} />
          </section>
          <section className="rail-block" aria-label="Record">
            <h3>Record</h3>
            <dl className="dl stacked rail-dl">
              <dt>Id</dt>
              <dd className="mono">{claim.id}</dd>
              <dt>Hash</dt>
              <dd
                className="mono"
                title="SHA-256 of the claim's canonical JSON, without last_verified"
              >
                {claim.hash}
              </dd>
              <dt>First seen</dt>
              <dd>
                {dateTime(claim.first_seen.time)}, block{" "}
                <span className="mono">{height(claim.first_seen.height)}</span>
              </dd>
              <dt>Last checked</dt>
              <dd>
                {dateTime(claim.last_verified.time)}, block{" "}
                <span className="mono">{height(claim.last_verified.height)}</span>, run{" "}
                <Link href={`/log/${claim.last_verified.run}`}>{claim.last_verified.run}</Link>
              </dd>
              {claim.review && (
                <>
                  <dt>Owner review</dt>
                  <dd>
                    {claim.review.by}, {dateTime(claim.review.at)}. Held for{" "}
                    {claim.review.reasons.join("; ")}
                    {claim.review.note ? `. ${claim.review.note}` : ""}
                  </dd>
                </>
              )}
              <dt>File</dt>
              <dd>
                <a href={`${SITE.repo}/blob/main/${path}`}>{path}</a>
              </dd>
            </dl>
          </section>
          <section className="rail-block" aria-label="Snapshot">
            <h3>Timestamped in Bitcoin</h3>
            {snapshot ? (
              <>
                <p>
                  <Link href={`/verify#snapshot-${snapshot.n}`}>Snapshot {snapshot.n}</Link> at
                  block {height(snapshot.at.height)} holds this version, as claim{" "}
                  {snapshot.index + 1} of {snapshot.count}.
                </p>
                <details>
                  <summary className="small">Audit path to the root</summary>
                  <ol className="mono small audit-path">
                    {snapshot.path.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ol>
                  <p className="small muted">
                    Root <span className="mono">{snapshot.root}</span>.{" "}
                    <Link href="/verify#claim">How to check it</Link>
                  </p>
                </details>
              </>
            ) : (
              <p>
                {bundle.snapshots[0]
                  ? `Changed after snapshot ${bundle.snapshots[0].n}; the next snapshot will hold this version.`
                  : "Not in a timestamped snapshot yet."}
              </p>
            )}
          </section>
        </aside>
      </div>
    </Page>
  );
}
