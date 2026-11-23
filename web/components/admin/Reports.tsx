"use client";

import {
  publicReport,
  REPORT_KIND_LABEL,
  REPORT_STATUS_LABEL,
  REPORT_STATUSES,
  type ReportItem,
  type ReportStatus,
} from "@blocklore/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { REPORT_TONE, ReportLine } from "@/components/Report";
import { dateTime } from "@/lib/format";

type Row = ReportItem & { statement: string | null };

/**
 * Every reader report with its notes, which the public never sees. The owner can dismiss one as
 * abuse (it stays listed in public as dismissed, and research drops it) or reopen one, which sends
 * it back to the brain for another recheck.
 */
export function Reports({ initial }: { initial: Row[] | null }) {
  const [items, setItems] = useState(initial ?? []);
  const [filter, setFilter] = useState<ReportStatus | "all">("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = (filter === "all" ? items : items.filter((i) => i.status === filter))
    .slice()
    .sort((a, b) => b.last.localeCompare(a.last));

  if (!initial)
    return (
      <p className="callout callout-warn">Reports are not available: the site has no Redis.</p>
    );

  return (
    <>
      <fieldset className="toolbar" aria-label="Show">
        {(["all", ...REPORT_STATUSES] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            className={`btn btn-sm ${filter === f ? "btn-primary" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : REPORT_STATUS_LABEL[f]}{" "}
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
            <Item
              key={i.id}
              item={i}
              onSaved={(n) =>
                setItems((all) =>
                  all.map((x) => (x.id === n.id ? { ...n, statement: x.statement } : x)),
                )
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}

function Item({ item: i, onSaved }: { item: Row; onSaved: (i: ReportItem) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "dismiss" | "reopen") => {
    setErr("");
    setBusy(true);
    const res = await fetch("/api/admin/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: i.id, action }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      item?: ReportItem;
      error?: string;
    } | null;
    setBusy(false);
    if (body?.item) onSaved(body.item);
    else setErr(body?.error ?? "The site did not answer.");
  };
  return (
    <li className="row-item" style={{ display: "block" }}>
      <div
        style={{
          display: "flex",
          gap: "var(--s4)",
          justifyContent: "space-between",
          alignItems: "start",
          flexWrap: "wrap",
        }}
      >
        <div className="stack-sm" style={{ flex: "1 1 20rem", minWidth: 0 }}>
          <p style={{ color: "var(--ink)" }}>
            <Link href={`/claims/${i.claim}#reports`}>{i.statement ?? i.claim}</Link>
          </p>
          <span className="small muted mono">
            {i.claim}, report {i.id}
          </span>
          <ReportLine r={publicReport(i)} />
          {i.notes.length > 0 ? (
            <div className="stack-sm">
              <span className="small" style={{ fontWeight: 500 }}>
                Readers&apos; notes (private)
              </span>
              <ul className="stack-sm small" style={{ listStyle: "none", padding: 0 }}>
                {i.notes.map((n) => (
                  <li
                    key={`${n.at}-${n.text}`}
                    className="callout"
                    style={{ padding: "var(--s3)" }}
                  >
                    <span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>
                      {dateTime(n.at)}
                    </span>
                    <span>{n.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <span className="small muted">No note.</span>
          )}
        </div>
        <span className="row-side" style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
          <span className={`badge ${REPORT_TONE[i.status]}`}>{REPORT_STATUS_LABEL[i.status]}</span>
          <span className="badge">{REPORT_KIND_LABEL[i.kind]}</span>
          {i.status === "dismissed" ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => act("reopen")}
            >
              Restore and recheck
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => act("dismiss")}
              >
                Dismiss as abuse
              </button>
              {i.status !== "received" && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={busy}
                  onClick={() => act("reopen")}
                >
                  Recheck again
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {err && (
        <p className="small" role="alert" style={{ color: "var(--bad)", marginTop: "var(--s2)" }}>
          {err}
        </p>
      )}
    </li>
  );
}
