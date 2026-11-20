import type { Confidence as Level, Status, Tier } from "@blocklore/core";
import {
  CONFIDENCE_BARS,
  CONFIDENCE_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  TIER_HINT,
} from "@/lib/labels";

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip ${status}`} title={STATUS_HINT[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Confidence({ level }: { level: Level }) {
  const on = CONFIDENCE_BARS[level];
  return (
    <span
      className="confidence"
      title={CONFIDENCE_LABEL[level]}
      role="img"
      aria-label={CONFIDENCE_LABEL[level]}
    >
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= on ? "on" : undefined} />
      ))}
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
      <rect
        x="3"
        y="3"
        width="26"
        height="26"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M9 12h14M9 17h14M9 22h8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect x="20" y="19" width="6" height="6" rx="1" fill="#f7931a" />
    </svg>
  );
}
