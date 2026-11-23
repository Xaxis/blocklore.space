"use client";

import type { Command, DaemonState, LoopReviewView } from "@blocklore/core/control";
import {
  type EvidenceKind,
  type Finding,
  findingText,
  proposalDone,
  QUOTE_FAILED_AT,
  STALE_TOPIC_DAYS,
} from "@blocklore/core/loopreview";
import Link from "next/link";
import { useState } from "react";
import { TableWrap } from "@/components/TableWrap";
import s from "./LoopReview.module.css";
import { Ago, SentList, useBrain } from "./live";

// The weekly review of the loop (core/src/loopreview.ts): what the brain did in one week and what
// in it needs the owner. A proposal is a button that sends an existing command through the signed
// control path, like every other page's; nothing here is sent until the owner presses it.

/** Where the admin shows each kind of evidence. */
const EVIDENCE: Record<EvidenceKind, { label: string; href: (id: string) => string }> = {
  session: { label: "Session", href: () => "/admin/runs" },
  batch: { label: "Evaluator batch", href: () => "/admin/evaluator#decisions-h" },
  decision: { label: "Decision", href: () => "/admin/evaluator#decisions-h" },
  topic: { label: "Topic", href: () => "/admin/agenda" },
  claim: { label: "Claim", href: (id) => `/claims/${id}` },
  pending: { label: "Waiting", href: () => "/admin/evaluator" },
  report: { label: "Report", href: () => "/admin/reports" },
  source: { label: "Source", href: (id) => id },
};

const TITLE: Record<Finding["code"], string> = {
  "research.starved": "Research went without a session",
  "evaluator.canary-missed": "A test claim got past the evaluator",
  "queue.waiting": "Gated claims wait long for a decision",
  "recheck.failed": "Published claims failed a recheck",
  "reports.open": "Reader reports wait",
  "rule.broken": "A rule held back many claims",
  "source.quote-failing": "Sources whose quotes keep failing",
  "agenda.stale": "Agenda topics research has not touched",
};

