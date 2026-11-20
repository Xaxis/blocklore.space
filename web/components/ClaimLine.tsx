import { type BundleClaim, DEPTH_LABEL, DEPTH_RANK } from "@blocklore/core";
import Link from "next/link";
import { height } from "@/lib/format";
import { KIND_LABEL } from "@/lib/labels";
import { Confidence, StatusChip } from "./bits";
import { Evidence } from "./Evidence";

/**
 * One claim as a sentence in a topic's text. Opening it shows the evidence in place; the margin says
 * how sure, how settled and when it was last checked.
 */
export function ClaimLine({ claim, n }: { claim: BundleClaim; n: number }) {
  const attributed = claim.attributed_to?.length ? claim.attributed_to : null;
  return (
    <div className="claim-line" data-d={DEPTH_RANK[claim.depth]} id={claim.id}>
      <details>
        <summary>
          {claim.statement}
          <span className="cite">
            [{n}]<span className="visually-hidden">, {claim.sources.length} sources</span>
          </span>
        </summary>
        <Evidence claim={claim} />
      </details>
      {/* A note, not an aside: thirty claims would otherwise be thirty identical landmarks. */}
      <div className="margin-note" role="note" aria-label="About this claim">
        <div className="row">
          {claim.status !== "established" && <StatusChip status={claim.status} />}
          <Confidence level={claim.confidence} />
          <span>{KIND_LABEL[claim.kind]}</span>
        </div>
        {attributed && <div>Attributed to {attributed.map((p) => p.name).join(", ")}</div>}
        <div>{DEPTH_LABEL[claim.depth]}</div>
        <Link href={`/claims/${claim.id}`}>
          Checked at block {height(claim.last_verified.height)}
        </Link>
        {claim.weakSources && <span className="chip warn">Secondary sources only</span>}
      </div>
    </div>
  );
}
