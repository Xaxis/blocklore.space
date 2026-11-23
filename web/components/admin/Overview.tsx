"use client";

import type { DaemonState } from "@blocklore/core/control";
import Link from "next/link";
import { Ago, BrainStatus, SentList, useBrain } from "./live";

/** One word for the subscription's state: research runs on nothing else. */
export function subscriptionWord(s: DaemonState): string {
  if (!s.subscription.token) return "Not connected";
  return s.subscription.limitedUntil ? "At its limit" : "Connected";
}

export function subscriptionNote(s: DaemonState): string {
  if (!s.subscription.token) return "research waits until it is connected";
  if (s.subscription.limitedUntil)
    return `resumes ${new Date(s.subscription.limitedUntil).toUTCString().slice(5, 22)} UTC`;
  return `${s.usage.today.sessions} sessions, ${s.usage.today.minutes} minutes today`;
}
const MODE: Record<string, string> = {
  off: "Off: only runs you start",
  daily: "Daily",
  continuous: "Continuous",
};

/** The latest weekly review, when it found something: how many findings, and the first in words. */
export interface LoopLine {
  week: string;
  findings: number;
  first: string;
}

export function Overview({
  initial,
  online,
  loop,
}: {
  initial: DaemonState | null;
  online: boolean;
  loop: LoopLine | null;
}) {
  const b = useBrain({ initial: { state: initial, online } });
  const s = b.state;
  return (
    <>
      <header className="page-header bare">
        <h1>Overview</h1>
        <BrainStatus state={s} online={b.online} />
      </header>

      {(!b.online || loop) && (
        // As far below the notes as the header is above them, so they never sit on the tiles.
        <div className="stack" style={{ marginBottom: "var(--s5)" }}>
          {!b.online && (
            <p className="callout callout-warn">
              <span>
                <strong>The brain on the devbox is not syncing.</strong> Commands you send wait up
                to 15 minutes for it, then expire. On the devbox:{" "}
                <code>systemctl --user status blocklore-brain</code>.
              </span>
            </p>
          )}
          {loop && (
            <p className="callout callout-info" data-loop-findings={loop.findings}>
              <span>
                <strong>
                  The weekly review of the week of {loop.week} has {loop.findings} finding
                  {loop.findings === 1 ? "" : "s"}.
                </strong>{" "}
                {loop.first} <Link href="/admin/loop">Open the weekly review</Link>
              </span>
            </p>
          )}
        </div>
      )}

      {s && (
        <>
          <div className="stats">
            <div className="stat">
              <strong>
                <Link href="/admin/evaluator">{s.review.count}</Link>
              </strong>
              <span>
                gated claims waiting
                {s.settings.evaluator.decides === "owner" ? " for you" : " for the evaluator"}
              </span>
            </div>
            <div className="stat">
              <strong>{subscriptionWord(s)}</strong>
              <span>your Claude subscription</span>
              <small>
                {s.subscription.token ? (
                  subscriptionNote(s)
                ) : (
                  <Link href="/admin/research#sub-h">Connect it on Research</Link>
                )}
              </small>
            </div>
            <div className="stat">
              <strong>{s.research.runsToday}</strong>
              <span>research sessions today</span>
              <small>{MODE[s.settings.research.mode]}</small>
            </div>
            <div className="stat">
              <strong className="mono" style={{ fontSize: "var(--text-lg)" }}>
                {s.head.slice(0, 7)}
              </strong>
              <span>
                {s.live && s.head.startsWith(s.live.slice(0, 7))
                  ? "live on the site"
                  : `devbox head; site is at ${s.live?.slice(0, 7) ?? "unknown"}`}
              </span>
            </div>
          </div>

          <div className="grid-2 block">
            <section className="panel" aria-labelledby="next-h">
              <div className="panel-head">
                <h2 id="next-h">Next research session</h2>
                <Link href="/admin/research" className="small">
                  Open research
                </Link>
              </div>
              <div className="panel-body">
                <p>
                  {s.research.next.at
                    ? `${new Date(s.research.next.at).toUTCString().slice(0, 22)} UTC`
                    : "Not scheduled"}
                  {s.research.next.topic ? `, on ${s.research.next.topic}` : ""}
                </p>
                <p className="small muted">{s.research.next.why}</p>
                <div className="toolbar">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      b.send(
                        { type: "research.start", topic: null },
                        "Start a research session now",
                      )
                    }
                  >
                    Start one now
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      b.send(
                        { type: "settings", patch: { paused: !s.settings.paused } },
                        s.settings.paused ? "Resume the brain" : "Pause the brain",
                      )
                    }
                  >
                    {s.settings.paused ? "Resume the brain" : "Pause the brain"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => b.send({ type: "ship" }, "Push and deploy now")}
                  >
                    Deploy now
                  </button>
                </div>
                <SentList sent={b.sent} />
              </div>
            </section>

            <section className="panel" aria-labelledby="ticks-h">
              <div className="panel-head">
                <h2 id="ticks-h">Upkeep</h2>
                <Link href="/admin/settings" className="small">
                  Settings
                </Link>
              </div>
              <div className="panel-body" style={{ padding: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Tick</th>
                      <th scope="col">Last run</th>
                      <th scope="col">Next</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {s.ticks.map((t) => (
                      <tr key={t.tick}>
                        <th scope="row">
                          {t.tick}
                          {!t.enabled && (
                            <>
                              {" "}
                              <span className="badge">off</span>
                            </>
                          )}
                        </th>
                        <td>
                          {t.last ? (
                            <span className={t.last.ok ? "" : "muted"}>
                              <Ago iso={t.last.at} />{" "}
                              <span className={`badge ${t.last.ok ? "badge-ok" : "badge-bad"}`}>
                                {t.last.ok ? "ok" : "failed"}
                              </span>
                            </span>
                          ) : (
                            "never"
                          )}
                        </td>
                        <td className="small muted">
                          {t.next
                            ? `${new Date(t.next).toUTCString().slice(5, 22)} UTC`
                            : t.enabled
                              ? "unknown"
                              : "off"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-quiet btn-sm"
                            onClick={() =>
                              b.send({ type: "tick", tick: t.tick }, `Run the ${t.tick} tick now`)
                            }
                          >
                            Run now
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="block" aria-labelledby="runs-h">
            <div className="block-head">
              <h2 id="runs-h">Recent research sessions</h2>
              <Link href="/admin/runs">All runs and usage</Link>
            </div>
            <RunsTable runs={s.runs.slice(0, 6)} />
          </section>

          {s.results.length > 0 && (
            <section className="block" aria-labelledby="results-h">
              <div className="block-head">
                <h2 id="results-h">What the brain did for you</h2>
              </div>
              <ul className="rows">
                {s.results.slice(0, 10).map((r) => (
                  <li key={r.id} className="row-item" style={{ padding: "var(--s3) 0" }}>
                    <span className="small">
                      <span className="mono">{r.type}</span> {r.message}
                    </span>
                    <span className="row-side">
                      <span
                        className={`badge ${r.phase === "done" ? "badge-ok" : r.phase === "failed" ? "badge-bad" : "badge-info"}`}
                      >
                        {r.phase}
                      </span>
                      <Ago iso={r.at} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function RunsTable({ runs }: { runs: DaemonState["runs"] }) {
  if (!runs.length) return <p className="empty">No research session has run yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Topic</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Published
            </th>
            <th scope="col" className="num">
              Held
            </th>
            <th scope="col" className="num">
              Minutes
            </th>
            <th scope="col">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="mono small nowrap">
                <Link href={`/log/${r.id}`}>{r.id}</Link>
              </th>
              <td>{r.topic}</td>
              <td>
                <span
                  className={`badge ${r.status === "done" ? "badge-ok" : r.status === "running" ? "badge-accent" : r.status === "failed" ? "badge-bad" : ""}`}
                >
                  {r.status}
                </span>
              </td>
              <td className="num">{r.published}</td>
              <td className="num">{r.gated}</td>
              <td className="num">{r.minutes}</td>
              <td className="small muted">
                <Ago iso={r.started} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
