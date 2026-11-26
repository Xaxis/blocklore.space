"use client";

import {
  QUEUE_STATUS_LABEL,
  QUEUE_STATUSES,
  type QueueItem,
  type QueueStatus,
} from "@blocklore/core";
import { useMemo, useState } from "react";

const TONE: Record<QueueStatus, string> = {
  queued: "",
  researching: "badge-info",
  answered: "badge-ok",
  declined: "badge-outline",
};

/** Where research takes a question up, and the published runs whose task carried it. */
export interface QuestionRoute {
  topic: string | null;
  title: string | null;
  /** Whether the topic has a page: an agenda topic with nothing published has none yet. */
  page: boolean;
  runs: string[];
}

/**
 * Every queued reader question, including the ones the public page never shows (waiting and
 * declined). The owner can move a question along, decline it with a note, or list answering claims.
 */
export function Questions({
  initial,
  routes,
}: {
  initial: QueueItem[] | null;
  routes: Record<string, QuestionRoute>;
}) {
  const [items, setItems] = useState(initial ?? []);
  const [filter, setFilter] = useState<QueueStatus | "all">("queued");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);

  if (!initial)
    return (
      <p className="callout callout-warn">The queue is not available: the site has no Redis.</p>
    );

  return (
    <>
      <fieldset className="toolbar" aria-label="Show">
        {(["queued", "researching", "answered", "declined", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            className={`btn btn-sm ${filter === f ? "btn-primary" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : QUEUE_STATUS_LABEL[f]}{" "}
            <span className="mono">{counts[f] ?? 0}</span>
          </button>
        ))}
      </fieldset>
      {shown.length === 0 ? (
        <p className="empty" style={{ marginTop: "var(--s4)" }}>
          Nothing here.
        </p>
      ) : (
        <ul className="rows" style={{ marginTop: "var(--s4)" }}>
          {shown.map((i) => (
            <Row
              key={i.id}
              item={i}
              route={routes[i.id]}
              onSaved={(n) => setItems((all) => all.map((x) => (x.id === n.id ? n : x)))}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function Row({
  item: i,
  route,
  onSaved,
}: {
  item: QueueItem;
  route: QuestionRoute | undefined;
  onSaved: (i: QueueItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<QueueStatus>(i.status);
  const [note, setNote] = useState(i.note ?? "");
  const [claims, setClaims] = useState(i.claims.join(" "));
  const [err, setErr] = useState("");
  return (
    <li className="row-item" style={{ display: "block" }}>
      <div
        style={{
          display: "flex",
          gap: "var(--s4)",
          justifyContent: "space-between",
          alignItems: "start",
        }}
      >
        <div className="stack-sm">
          <p style={{ color: "var(--ink)" }}>{i.q}</p>
          <span className="small muted">
            Suggested {i.asks === 1 ? "once" : `${i.asks} times`}, first {i.at.slice(0, 10)}
            {i.missing ? `. Missing: ${i.missing}` : ""}
          </span>
          {i.note && <span className="small">Note: {i.note}</span>}
          {route && (i.status === "queued" || i.status === "researching") && (
            <span className="small muted">
              {route.topic ? (
                <>
                  Nearest topic:{" "}
                  {route.page ? (
                    <a href={`/topics/${route.topic}`}>{route.title}</a>
                  ) : (
                    <>{route.title}, nothing published yet</>
                  )}
                  .{" "}
                </>
              ) : (
                "Near no topic on the research agenda, so research cannot take it up. "
              )}
              {route.runs.length ? (
                <>
                  Carried by{" "}
                  {route.runs.map((id, n) => (
                    <span key={id}>
                      {n > 0 && ", "}
                      <a href={`/log/${id}`}>run {id}</a>
                    </span>
                  ))}
                  .
                </>
              ) : (
                "No published run has carried it yet."
              )}
            </span>
          )}
        </div>
        <span className="row-side">
          <span className={`badge ${TONE[i.status]}`}>{QUEUE_STATUS_LABEL[i.status]}</span>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? "Close" : "Change"}
          </button>
        </span>
      </div>
      {open && (
        <form
          className="form-grid"
          style={{ marginTop: "var(--s3)" }}
          onSubmit={async (e) => {
            e.preventDefault();
            setErr("");
            const res = await fetch("/api/admin/queue", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: i.id,
                status,
                note: note.trim() || null,
                ...(status === "answered"
                  ? { claims: claims.split(/[\s,]+/).filter(Boolean) }
                  : {}),
              }),
            }).catch(() => null);
            const body = (await res?.json().catch(() => null)) as {
              item?: QueueItem;
              error?: string;
            } | null;
            if (body?.item) {
              onSaved(body.item);
              setOpen(false);
            } else setErr(body?.error ?? "The site did not answer.");
          }}
        >
          <label className="field">
            <span>Status</span>
            <select
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as QueueStatus)}
            >
              {QUEUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {QUEUE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ gridColumn: "span 2" }}>
            <span>Public note, in Blocklore&apos;s words (optional)</span>
            <input
              className="input"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {status === "answered" && (
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Answering claim ids, separated by spaces</span>
              <input
                className="input mono"
                value={claims}
                onChange={(e) => setClaims(e.target.value)}
              />
            </label>
          )}
          <div className="toolbar" style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn btn-primary btn-sm">
              Save
            </button>
            {err && (
              <span className="small" role="alert" style={{ color: "var(--bad)" }}>
                {err}
              </span>
            )}
          </div>
        </form>
      )}
    </li>
  );
}
