import type { Metadata } from "next";
import { GatePolicy } from "@/components/admin/GatePolicy";
import { readPolicy, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Gate policy" };
export const dynamic = "force-dynamic";

export default async function GatePolicyPage() {
  const [view, { online }] = await Promise.all([readPolicy(), readState()]);
  const unlisted = view?.topics.filter((t) => !t.listed).length ?? 0;
  return (
    <>
      <header className="page-header">
        <h1>Gate policy</h1>
        <p className="lede">
          Which topics hold their claims for the evaluator&apos;s closer checks. Contested holds
          every claim on the topic for the evaluator, which adds the neutrality rules. Safety advice
          marks it as the Safety Desk&apos;s: its claims wait too, and each needs two independent
          sources, a primary one among them, and no advice voice.
        </p>
        <p className="measure">
          A topic the file does not list counts as contested. Loosening the gate is your decision
          and only yours: what you set decides whether the claims research drafts from now on wait,
          and claims already waiting keep waiting for the evaluator. The brain writes
          brain/policy/topics.yaml, checks it, commits it as yours and ships it.
        </p>
        <div className="meta">
          {view ? (
            <>
              <span>
                {unlisted} of {view.topics.length} topics not listed
              </span>
              <span>
                {view.waiting} claim{view.waiting === 1 ? "" : "s"} waiting for the evaluator
              </span>
              <span className="mono">As of {view.head}</span>
            </>
          ) : null}
          {!online && (
            <span className="badge badge-warn">The brain is offline: changes wait for it</span>
          )}
        </div>
      </header>
      <GatePolicy view={view} />
    </>
  );
}
