"use client";

import {
  type PublicReport,
  REPORT_KIND_LABEL,
  REPORT_KINDS,
  REPORT_NOTE_MAX,
  REPORT_STATUS_LABEL,
  type ReportKind,
  type ReportStatus,
  reportOutcomeText,
} from "@blocklore/core";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { date } from "@/lib/format";

export const REPORT_TONE: Record<ReportStatus, string> = {
  received: "",
  holds: "badge-ok",
  failed: "badge-bad",
  researching: "badge-info",
  researched: "badge-accent",
  dismissed: "badge-outline",
};

/** One report as the public sees it: kind, how often, when, and what became of it. */
export function ReportLine({ r }: { r: PublicReport }) {
  return (
    <>
      <span className="feed-title">
        <span className={`badge ${REPORT_TONE[r.status]}`}>{REPORT_STATUS_LABEL[r.status]}</span>
        <span style={{ color: "var(--ink)" }}>{REPORT_KIND_LABEL[r.kind]}</span>
      </span>
      <span className="small muted">
        Reported {r.count === 1 ? "once" : `${r.count} times`}, {date(r.at)}
        {r.last.slice(0, 10) !== r.at.slice(0, 10) ? ` to ${date(r.last)}` : ""}.{" "}
        {reportOutcomeText(r)}
        {r.outcome?.run && r.status !== "dismissed" && (
          <>
            {" "}
            <Link href={`/log/${r.outcome.run}`}>Run {r.outcome.run}</Link>
          </>
        )}
      </span>
      {r.status === "failed" && r.outcome && r.outcome.problems.length > 0 && (
        <ul className="small muted" style={{ paddingLeft: "1.2em", listStyle: "disc" }}>
          {r.outcome.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The reports on one claim and a quiet way to file one. The page is built ahead of time, so the
 * record is fetched here. A note goes to the brain and the owner only; this list never shows one.
 */
export function ClaimReports({ id, open: canReport }: { id: string; open: boolean }) {
  const [reports, setReports] = useState<PublicReport[] | null>(null);
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState<ReportKind>("wrong");
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; text?: string }>({
    kind: "idle",
  });
  const url = `/api/v1/claims/${id}/reports`;

  const load = useCallback(() => {
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setReports(b ? (b.reports as PublicReport[]) : []))
      .catch(() => setReports([]));
  }, [url]);
  useEffect(load, [load]);

  return (
    <section className="rail-block" aria-labelledby="reports-h" id="reports">
      <h3 id="reports-h">Reader reports</h3>
      {reports === null ? (
        <p>Reading the record.</p>
      ) : reports.length === 0 ? (
        <p>No reader has reported a problem with this claim.</p>
      ) : (
        <ul aria-label="Reports on this claim">
          {reports.map((r) => (
            <li key={r.id} className="stack-sm" style={{ gap: "var(--s1)" }}>
              <ReportLine r={r} />
            </li>
          ))}
        </ul>
      )}
      {canReport && !form && (
        <p>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            style={{ marginLeft: "calc(-1 * var(--s3))" }}
            onClick={() => {
              setForm(true);
              setState({ kind: "idle" });
            }}
          >
            Report a problem
          </button>
        </p>
      )}
      {form && (
        <form
          className="stack-sm"
          aria-label="Report a problem with this claim"
          onSubmit={async (e) => {
            e.preventDefault();
            setState({ kind: "busy" });
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(note.trim() ? { kind, note } : { kind }),
            }).catch(() => null);
            const body = (await res?.json().catch(() => null)) as {
              added?: boolean;
              error?: string;
            } | null;
            if (res?.ok) {
              setState({
                kind: "ok",
                text: body?.added
                  ? "Thank you. The brain rechecks this claim within the hour, and the outcome shows here."
                  : "A reader reported this already; yours now counts too. The outcome shows here.",
              });
              setNote("");
              setForm(false);
              load();
            } else setState({ kind: "error", text: body?.error ?? "The site did not answer." });
          }}
        >
          <label className="field">
            <span>What is the problem</span>
            <select
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as ReportKind)}
            >
              {REPORT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REPORT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>A note for the brain (optional)</span>
            <textarea
              className="textarea"
              value={note}
              maxLength={REPORT_NOTE_MAX}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              style={{ minHeight: "4.5rem" }}
            />
            <small>
              Only the brain and the owner read notes; they are never published. Leave out keys,
              seeds, addresses and names. Links and contact details are removed.
            </small>
          </label>
          <div className="toolbar">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={state.kind === "busy"}
            >
              Send report
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {state.text && (
        <p
          className={`callout ${state.kind === "ok" ? "callout-ok" : "callout-bad"}`}
          role={state.kind === "ok" ? "status" : "alert"}
        >
          <span>{state.text}</span>
        </p>
      )}
    </section>
  );
}

/**
 * Every reader report and what became of it, newest first, for the corrections view: the public
 * can see Blocklore answering. Fetched in the browser, since the page is built ahead of time.
 */
export function ReportLog() {
  const [reports, setReports] = useState<(PublicReport & { statement: string | null })[] | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/v1/reports", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => setReports(b.reports))
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="empty">The reports are not available right now.</p>;
  if (!reports) return <p className="muted small">Reading the reports.</p>;
  if (!reports.length)
    return (
      <p className="empty">
        No reader has reported a problem yet. When one does, the report and its outcome are listed
        here.
      </p>
    );
  return (
    <ol className="feed" aria-label="Reader reports">
      {reports.map((r) => (
        <li key={r.id}>
          <div className="feed-when">
            <span>{date(r.last)}</span>
            {r.outcome && <span>block {r.outcome.at.height.toLocaleString("en-US")}</span>}
          </div>
          <div className="feed-body">
            <p>
              <Link href={`/claims/${r.claim}#reports`} style={{ textDecoration: "none" }}>
                {r.statement ?? r.claim}
              </Link>
            </p>
            <ReportLine r={r} />
          </div>
        </li>
      ))}
    </ol>
  );
}
