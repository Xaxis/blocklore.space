"use client";

import { QUEUE_STATUS_LABEL, type QueueItem } from "@blocklore/core";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const TONE: Record<string, string> = {
  researching: "badge-info",
  answered: "badge-ok",
};

/**
 * Readers tell the brain what to research next. No model reads the text on the site: it is
 * cleaned, capped and queued, and shows here only once the brain or the owner has triaged it.
 * A search that found nothing hands its question over in the fragment (#suggest=...).
 */
export function Suggest() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; text?: string }>({
    kind: "idle",
  });
  const [list, setList] = useState<{ questions: QueueItem[]; waiting: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const take = () => {
      const m = /^#suggest=(.*)$/.exec(window.location.hash);
      if (!m?.[1]) return;
      setQ(decodeURIComponent(m[1]).slice(0, 300));
      window.history.replaceState(null, "", window.location.pathname);
      input.current?.focus();
      input.current?.scrollIntoView({ block: "center" });
    };
    take();
    window.addEventListener("hashchange", take);
    fetch("/api/v1/queue")
      // Read a refusal's body too, or the browser holds the connection open for it.
      .then((r) => (r.ok ? r.json() : r.text().then(() => null)))
      .then((b) => b && setList({ questions: b.questions, waiting: b.waiting }))
      .catch(() => {});
    return () => window.removeEventListener("hashchange", take);
  }, []);

  return (
    <div className="stack">
      <form
        className="suggest"
        onSubmit={async (e) => {
          e.preventDefault();
          setState({ kind: "busy" });
          const res = await fetch("/api/v1/queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q }),
          }).catch(() => null);
          const body = (await res?.json().catch(() => null)) as {
            queued?: boolean;
            error?: string;
          } | null;
          if (res?.ok) {
            setState({
              kind: "ok",
              text: body?.queued
                ? "Queued. It shows below once it has been triaged."
                : "Someone suggested this already; it now counts twice.",
            });
            setQ("");
          } else setState({ kind: "error", text: body?.error ?? "The site did not answer." });
        }}
      >
        <input
          ref={input}
          id="suggest"
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          minLength={8}
          required
          placeholder="A question about Bitcoin Blocklore should answer"
          aria-label="A question about Bitcoin Blocklore should answer"
        />
        <button type="submit" className="btn btn-primary" disabled={state.kind === "busy"}>
          Suggest
        </button>
      </form>
      {state.text && (
        <p
          className={`callout ${state.kind === "ok" ? "callout-ok" : "callout-bad"}`}
          role={state.kind === "ok" ? "status" : "alert"}
        >
          <span>{state.text}</span>
        </p>
      )}
      <p className="small muted">
        Never include anything private: keys, seeds, addresses or names. Links and contact details
        are removed. Five a day for each visitor.
      </p>
      {list && (list.questions.length > 0 || list.waiting > 0) && (
        <div className="stack-sm">
          <h3 className="small" style={{ marginTop: "var(--s3)" }}>
            Suggested by readers{list.waiting ? ` (${list.waiting} waiting for triage)` : ""}
          </h3>
          <ul className="rows">
            {list.questions.map((i) => (
              <li key={i.id} className="row-item" style={{ padding: "var(--s3) 0" }}>
                <div className="stack-sm">
                  <p style={{ color: "var(--ink)" }}>{i.q}</p>
                  {i.note && <span className="small muted">{i.note}</span>}
                  {i.status === "answered" && i.claims.length > 0 && (
                    <span className="small">
                      Answered by{" "}
                      {i.claims.map((id, n) => (
                        <span key={id}>
                          {n > 0 && ", "}
                          <Link href={`/claims/${id}`}>{id}</Link>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <span className="row-side">
                  <span className={`badge ${TONE[i.status] ?? ""}`}>
                    {QUEUE_STATUS_LABEL[i.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
