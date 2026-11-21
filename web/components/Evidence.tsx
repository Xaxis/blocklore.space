import { type BundleClaim, checkMeaning, DEPTH_LABEL, readerCommand } from "@blocklore/core";
import Link from "next/link";
import { dateTime, height } from "@/lib/format";
import { KIND_LABEL, SOURCE_KIND_LABEL, SUPPORTS_LABEL } from "@/lib/labels";
import { Confidence, StatusChip, TierTag } from "./bits";
import { CopyCommand } from "./CopyCommand";

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** A claim opened: what kind of claim, every source with its quote, every check to repeat. */
export function Evidence({
  claim,
  link = true,
  facts = true,
}: {
  claim: BundleClaim;
  link?: boolean;
  facts?: boolean;
}) {
  const v = claim.last_verified;
  return (
    <div className="evidence">
      {facts && (
        <div className="evidence-facts">
          <span className="badge">{KIND_LABEL[claim.kind]}</span>
          <span className="badge">{DEPTH_LABEL[claim.depth]}</span>
          <StatusChip status={claim.status} />
          <Confidence level={claim.confidence} />
          {claim.attributed_to?.length ? (
            <span>Attributed to {claim.attributed_to.map((p) => p.name).join(", ")}</span>
          ) : null}
        </div>
      )}
      {claim.sources.map((s, i) => (
        <div className="source" key={`${s.locator}-${i}`}>
          <div className="source-head">
            <TierTag tier={s.tier} />
            {s.url ? (
              <a href={s.url} rel="noopener noreferrer" target="_blank">
                {s.title}
              </a>
            ) : (
              <strong>{s.title}</strong>
            )}
            <span className="source-kind">
              {SOURCE_KIND_LABEL[s.kind]}, {SUPPORTS_LABEL[s.supports]}
            </span>
          </div>
          {s.quote && <blockquote className="quote">{s.quote}</blockquote>}
          <div className="source-found">
            {s.locator}
            {s.published ? `, published ${s.published}` : ""}, read {s.accessed}
          </div>
        </div>
      ))}
      {(claim.checks ?? []).map((c, i) => (
        <div className="check" key={`${c.type}-${i}`}>
          <div className="check-head">
            <span className="check-mark" aria-hidden="true">
              ✓
            </span>
            <span>{sentence(checkMeaning(c))}</span>
          </div>
          <CopyCommand command={readerCommand(c)} label="Run it yourself" />
        </div>
      ))}
      <div className="evidence-foot">
        <span>
          Checked at block <span className="mono">{height(v.height)}</span>, {dateTime(v.time)}:{" "}
          {v.method}
        </span>
        {link && <Link href={`/claims/${claim.id}`}>History, hash and citation</Link>}
      </div>
    </div>
  );
}
