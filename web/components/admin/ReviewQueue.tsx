"use client";

import type { ReviewItem } from "@blocklore/core/control";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SentList, useBrain } from "./live";

const TIER_HINT: Record<string, string> = {
  T1: "Primary",
  T2: "Expert secondary",
  T3: "General coverage",
  T4: "Social",
};

/**
 * The owner's queue: every held claim with why it was held, what the verifier said, and its
 * sources and quotes. Approve or reject a selection; each item goes with the hash of what is shown,
 * so nothing changed since can slip through.
 */
export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const b = useBrain();
  const topics = useMemo(() => {
    const m = new Map<string, ReviewItem[]>();
    for (const i of items) m.set(i.topic, [...(m.get(i.topic) ?? []), i]);
    return [...m.entries()].sort((a, c) => c[1].length - a[1].length);
  }, [items]);
  const [topic, setTopic] = useState<string | null>(topics[0]?.[0] ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [lesson, setLesson] = useState(true);
  const [mode, setMode] = useState<"approve" | "reject">("approve");

  // When the brain finishes a review command, load the queue again.
  const doneCount = b.sent.filter((s) => s.result?.phase === "done").length;
  useEffect(() => {
    if (doneCount > 0) {
      setPicked(new Set());
      router.refresh();
    }
  }, [doneCount, router]);

  const shown = topics.find(([t]) => t === topic)?.[1] ?? [];
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = shown.length > 0 && shown.every((i) => picked.has(i.id));
  const chosen = items.filter((i) => picked.has(i.id)).map((i) => ({ id: i.id, hash: i.hash }));

  if (!items.length)
    return (
      <p className="empty">
        Nothing waits for review. Held claims appear here as research runs find them.
      </p>
    );

  return (
    <>
      <fieldset className="toolbar" aria-label="Topic">
        {topics.map(([t, list]) => (
          <button
            key={t}
            type="button"
            aria-pressed={t === topic}
            className={`btn btn-sm ${t === topic ? "btn-primary" : ""}`}
            onClick={() => setTopic(t)}
          >
            {t} <span className="mono">{list.length}</span>
          </button>
        ))}
      </fieldset>

      <div className="panel block" style={{ marginTop: "var(--s4)" }}>
        <div className="panel-head">
          <label className="check-row">
            <input
              type="checkbox"
              checked={allShown}
              onChange={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  for (const i of shown) {
                    if (allShown) n.delete(i.id);
                    else n.add(i.id);
                  }
                  return n;
                })
              }
            />
            <span>
              Select all {shown.length} in <strong>{topic}</strong>
            </span>
          </label>
          <span className="small muted">{picked.size} selected in all</span>
        </div>
        <div className="panel-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          {shown.map((i) => (
            <Item key={i.id} item={i} checked={picked.has(i.id)} onToggle={() => toggle(i.id)} />
          ))}
        </div>
      </div>

      {picked.size > 0 && (
        <section className="sticky-actions" aria-label="Decide on the selection">
          <strong className="small">{picked.size} selected</strong>
          <div className="segmented" style={{ width: "13rem" }}>
            <button
              type="button"
              aria-pressed={mode === "approve"}
              onClick={() => setMode("approve")}
            >
              Approve
            </button>
            <button
              type="button"
              aria-pressed={mode === "reject"}
              onClick={() => setMode("reject")}
            >
              Reject
            </button>
          </div>
          {mode === "approve" ? (
            <>
              <input
                className="input"
                style={{ flex: 1, minWidth: "12rem" }}
                placeholder="Note for the record (optional)"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Note for the record"
              />
              <button
                type="button"
                className="btn btn-ok"
                onClick={() =>
                  b.send(
                    {
                      type: "review.approve",
                      items: chosen,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    },
                    `Approve ${chosen.length} claim${chosen.length === 1 ? "" : "s"} and publish`,
                  )
                }
              >
                Approve and publish
              </button>
            </>
          ) : (
            <>
              <input
                className="input"
                style={{ flex: 1, minWidth: "12rem" }}
                placeholder="Why (required, goes in the public log)"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Why these are rejected"
              />
              <label
                className="check-row small"
                title="Research sees it as one of your standing notes"
              >
                <input
                  type="checkbox"
                  checked={lesson}
                  onChange={(e) => setLesson(e.target.checked)}
                />
                Teach research this
              </label>
              <button
                type="button"
                className="btn btn-danger"
                disabled={reason.trim().length < 3}
                onClick={() =>
                  b.send(
                    { type: "review.reject", items: chosen, reason: reason.trim(), lesson },
                    `Reject ${chosen.length} claim${chosen.length === 1 ? "" : "s"}`,
                  )
                }
              >
                Reject
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setPicked(new Set())}
          >
            Clear
          </button>
        </section>
      )}
      <SentList sent={b.sent} />
    </>
  );
}

