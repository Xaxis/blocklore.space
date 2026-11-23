import { findingText } from "@blocklore/core/loopreview";
import { Overview } from "@/components/admin/Overview";
import { readLoopReview, readState } from "@/lib/admin/control";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const [{ state, online }, review] = await Promise.all([readState(), readLoopReview()]);
  const first = review?.findings[0];
  return (
    <Overview
      initial={state}
      online={online}
      loop={
        review && first
          ? { week: review.week, findings: review.findings.length, first: findingText(first) }
          : null
      }
    />
  );
}
