"use client";

import type { DaemonState } from "@blocklore/core/control";
import { TableWrap } from "@/components/TableWrap";
import { useBrain } from "./live";
import { RunsTable, subscriptionNote, subscriptionWord } from "./Overview";

export function Runs({ initial, online }: { initial: DaemonState | null; online: boolean }) {
  const b = useBrain({ initial: { state: initial, online } });
  const s = b.state;
  if (!s) return <p className="empty">The brain has not reported yet.</p>;
  const days = [...s.usage.days].sort((a, c) => c.day.localeCompare(a.day));
  const week = days.slice(0, 7);
  const sum = (ds: typeof days, k: "sessions" | "minutes") => ds.reduce((n, d) => n + d[k], 0);
  const done = s.runs.filter((r) => r.status === "done");
  return (
    <>
      <div className="stats">
        <div className="stat">
          <strong>{subscriptionWord(s)}</strong>
          <span>your Claude subscription</span>
          <small>{subscriptionNote(s)}</small>
        </div>
        <div className="stat">
          <strong>{sum(week, "sessions")}</strong>
          <span>model sessions, last 7 days</span>
        </div>
        <div className="stat">
          <strong>{sum(week, "minutes")}</strong>
          <span>minutes of sessions, last 7 days</span>
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
          <h2 id="days-h">Use of your plan by day</h2>
          <span className="small muted">
            Every model session runs on your Claude subscription. Nothing is billed per token.
          </span>
        </div>
        {days.length === 0 ? (
          <p className="empty">No sessions yet.</p>
        ) : (
          <TableWrap label="Use of your plan by day">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Day (UTC)</th>
                  <th scope="col" className="num">
                    Sessions
                  </th>
                  <th scope="col" className="num">
                    Minutes
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 30).map((d) => (
                  <tr key={d.day}>
                    <th scope="row" className="mono">
                      {d.day}
                    </th>
                    <td className="num">{d.sessions}</td>
                    <td className="num">{d.minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
