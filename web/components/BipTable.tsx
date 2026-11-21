"use client";

import type { BipEntry } from "@blocklore/core";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface BipRow extends BipEntry {
  cites: { id: string; statement: string }[];
}

const STATUS_TONE: Record<string, string> = {
  Deployed: "badge-ok",
  Final: "badge-ok",
  Active: "badge-ok",
  Complete: "badge-info",
  Proposed: "badge-info",
  Draft: "badge-warn",
  Closed: "badge-outline",
  Rejected: "badge-outline",
  Withdrawn: "badge-outline",
  Replaced: "badge-outline",
  Obsolete: "badge-outline",
};

/** The BIP index as a table, optionally with a text and status filter (state in memory only). */
export function BipTable({
  rows,
  commit,
  filter = false,
}: {
  rows: BipRow[];
  commit: string;
  filter?: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);
  const shown = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!q ||
        `${r.n} ${r.title} ${r.layer ?? ""} ${r.type}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <>
      {filter && (
        <div className="toolbar" style={{ marginBottom: "var(--s4)" }}>
          <input
            type="search"
            className="input"
            style={{ maxWidth: "20rem" }}
            placeholder="Number, title or layer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter BIPs"
          />
          <select
            className="select"
            style={{ width: "auto" }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
          >
            <option value="">Every status</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="small muted">
            {shown.length} of {rows.length}
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="table bip-table">
          <thead>
            <tr>
              <th scope="col" className="num">
                BIP
              </th>
              <th scope="col">Title</th>
              <th scope="col" className="hide-phone">
                Layer
              </th>
              <th scope="col">Status</th>
              <th scope="col" className="hide-phone">
                On Blocklore
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.n}>
                <td className="num">
                  {r.file ? (
                    <a
                      href={`https://github.com/bitcoin/bips/blob/${commit}/${r.file}`}
                      rel="noopener noreferrer"
                    >
                      {r.n}
                    </a>
                  ) : (
                    r.n
                  )}
                </td>
                <td>{r.title}</td>
                <td className="hide-phone muted">{r.layer ?? r.type}</td>
                <td>
                  <span className={`badge ${STATUS_TONE[r.status.split(" ")[0] ?? ""] ?? ""}`}>
                    {r.status}
                  </span>
                </td>
                <td className="hide-phone">
                  {r.cites.length > 0 ? (
                    <details>
                      <summary>
                        {r.cites.length} claim{r.cites.length === 1 ? "" : "s"}
                      </summary>
                      <ul>
                        {r.cites.map((c) => (
                          <li key={c.id}>
                            <Link href={`/claims/${c.id}`}>{c.statement}</Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span className="muted">None yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