function Item({
  item: i,
  checked,
  onToggle,
}: {
  item: ReviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="review-item" aria-labelledby={`r-${i.id}`}>
      <div className="review-item-head">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${i.id}`}
        />
        <div className="stack-sm">
          <p className="review-statement" id={`r-${i.id}`}>
            {i.statement}
          </p>
          {i.before && (
            <p className="small muted">
              Replaces: <del>{i.before}</del>
            </p>
          )}
          <div className="evidence-facts">
            {i.before && <span className="badge badge-info">Update</span>}
            <span className="badge">{i.kind}</span>
            <span className="badge">{i.depth}</span>
            <span className={`badge ${i.status === "contested" ? "badge-warn" : ""}`}>
              {i.status}
            </span>
            <span className="badge badge-outline">{i.confidence} confidence</span>
            {i.attributed.length > 0 && (
              <span>Attributed to {i.attributed.map((a) => a.name).join(", ")}</span>
            )}
          </div>
          <p className="small">
            <strong>Held because:</strong> {i.reasons.join("; ")}.{" "}
            <span className="muted">
              {i.revisedIn
                ? `These are the ${i.revisedIn.stage === "verifier-a" ? "first" : "second"} verifier's (${i.revisedIn.model}) words from ${i.revisedIn.batch}, after it judged the research draft fixable: ${i.verdict.reason}`
                : `Verifier: ${i.verdict.verdict}. ${i.verdict.reason}`}
            </span>
          </p>
        </div>
        <span className="mono small muted">{i.id}</span>
      </div>
      <details style={{ marginLeft: "1.75rem" }}>
        <summary className="small" style={{ cursor: "pointer", color: "var(--ink-2)" }}>
          {i.sources.length} source{i.sources.length === 1 ? "" : "s"}
          {i.checks.length
            ? `, ${i.checks.length} machine check${i.checks.length === 1 ? "" : "s"}`
            : ""}
          , run {i.run}
        </summary>
        <div className="evidence" style={{ marginTop: "var(--s3)" }}>
          {i.sources.map((s, n) => (
            <div className="source" key={`${s.locator}-${n}`}>
              <div className="source-head">
                <abbr className={`tier ${s.tier}`} title={TIER_HINT[s.tier]}>
                  {s.tier}
                </abbr>
                {s.url ? (
                  <a href={s.url} rel="noopener noreferrer nofollow" target="_blank">
                    {s.title}
                  </a>
                ) : (
                  <strong>{s.title}</strong>
                )}
                <span className="source-kind">{s.kind}</span>
              </div>
              {s.quote && <blockquote className="quote">{s.quote}</blockquote>}
              <div className="source-found">{s.locator}</div>
            </div>
          ))}
          {i.checks.map((c) => (
            <div className="check" key={c}>
              <div className="check-head">
                <span className="check-mark" aria-hidden="true">
                  ✓
                </span>
                <span className="small">{c}</span>
              </div>
            </div>
          ))}
          <div className="evidence-foot">
            <span>Checks: {i.method}</span>
          </div>
        </div>
      </details>
    </article>
  );
}
