import type { Metadata } from "next";
import { LoopReview } from "@/components/admin/LoopReview";
import { readLoopReview, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Weekly review" };
export const dynamic = "force-dynamic";

export default async function LoopReviewPage() {
  const [review, { state, online }] = await Promise.all([readLoopReview(), readState()]);
  return <LoopReview review={review} initial={state} online={online} />;
}
