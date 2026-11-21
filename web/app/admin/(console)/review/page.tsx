import type { Metadata } from "next";
import { ReviewQueue } from "@/components/admin/ReviewQueue";
import { readReview, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const [items, { state, online }] = await Promise.all([readReview(), readState()]);
  return (
    <>
      <header className="page-header">
        <h1>Review</h1>
        <p className="lede">
          Claims the gate held because they touch contested questions, safety advice, stances or
          named people. Nothing here is public until you approve it; a rejection is logged with your
          reason.
        </p>
        <div className="meta">
          <span>{items.length} waiting</span>
          {state && <span>Queue as of {new Date(state.at).toUTCString().slice(5, 22)} UTC</span>}
          {!online && (
            <span className="badge badge-warn">The brain is offline: decisions wait for it</span>
          )}
        </div>
      </header>
      <ReviewQueue items={items} />
    </>
  );
}
