import type { Metadata } from "next";
import { Evaluator } from "@/components/admin/Evaluator";
import { readEvaluator, readReview, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Evaluator" };
export const dynamic = "force-dynamic";

export default async function EvaluatorPage() {
  const [{ state, online }, view, items] = await Promise.all([
    readState(),
    readEvaluator(),
    readReview(),
  ]);
  return (
    <>
      <header className="page-header">
        <h1>Evaluator</h1>
        <p className="lede">
          Claims the gate marks for closer checks (contested questions, safety, stances, named
          people) are decided by the evaluator: a fresh recheck, rules written from the editorial
          policy, and two verifiers on different models that must both accept. Test claims prove the
          checks work; publishing pauses when too few are caught. You can withdraw any claim, or
          hold gated claims for yourself.
        </p>
        {!online && (
          <div className="meta">
            <span className="badge badge-warn">The brain is offline: changes wait for it</span>
          </div>
        )}
      </header>
      <Evaluator initial={state} online={online} view={view} items={items} />
    </>
  );
}
