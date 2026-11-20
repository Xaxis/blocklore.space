"use client";

import type { BipEntry } from "@blocklore/core";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface BipRow extends BipEntry {
  cites: { id: string; statement: string }[];
}

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
        <div className="filters">
          <input
            type="search"
            placeholder="Number, title or layer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter BIPs"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Every status</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {shown.length} of {rows.length}
          </span>
        </div>
      )}
      <table className="bip-table">
        <thead>
          <tr>
            <th>BIP</th>
            <th>Title</th>
            <th className="hide-phone">Layer</th>
            <th>Status</th>
            <th className="hide-phone">On Blocklore</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.n}>
              <td className="n">
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
              <td className="title">{r.title}</td>
              <td className="hide-phone muted">{r.layer ?? r.type}</td>
              <td>
                <span className={`chip plain status-${r.status.split(" ")[0]}`}>{r.status}</span>
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
    </>
  );
}
