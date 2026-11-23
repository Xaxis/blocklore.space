"use client";

import type { BipEntry } from "@blocklore/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { bipStatusTone } from "@/lib/labels";

export interface BipRow extends BipEntry {
  cites: { id: string; statement: string }[];
}

/**
 * The BIP index as a table, optionally with a text and status filter (state in memory only). Each
 * BIP links to its page, which links its text at the index's commit.
 */
export function BipTable({ rows, filter = false }: { rows: BipRow[]; filter?: boolean }) {
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
                <td className="num">{r.n}</td>
                <td className="title">
                  <Link href={`/proposals/${r.n}`}>{r.title}</Link>
                </td>
                <td className="hide-phone muted">{r.layer ?? r.type}</td>
                <td>
                  <span className={`badge ${bipStatusTone(r.status)}`}>{r.status}</span>
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
