import {
  type BundleClaim,
  type ChangeEvent,
  DEPTH_LABEL,
  type Review,
  type Revision,
} from "@blocklore/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { AsOfForm } from "@/components/AsOfForm";
import { Confidence, StatusChip } from "@/components/bits";
import { CopyCommand } from "@/components/CopyCommand";
import { Evidence } from "@/components/Evidence";
import { ClaimReports } from "@/components/Report";
import { Block, FeedItem, Page, PageHeader } from "@/components/ui";
import { bundle, type snapshotFor } from "@/lib/data";
import { date, dateTime, height } from "@/lib/format";
import { KIND_LABEL, STATUS_HINT } from "@/lib/labels";
import { SITE } from "@/lib/site";

/** How each kind of revision is named in a claim's history. */
export const CHANGE: Record<Revision["change"], { label: string; tone: string }> = {
  created: { label: "Published", tone: "badge-ok" },
  corrected: { label: "Corrected", tone: "badge-bad" },
  refined: { label: "Refined", tone: "badge-info" },
  sources: { label: "Sources changed", tone: "" },
  status: { label: "Status changed", tone: "badge-warn" },
  confidence: { label: "Confidence changed", tone: "" },
  depth: { label: "Depth changed", tone: "" },
  superseded: { label: "Superseded", tone: "badge-outline" },
  reviewed: { label: "Reviewed", tone: "badge-accent" },
  withdrawn: { label: "Withdrawn", tone: "badge-bad" },
};

export interface ClaimViewProps {
  claim: BundleClaim;
  /** Its revisions as change events, newest first. */
  events: ChangeEvent[];
  snapshot: ReturnType<typeof snapshotFor>;
  related: BundleClaim[];
  supersededBy?: BundleClaim;
  /**
   * The time machine only: the moment as written in the URL, its name for the crumbs ("As of
   * block 976,771") and the notice that names it.
   */
  at?: { path: string; label: string; notice: ReactNode };
}

/**
 * A claim's page: its evidence, its history and its record. The live page and the time machine
 * render through here, so a claim looks the same now and as it stood then.
 */
export function ClaimView({ claim, events, snapshot, related, supersededBy, at }: ClaimViewProps) {
  const there = at ? `/at/${at.path}` : "";
  const moved = claim.at_head.filter((a) => a.state !== "current");
  const path = `knowledge/claims/${claim.topics[0]}/${claim.id}.yaml`;
  const home = claim.shownIn[0];
  const url = `${SITE.url}/claims/${claim.id}${there}`;

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: at ? `/topics/at/${at.path}` : "/topics", label: "Topics" },
          ...(home
            ? [{ href: `/topics/${home.slug}${there}#${claim.id}`, label: home.title }]
            : []),
          { label: "Claim" },
          ...(at ? [{ label: at.label }] : []),
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
      {at?.notice}

      <div className="with-rail">
        <div>
          {claim.withdrawal && (
            <div className="callout callout-bad block" role="note">
              <p>
                <strong>
                  Withdrawn on {dateTime(claim.withdrawal.at.time)}, at block{" "}
                  {height(claim.withdrawal.at.height)}.
                </strong>{" "}
                {claim.withdrawal.note} It is no longer part of Blocklore&apos;s current knowledge:
                no topic, list or search shows it. This page stays, with its history, so links to it
                keep working (run{" "}
                <Link href={`/log/${claim.withdrawal.run}`}>{claim.withdrawal.run}</Link>).
              </p>
            </div>
          )}
          {supersededBy && (
            <p className="callout callout-info block">
              <span>
                <strong>Superseded.</strong> A newer claim replaces this one:{" "}
                <Link href={`/claims/${supersededBy.id}${there}`}>{supersededBy.statement}</Link>
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

          {moved.length > 0 && (
            <div className="callout callout-info block" role="note">
              <p>
                <strong>
                  {moved.length === 1
                    ? "A passage it quotes has moved on."
                    : `${moved.length} passages it quotes have moved on.`}
                </strong>{" "}
                When the brain read {[...new Set(moved.map((a) => a.repo))].join(" and ")} at its
                head on {date(moved[0]?.read.time ?? "")},{" "}
                {moved.length === 1 ? "it was" : "they were"} no longer there. The claim holds as
                cited at the commits it names; the sources below show what moved.
              </p>
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
                      <Link href={`/claims/${r.id}${there}`}>{r.statement}</Link>
                    </p>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>

        <aside className="rail" aria-label="The record">
          <section className="rail-block" aria-label="Cite this claim">
            <h3>{at ? "Cite it as it stood" : "Cite this claim"}</h3>
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
                  <dt>How it was approved</dt>
                  <dd>
                    <ReviewRecord review={claim.review} />
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
                  ? at
                    ? `Snapshot ${bundle.snapshots[0].n}, the newest, does not hold this version.`
                    : `Changed after snapshot ${bundle.snapshots[0].n}; the next snapshot will hold this version.`
                  : "Not in a timestamped snapshot yet."}
              </p>
            )}
          </section>
          <AsOfForm base={`/claims/${claim.id}`} what="this claim" value={at?.path} />
          {!at && <ClaimReports id={claim.id} open={!claim.withdrawal} />}
        </aside>
      </div>
    </Page>
  );
}

/**
 * The record of a gated claim's approval in plain words: the evaluator's checks and models, or the
 * owner's approval. Gated claims get closer checks; the reasons say why this one did.
 */
function ReviewRecord({ review }: { review: Review }) {
  const held = `Held for closer checks: ${review.reasons.join("; ")}.`;
  if (review.by === "owner")
    return (
      <>
        Approved by the owner on {dateTime(review.at)}. {held}
        {review.note ? ` The owner noted: ${review.note}` : ""}
      </>
    );
  return (
    <>
      Published by the evaluator on {dateTime(review.at)}, after every check passed:{" "}
      {review.checks.join("; ")}. Two verifiers on different models ({review.models.join(" and ")})
      each accepted it on their own. {held} The owner can still withdraw it (
      <Link href={`/log/${review.batch}`}>batch {review.batch}</Link>,{" "}
      <Link href="/verify/evaluator">how the evaluator is checked</Link>).
    </>
  );
}
