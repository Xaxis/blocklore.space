"use client";

import type { DaemonState } from "@blocklore/core/control";
import Link from "next/link";
import { useState } from "react";
import { Ago, SentList, useBrain } from "./live";

type Shown = { slug: string; question: string; positions: string[]; claims: number };
type Gone = { slug: string; question: string; at: string; note: string };

/**
 * The owner's veto over debate maps (ADMIN.md, "Debate maps"): withdraw a published map with a
 * reason. Its claims stay published; the map leaves every list, its page says when and why, no map
 * publishes under its slug again, and the reason becomes a lesson for research.
 */
export function DebateMaps({
  initial,
  online,
  shown,
  withdrawn,
}: {
  initial: DaemonState | null;
  online: boolean;
  shown: Shown[];
  withdrawn: Gone[];
}) {
  const b = useBrain({ initial: { state: initial, online } });
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;

  return (
    <>
      <header className="page-header">
        <h1>Debate maps</h1>
        <p className="lede">
          Maps of contested questions, built by research from published claims and kept to the
          debate rules by code. Withdraw one that frames a question unfairly: its claims stay
          published on their own pages, the map leaves every list, its page says when and why, and
          no map publishes under its address again.
        </p>
        <div className="meta">
          <span>
            {shown.length} published, {withdrawn.length} withdrawn
          </span>
          {!b.online && (
            <span className="badge badge-warn">The brain is offline: changes wait for it</span>
          )}
        </div>
      </header>

      <section className="block" aria-labelledby="maps-h">
        <div className="block-head">
          <h2 id="maps-h">Published</h2>
        </div>
        <SentList sent={b.sent} />
        {shown.length === 0 ? (
          <p className="empty">
            No map is published yet. One publishes only on a topic the gate policy marks contested,
            once every claim in it has passed the evaluator.
          </p>
        ) : (
          <ul className="rows">
            {shown.map((d) => (
              <li key={d.slug} className="row-item">
                <div className="stack-sm">
                  <Link href={`/debates/${d.slug}`}>{d.question}</Link>
                  <span className="small muted">
                    {d.positions.join("; ")}. {d.claims} claims.
                  </span>
                  {open === d.slug && (
                    <form
                      className="stack-sm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!ok) return;
                        b.send(
                          { type: "debate.withdraw", slug: d.slug, reason: reason.trim() },
                          `Withdraw the map ${d.slug}`,
                        );
                        setOpen(null);
                        setReason("");
                      }}
                    >
                      <textarea
                        className="textarea"
                        rows={2}
                        maxLength={500}
                        aria-label={`Why withdraw the map ${d.slug}`}
                        placeholder="Why, in a sentence. Readers see it on the map's page."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <div className="toolbar">
                        <button type="submit" className="btn btn-danger btn-sm" disabled={!ok}>
                          Withdraw it
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          onClick={() => setOpen(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
                <span className="row-side">
                  {open !== d.slug && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => {
                        setOpen(d.slug);
                        setReason("");
                      }}
                    >
                      Withdraw
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {withdrawn.length > 0 && (
        <section className="block" aria-labelledby="gone-h">
          <div className="block-head">
            <h2 id="gone-h">Withdrawn</h2>
          </div>
          <ul className="rows">
            {withdrawn.map((d) => (
              <li key={d.slug} className="row-item">
                <div className="stack-sm">
                  <Link href={`/debates/${d.slug}`}>{d.question}</Link>
                  <span className="small muted">
                    {d.note} <Ago iso={d.at} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
