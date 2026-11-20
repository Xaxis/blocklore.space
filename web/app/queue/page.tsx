import { QUEUE_STATUS_LABEL, QUEUE_VISITOR_DAY } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { claimById } from "@/lib/api";
import { date, plural } from "@/lib/format";
import { publicQueue } from "@/lib/queue";

export const metadata: Metadata = {
  title: "Research queue",
  description:
    "Questions about Bitcoin that readers asked and Blocklore could not answer yet, and what became of them.",
};

// Reads Redis on every request: the queue changes as readers ask and the brain triages.
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const q = await publicQueue().catch(() => null);
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Research queue</h1>
        <p className="lede">
          Questions readers asked on <Link href="/ask">Ask</Link> that the published claims did not
          answer yet. The brain researches them like any other topic: every claim it finds is
          checked against its sources before it publishes.
        </p>
      </header>

      {!q ? (
        <p className="callout">The research queue is not available right now.</p>
      ) : (
        <>
          <p className="badges">
            {plural(q.waiting, "question")} waiting for triage;{" "}
            {plural(q.questions.filter((i) => i.status === "researching").length, "question")} being
            researched;{" "}
            {plural(q.questions.filter((i) => i.status === "answered").length, "question")}{" "}
            answered.
          </p>
          {q.questions.length === 0 ? (
            <p className="muted queue-empty">
              No question has been triaged yet. When one has, it shows here with what became of it.
            </p>
          ) : (
            <ol className="queue-list">
              {q.questions.map((i) => (
                <li key={i.id} id={`q-${i.id}`}>
                  <p className="queue-q">{i.q}</p>
                  <span className="ask-meta">
                    <span className="queue-status" data-status={i.status}>
                      {QUEUE_STATUS_LABEL[i.status]}
                    </span>
                    , asked {i.asks === 1 ? "once" : `${i.asks} times`}, first on {date(i.at)}
                    {i.missing ? `. Not covered when asked: ${i.missing}` : ""}
                  </span>
                  {i.note && <p className="ask-missing">{i.note}</p>}
                  {i.status === "answered" && i.claims.length > 0 && (
                    <ul className="queue-claims">
                      {i.claims.map((id) => {
                        const c = claimById(id);
                        return (
                          <li key={id}>
                            <Link href={`/claims/${id}`}>{c?.statement ?? id}</Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <article className="doc ask-how">
        <h2 id="how">How a question gets here</h2>
        <ol>
          <li>
            You ask on <Link href="/ask">Ask</Link>. When the answer says Blocklore does not cover
            the question yet, and the question is about Bitcoin, the answer offers to queue it.
          </li>
          <li>
            Links, email addresses and handles are removed. A question asked again is counted, not
            listed twice. Each visitor can queue {QUEUE_VISITOR_DAY} questions a day.
          </li>
          <li>
            The brain triages new questions: on topic and answerable from sources becomes research;
            anything else is declined and never shown. Until then a question is only counted here.
          </li>
          <li>
            Research runs through the same checks as every claim, and claims on contested topics,
            safety or named people still wait for the owner&apos;s review. When published claims
            answer the question, they are listed under it.
          </li>
        </ol>
      </article>
    </div>
  );
}