const SENDING = "sending";
const keyOf = (f: Finding) => `${f.code}:${f.subject ?? ""}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** What a proposal that already holds says instead of its button. */
function doneText(cmd: Command): string {
  if (cmd.type === "lesson.add") return "It is a standing lesson now.";
  return "Your settings already say so.";
}

export function LoopReview({
  review,
  initial,
  online,
}: {
  review: LoopReviewView | null;
  initial: DaemonState | null;
  online: boolean;
}) {
  const b = useBrain({ initial: { state: initial, online } });
  // Which command each finding sent, so its button waits until the brain reports back.
  const [rows, setRows] = useState<Record<string, string>>({});

  const header = (
    <header className="page-header">
      <h1>Weekly review</h1>
      <p className="lede">
        What the brain did in one week, counted by code from its own records, and what in it needs
        you. Each proposal is a command you can send, the same one another page sends; nothing here
        is sent until you press its button.
      </p>
      {review && (
        <div className="meta">
          <span>
            The week of {day(review.from)} to {day(review.to)}
          </span>
          <span>
            Counted to {review.asOf.slice(0, 16).replace("T", " ")} UTC, compiled{" "}
            <Ago iso={review.at} />
          </span>
          {!b.online && (
            <span className="badge badge-warn">The brain is offline: commands wait for it</span>
          )}
        </div>
      )}
    </header>
  );

  if (!review)
    return (
      <>
        {header}
        <p className="empty">
          No weekly review yet. The weekly tick writes one every Monday after 05:10 UTC for the week
          that just ended; <code>pnpm brain review-loop --write</code> on the devbox writes this
          week&apos;s so far.
        </p>
      </>
    );

  const sentOf = (f: Finding) => b.sent.find((x) => x.id === rows[keyOf(f)]);
  const waiting = (f: Finding) => {
    if (rows[keyOf(f)] === SENDING) return true;
    const x = sentOf(f);
    return !!x && !x.error && x.result?.phase !== "done" && x.result?.phase !== "failed";
  };
  const send = async (f: Finding) => {
    if (!f.proposal) return;
    const k = keyOf(f);
    setRows((r) => ({ ...r, [k]: SENDING }));
    const x = await b.send(f.proposal.command, f.proposal.label);
    setRows((r) => ({ ...r, [k]: x.id }));
  };
  const r = review;

  return (
    <>
      {header}

      <section className="block" aria-labelledby="findings-h">
        <div className="block-head">
          <h2 id="findings-h">Findings ({r.findings.length})</h2>
          <p>Most weight first. Each links the records it rests on.</p>
        </div>
        <SentList sent={b.sent} />
        {r.findings.length === 0 ? (
          <p className="empty">Nothing in this week needs you.</p>
        ) : (
          <div className="panel">
            <div className="panel-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
              {r.findings.map((f) => (
                <FindingRow
                  key={keyOf(f)}
                  finding={f}
                  settings={b.state?.settings ?? null}
                  waiting={waiting(f)}
                  sent={!!rows[keyOf(f)]}
                  onSend={() => send(f)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="block" aria-labelledby="counts-h">
        <div className="block-head">
          <h2 id="counts-h">The week in numbers</h2>
        </div>
        <div className="stats">
          <div className="stat">
            <strong>{r.research.sessions}</strong>
            <span>research sessions</span>
            <small>
              {r.research.last
                ? `the last ended ${r.research.daysSince} days before`
                : "none has ever run"}
              {r.research.failed ? `; ${r.research.failed} failed` : ""}
            </small>
          </div>
          <div className="stat">
            <strong>{r.evaluator.sessions}</strong>
            <span>evaluator sessions</span>
            <small>
              {r.evaluator.published} published, {r.evaluator.rejected} rejected, {r.evaluator.held}{" "}
              held
            </small>
          </div>
          <div className="stat">
            <strong>
              {r.evaluator.caught} of {r.evaluator.caught + r.evaluator.missed}
            </strong>
            <span>test claims caught</span>
            <small>{r.evaluator.missed} let through</small>
          </div>
          <div className="stat">
            <strong>{r.queue.waiting}</strong>
            <span>claims waiting for a decision</span>
            <small>
              {r.queue.oldestDays === null ? "none" : `the oldest for ${r.queue.oldestDays} days`}
            </small>
          </div>
        </div>
        <dl className={`dl stacked ${s.facts}`}>
          <dt>Rechecks</dt>
          <dd>
            {r.rechecks.failed} published claims failed, {r.rechecks.open} still open,{" "}
            {r.rechecks.changed} revised; {r.sources.failing} sources failed a quote{" "}
            {QUOTE_FAILED_AT} times or more
          </dd>
          <dt>Reader reports</dt>
          <dd>
            {r.reports.open} open, {r.reports.stale} of them for more than a week
          </dd>
          <dt>Agenda</dt>
          <dd>
            {r.agenda.topics} topics, {r.agenda.stale} with no research session in{" "}
            {STALE_TOPIC_DAYS} days
          </dd>
        </dl>
      </section>

      <section className="block" aria-labelledby="topics-h">
        <div className="block-head">
          <h2 id="topics-h">Claims by topic</h2>
          <p>
            Research drafts this week, what published at once or after the evaluator, what was
            rejected, and what research held for the evaluator.
          </p>
        </div>
        {r.claims.topics.length === 0 ? (
          <p className="empty">No claim was drafted or decided this week.</p>
        ) : (
          <TableWrap label="Claims by topic">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Topic</th>
                  <th scope="col" className="num">
                    Drafted
                  </th>
                  <th scope="col" className="num">
                    Published
                  </th>
                  <th scope="col" className="num">
                    Rejected
                  </th>
                  <th scope="col" className="num">
                    Held
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.claims.topics.map((t) => (
                  <tr key={t.topic}>
                    <th scope="row">{t.topic}</th>
                    <td className="num">{t.drafted}</td>
                    <td className="num">{t.published}</td>
                    <td className="num">{t.rejected}</td>
                    <td className="num">{t.held}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All</th>
                  <td className="num">{r.claims.drafted}</td>
                  <td className="num">{r.claims.published}</td>
                  <td className="num">{r.claims.rejected}</td>
                  <td className="num">{r.claims.held}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </section>

      <section className="block" aria-labelledby="rules-h">
        <div className="block-head">
          <h2 id="rules-h">Rules the evaluator held claims back on</h2>
          <p>
            Code&apos;s own reasons, as research&apos;s task already reads them; test claims left
            out.
          </p>
        </div>
        {r.rules.length === 0 ? (
          <p className="empty">No structural rule held a claim back this week.</p>
        ) : (
          <ul className="rows">
            {r.rules.map((x) => (
              <li key={x.rule} className="row-item">
                <div className="stack-sm">
                  <p style={{ color: "var(--ink)" }}>{x.rule}</p>
                  <p className={`small muted ${s.wrap}`}>
                    Latest: {x.detail} (<span className="mono">{x.claim}</span>)
                  </p>
                </div>
                <span className="row-side">
                  <span className="badge">{x.count}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function FindingRow({
  finding: f,
  settings,
  waiting,
  sent,
  onSend,
}: {
  finding: Finding;
  settings: DaemonState["settings"] | null;
  waiting: boolean;
  sent: boolean;
  onSend: () => void;
}) {
  const id = `finding-${f.code.replace(".", "-")}${f.subject ? `-${f.subject.replace(/\W+/g, "-")}` : ""}`;
  const done = !!f.proposal && !!settings && proposalDone(f.proposal.command, settings);
  return (
    <article className={`review-item ${s.item}`} aria-labelledby={id} data-code={f.code}>
      <div className="stack-sm">
        <h3 className={s.title} id={id}>
          {TITLE[f.code]}
          {f.code === "rule.broken" && f.subject ? `: ${f.subject}` : ""}
        </h3>
        <p className={s.text}>{findingText(f)}</p>
      </div>
      {f.evidence.length > 0 && (
        <ul className={s.evidence} aria-label="Evidence">
          {f.evidence.map((e) => {
            const where = EVIDENCE[e.kind];
            const external = e.kind === "source";
            return (
              <li key={`${e.kind}:${e.id}`}>
                <span className="muted">{where.label}</span>{" "}
                {external ? (
                  <a className={`mono ${s.wrap}`} href={where.href(e.id)} rel="noreferrer">
                    {e.id}
                  </a>
                ) : (
                  <Link className={`mono ${s.wrap}`} href={where.href(e.id)}>
                    {e.id}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {f.proposal ? (
        done ? (
          <p className="small">
            <span className="badge badge-ok">Done</span>{" "}
            <span className="muted">{doneText(f.proposal.command)}</span>
          </p>
        ) : (
          <div className="toolbar">
            <button
              type="button"
              className={`btn btn-sm btn-primary ${s.propose}`}
              disabled={waiting}
              onClick={onSend}
            >
              {f.proposal.label}
            </button>
            {sent ? (
              <span className="small" aria-live="polite">
                <span className={`badge ${waiting ? "badge-info" : ""}`}>
                  {waiting ? "Sent: waiting for the brain" : "Sent"}
                </span>
              </span>
            ) : (
              <span className="small muted">
                Sends <span className="mono">{f.proposal.command.type}</span>
              </span>
            )}
          </div>
        )
      ) : (
        <p className="small muted">No command fits this one; the evidence says where to look.</p>
      )}
    </article>
  );
}
