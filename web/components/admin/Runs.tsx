"use client";

import type { DaemonState } from "@blocklore/core/control";
import { useBrain } from "./live";
import { RunsTable } from "./Overview";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function Runs({ initial, online }: { initial: DaemonState | null; online: boolean }) {
  const b = useBrain({ initial: { state: initial, online } });
  const s = b.state;
  if (!s) return <p className="empty">The brain has not reported yet.</p>;
  const days = [...s.spend.days].sort((a, c) => c.day.localeCompare(a.day));
  const week = days.slice(0, 7).reduce((n, d) => n + d.usd, 0);
  const month = days.slice(0, 30).reduce((n, d) => n + d.usd, 0);
  const done = s.runs.filter((r) => r.status === "done");
  return (
    <>
      <div className="stats">
        <div className="stat">
          <strong>{usd(s.spend.today)}</strong>
          <span>today, of {usd(s.settings.budget.dailyUsd)}</span>
        </div>
        <div className="stat">
          <strong>{usd(week)}</strong>
          <span>last 7 days</span>
        </div>
        <div className="stat">
          <strong>{usd(month)}</strong>
          <span>last 30 days</span>
        </div>
        <div className="stat">
          <strong>{done.reduce((n, r) => n + r.published, 0)}</strong>
          <span>claims published by the last {done.length} sessions</span>
        </div>
      </div>

      <section className="block" aria-labelledby="runs-h">
        <div className="block-head">
          <h2 id="runs-h">Sessions</h2>
          <span className="small muted">
            Held claims wait in Review; each session links to its public log
          </span>
        </div>
        <RunsTable runs={s.runs} />
      </section>

      <section className="block" aria-labelledby="days-h">
        <div className="block-head">
          <h2 id="days-h">Spend by day</h2>
          <span className="small muted">
            Model dollars at API prices, for research, verifier and bench. With your plan as the
            credential this is what it would have cost.
          </span>
        </div>
        {days.length === 0 ? (
          <p className="empty">Nothing spent yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Day (UTC)</th>
                  <th scope="col" className="num">
                    Spent
                  </th>
                  <th scope="col" className="num">
                    Of budget
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 30).map((d) => (
                  <tr key={d.day}>
                    <th scope="row" className="mono">
                      {d.day}
                    </th>
                    <td className="num">{usd(d.usd)}</td>
                    <td className="num">
                      {s.settings.budget.dailyUsd > 0
                        ? `${Math.round((d.usd / s.settings.budget.dailyUsd) * 100)}%`
                        : "n/a"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
