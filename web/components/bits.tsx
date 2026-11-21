import type { Confidence as Level, Status, Tier } from "@blocklore/core";
import {
  CONFIDENCE_BARS,
  CONFIDENCE_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  TIER_HINT,
} from "@/lib/labels";

const STATUS_TONE: Record<Status, string> = {
  established: "badge-ok",
  contested: "badge-warn",
  speculative: "badge-info",
  superseded: "badge-outline",
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`badge ${STATUS_TONE[status]}`} title={STATUS_HINT[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Confidence as words: three levels need no chart. */
export function Confidence({ level }: { level: Level }) {
  return (
    <span className="badge badge-outline" title={`${CONFIDENCE_BARS[level]} of 3`}>
      {CONFIDENCE_LABEL[level]}
    </span>
  );
}

export function TierTag({ tier }: { tier: Tier }) {
  return (
    <abbr className={`tier ${tier}`} title={TIER_HINT[tier]}>
      {tier}
    </abbr>
  );
}

/** The mark: a block with a ledger line and an orange corner, the unit Bitcoin's record is made of. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="2.5" width="27" height="27" rx="5" fill="currentColor" />
      <path
        d="M9 11.5h14M9 16.5h14M9 21.5h7"
        stroke="var(--bg)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <rect x="19.5" y="19" width="6" height="6" rx="1.2" fill="#f7931a" />
    </svg>
  );
}
