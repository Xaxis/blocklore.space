import { type BundleClaim, type ClaimMark, DEPTH_RANK } from "@blocklore/core";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/labels";
import { Evidence } from "./Evidence";

/**
 * One claim as a sentence in a topic's text: it reads as prose, and opening it shows its evidence
 * in place. Only what changes how to read it shows before it is opened: a status other than
 * established, a failed recheck, sources that are all secondary, and, where a page passes its
 * marks (core/src/bipview.ts), that it is a stance or an argument attributed to someone.
 */
export function ClaimLine({
  claim,
  n,
  href,
  marks = [],
}: {
  claim: BundleClaim;
  n: number;
  href?: string;
  marks?: ClaimMark[];
}) {
  const who = claim.attributed_to?.map((p) => p.name).join(", ");
  const flags = [
    claim.status !== "established" && (
      <span
        key="s"
        className={`badge ${claim.status === "contested" ? "badge-warn" : "badge-info"}`}
      >
        {STATUS_LABEL[claim.status]}
      </span>
    ),
    ...marks
      .filter((m) => m === "stance" || m === "argument")
      .map((m) => (
        <span key={m} className="badge badge-info" title={who ? `Attributed to ${who}` : undefined}>
          {KIND_LABEL[m]}
        </span>
      )),
    claim.recheck && (
      <span key="r" className="badge badge-bad">
        Recheck failed
      </span>
    ),
    claim.weakSources && (
      <span key="w" className="badge badge-outline">
        Secondary sources
      </span>
    ),
  ].filter(Boolean);
  return (
    <div className="claim" data-d={DEPTH_RANK[claim.depth]} id={claim.id}>
      <details>
        <summary>
          {claim.statement}
          {flags.length > 0 && <span className="claim-flags">{flags}</span>}
          <span className="cite">
            {n}
            <span className="visually-hidden">
              : open {claim.sources.length} {claim.sources.length === 1 ? "source" : "sources"}
            </span>
          </span>
        </summary>
        <Evidence claim={claim} href={href} />
      </details>
    </div>
  );
}
