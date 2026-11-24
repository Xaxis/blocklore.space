import {
  type AtHeadOf,
  type BundleClaim,
  bipOf,
  boltOf,
  checkMeaning,
  compareUrl,
  DEPTH_LABEL,
  readerCommand,
} from "@blocklore/core";
import Link from "next/link";
import { bipHref } from "@/lib/bips";
import { boltHref } from "@/lib/bolts";
import { date, dateTime, height } from "@/lib/format";
import { KIND_LABEL, SOURCE_KIND_LABEL, SUPPORTS_LABEL } from "@/lib/labels";
import { Confidence, StatusChip, TierTag } from "./bits";
import { CopyCommand } from "./CopyCommand";

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** A BIP source's page on Blocklore, when the index lists the BIP its link points into. */
function BipLink({ url }: { url?: string }) {
  const n = bipOf(url);
  const href = n === null ? null : bipHref(n);
  return href ? (
    <Link href={href} className="source-kind">
      BIP {n} on Blocklore
    </Link>
  ) : null;
}

/** A BOLT source's page on Blocklore, when BOLT #0 lists the BOLT its link points into. */
function BoltLink({ url }: { url?: string }) {
  const n = boltOf(url);
  const href = n === null ? null : boltHref(n);
  return href ? (
    <Link href={href} className="source-kind">
      BOLT {n} on Blocklore
    </Link>
  ) : null;
}

/**
 * Whether a pinned passage is still in its file at the repository's head, as the brain last read it
 * (core/src/athead.ts). A passage that moved on is marked; the claim still holds as cited.
 */
function AtHeadLine({ a }: { a: AtHeadOf }) {
  const head = (
    <a
      href={
        a.state === "gone"
          ? `https://github.com/${a.repo}/tree/${a.head}`
          : `https://github.com/${a.repo}/blob/${a.head}/${a.path}`
      }
      className="mono"
      rel="noopener noreferrer"
    >
      {a.head.slice(0, 10)}
    </a>
  );
  if (a.state === "current")
    return (
      <div className="source-at-head">
        Still in {a.path} at the head of {a.repo} ({head}), read {date(a.read.time)}.
      </div>
    );
  return (
    <div className="source-at-head source-moved">
      <span className="badge badge-info">Moved on</span>{" "}
      {a.state === "changed"
        ? `This passage is no longer in ${a.path} at the head of ${a.repo}`
        : `${a.path} is no longer in ${a.repo} at its head`}{" "}
      ({head}, read {date(a.read.time)}
      {date(a.since.time) === date(a.read.time) ? "" : `; moved on by ${date(a.since.time)}`}). The
      claim cites it as it stood at <span className="mono">{a.pinned.slice(0, 10)}</span>:{" "}
      <a href={compareUrl(a)} rel="noopener noreferrer">
        compare the two
      </a>
      .
    </div>
  );
}

/** A claim opened: what kind of claim, every source with its quote, every check to repeat. */
export function Evidence({
  claim,
  link = true,
  facts = true,
  href = `/claims/${claim.id}`,
}: {
  claim: BundleClaim;
  link?: boolean;
  facts?: boolean;
  /** The claim's own page: its live page, or the time machine's at the same moment. */
  href?: string;
}) {
  const v = claim.last_verified;
  const atHead = new Map(claim.at_head.map((a) => [a.source, a]));
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
            {s.kind === "bip" && <BipLink url={s.url} />}
            {s.kind === "bolt" && <BoltLink url={s.url} />}
          </div>
          {s.quote && <blockquote className="quote">{s.quote}</blockquote>}
          <div className="source-found">
            {s.locator}
            {s.published ? `, published ${s.published}` : ""}, read {s.accessed}
          </div>
          {atHead.has(i) && <AtHeadLine a={atHead.get(i) as AtHeadOf} />}
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
        {link && <Link href={href}>History, hash and citation</Link>}
      </div>
    </div>
  );
}
