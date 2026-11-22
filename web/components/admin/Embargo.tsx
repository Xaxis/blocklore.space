"use client";

import type { EmbargoView } from "@blocklore/core/control";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SentList, useBrain } from "./live";

/**
 * The owner's private list of embargoed findings (SECURITY.md, T9): what was found, why the gate
 * held it, and where to report it. Release is off until the owner says the project has published.
 */
export function Embargo({ items }: { items: EmbargoView[] }) {
  const router = useRouter();
  const b = useBrain();
  const doneCount = b.sent.filter((s) => s.result?.phase === "done").length;
  useEffect(() => {
    if (doneCount > 0) router.refresh();
  }, [doneCount, router]);

  if (!items.length)
    return (
      <>
        <p className="empty">
          Nothing is embargoed. A lab failure or a research finding about an undisclosed weakness
          would appear here, and only here.
        </p>
        <SentList sent={b.sent} />
      </>
    );

  return (
    <>
      <div className="panel block">
        <div className="panel-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          {items.map((i) => (
            <Item
              key={i.id}
              item={i}
              onDecide={(decision) =>
                b.send(
                  { type: "embargo.decide", id: i.id, decision },
                  decision === "release"
                    ? i.kind === "lab"
                      ? `Release and publish ${i.title}`
                      : `Release ${i.title} to the review queue`
                    : `Dismiss ${i.title}`,
                )
              }
            />
          ))}
        </div>
      </div>
      <SentList sent={b.sent} />
    </>
  );
}

function Item({
  item: i,
  onDecide,
}: {
  item: EmbargoView;
  onDecide: (d: "release" | "dismiss") => void;
}) {
  const [published, setPublished] = useState(false);
  const subject = encodeURIComponent("Possible security issue found by Blocklore");
  return (
    <article className="review-item" aria-labelledby={`e-${i.id}`}>
      <div className="review-item-head" style={{ gridTemplateColumns: "1fr" }}>
        <div className="stack-sm">
          <p className="review-statement" id={`e-${i.id}`}>
            {i.summary}
          </p>
          <div className="evidence-facts">
            <span className="badge badge-warn">{i.kind === "lab" ? "Lab run" : "Research"}</span>
            <span>{i.title}</span>
            <span className="muted">held {i.at.slice(0, 16).replace("T", " ")} UTC</span>
            <span className="mono muted">{i.id}</span>
          </div>
          <p className="small">
            <strong>Held because:</strong> {i.reasons.join("; ")}.
          </p>
          <p className="small">
            <strong>Report privately to:</strong>{" "}
            {i.contacts.map((c, n) => (
              <span key={c.email}>
                {n > 0 && "; "}
                {c.project} at <a href={`mailto:${c.email}?subject=${subject}`}>{c.email}</a> (
                <a href={c.policy} rel="noopener noreferrer nofollow" target="_blank">
                  policy
                </a>
                )
              </span>
            ))}
            . Do not post it anywhere public until the project has.
          </p>
        </div>
      </div>
      {(i.sources.length > 0 || i.tail) && (
        <details>
          <summary className="small" style={{ cursor: "pointer", color: "var(--ink-2)" }}>
            {i.sources.length
              ? `${i.sources.length} source${i.sources.length === 1 ? "" : "s"}`
              : ""}
            {i.sources.length && i.tail ? ", " : ""}
            {i.tail ? "the test runner's output" : ""}
          </summary>
          <div className="evidence" style={{ marginTop: "var(--s3)" }}>
            {i.sources.map((s, n) => (
              <div className="source" key={`${s.url}-${n}`}>
                <div className="source-head">
                  {s.url ? (
                    <a href={s.url} rel="noopener noreferrer nofollow" target="_blank">
                      {s.url}
                    </a>
                  ) : (
                    <strong>No address</strong>
                  )}
                </div>
                {s.quote && <blockquote className="quote">{s.quote}</blockquote>}
              </div>
            ))}
            {i.tail && <pre className="code">{i.tail}</pre>}
          </div>
        </details>
      )}
      <div className="toolbar" style={{ marginTop: "var(--s3)" }}>
        <label className="check-row small">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          The project has published an advisory or a fix
        </label>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!published}
          onClick={() => onDecide("release")}
        >
          {i.kind === "lab" ? "Release and publish the run" : "Release to the review queue"}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => onDecide("dismiss")}>
          Dismiss
        </button>
      </div>
    </article>
  );
}
