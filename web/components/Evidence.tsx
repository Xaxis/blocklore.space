import { type BundleClaim, checkMeaning, readerCommand } from "@blocklore/core";
import Link from "next/link";
import { dateTime, height } from "@/lib/format";
import { SOURCE_KIND_LABEL, SUPPORTS_LABEL } from "@/lib/labels";
import { TierTag } from "./bits";
import { CopyCommand } from "./CopyCommand";

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Every source with its quote, every machine check with the command to repeat it. */
export function Evidence({ claim, link = true }: { claim: BundleClaim; link?: boolean }) {
  const v = claim.last_verified;
  return (
    <div className="evidence">
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
            <span className="kind">
              {SOURCE_KIND_LABEL[s.kind]}, {SUPPORTS_LABEL[s.supports]}
            </span>
          </div>
          {s.quote && <blockquote>{s.quote}</blockquote>}
          <div className="found">
            {s.locator}
            {s.published ? `, published ${s.published}` : ""}, read {s.accessed}
          </div>
        </div>
      ))}
      {(claim.checks ?? []).map((c, i) => (
        <div className="check" key={`${c.type}-${i}`}>
          <div className="check-head">
            <span className="checked" aria-hidden="true">
              ✓
            </span>
            <span>{sentence(checkMeaning(c))}</span>
          </div>
          <CopyCommand command={readerCommand(c)} label="Check it yourself" />
        </div>
      ))}
      <div className="evidence-foot">
        <span>
          Checked at block {height(v.height)}, {dateTime(v.time)}: {v.method}
        </span>
        {link && <Link href={`/claims/${claim.id}`}>Claim page, history and hash</Link>}
      </div>
    </div>
  );
}
