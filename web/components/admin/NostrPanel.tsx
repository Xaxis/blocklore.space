"use client";

import type { Command, DaemonState } from "@blocklore/core/control";
import type { NostrView } from "@blocklore/core/nostr";
import { useEffect, useState } from "react";
import { Ago, type Sent, SentList } from "./live";

// "Post to Nostr" in the admin's settings (ORANGECHECK.md, "The Nostr channel"): the switch, the
// channel's key, and under it exactly the notes that would go out next, from the daemon's view.

const KIND: Record<number, string> = {
  0: "Profile",
  1: "Note",
  10002: "Relay list",
  30023: "Article",
};

export function NostrPanel({
  state,
  view,
  send,
  sent,
}: {
  state: DaemonState | null;
  view: NostrView | null;
  send: (cmd: Command, label: string) => Promise<Sent>;
  sent: Sent[];
}) {
  const posting = state?.settings.nostr.post ?? view?.posting ?? false;
  const changed = state?.settings.nostr.changed ?? view?.changed ?? null;
  const ready = !!state && !!view?.pubkey;
  // The switch shows the owner's choice at once and holds still until the brain has applied it;
  // if the command this click sent fails, it goes back to what the brain says.
  const [want, setWant] = useState<{ on: boolean; id: string | null } | null>(null);
  const mine = want?.id ? sent.find((x) => x.id === want.id) : undefined;
  const lost = !!mine && (!!mine.error || mine.result?.phase === "failed");
  useEffect(() => {
    if (want && (want.on === posting || lost)) setWant(null);
  }, [want, posting, lost]);
  const pending = !!want && want.on !== posting && !lost;
  return (
    <section className="block" aria-labelledby="nostr-h">
      <div className="block-head">
        <h2 id="nostr-h">Nostr</h2>
        <span className={`badge ${posting ? "badge-ok" : ""}`}>
          {pending ? "Waiting for the brain" : posting ? "Posting" : "Not posting"}
        </span>
      </div>
      <div className="panel">
        <div className="panel-body stack">
          <label className="check-row">
            <input
              type="checkbox"
              checked={want && pending ? want.on : posting}
              disabled={!ready || pending}
              onChange={async (e) => {
                const on = e.target.checked;
                setWant({ on, id: null });
                const label = on ? "Turn on Post to Nostr" : "Turn off Post to Nostr";
                const { id } = await send({ type: "nostr.post", on }, label);
                setWant((w) => (w && w.on === on ? { on, id } : w));
              }}
            />
            <span>
              <strong>Post to Nostr</strong>
              <span className="small muted" style={{ display: "block" }}>
                The daily digest, each edition sealed in a Bitcoin block and the security watch's
                changes, as notes anyone can follow, built by code from published claims. While it
                is off nothing new is sent; the OrangeCheck records publish either way.
              </span>
            </span>
          </label>

          {view ? (
            <dl className="dl stacked">
              <dt>Channel key</dt>
              <dd className="hash">{view.npub ?? "None yet."}</dd>
              <dt>NIP-05</dt>
              <dd className="mono small">_@blocklore.space</dd>
              <dt>Relays</dt>
              <dd className="mono small">{view.relays.join(", ")}</dd>
              <dt>{posting ? "On since" : changed ? "Off since" : "Off"}</dt>
              <dd className="small">
                {changed ? (
                  <>
                    <Ago iso={changed} />.
                  </>
                ) : (
                  "Never turned on."
                )}{" "}
                {view.published === 1 ? "1 note" : `${view.published} notes`} on two relays.
              </dd>
            </dl>
          ) : (
            <p className="small muted">Waiting for the brain to report the channel.</p>
          )}
          {view?.problem && <p className="callout callout-warn">{view.problem}</p>}
          <SentList sent={sent} />

          {posting && ready && (
            <div className="toolbar">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  send({ type: "nostr.post", on: true }, "Send the waiting Nostr notes now")
                }
              >
                Send the waiting notes now
              </button>
              <span className="small muted">The hourly tick sends them too.</span>
            </div>
          )}

          {view && (
            <div className="stack-sm">
              <h3 id="nostr-next-h">The next notes</h3>
              <p className="small muted">
                {view.next.length + view.more === 0
                  ? "Nothing waits."
                  : `Exactly what would go out, in this order, at most ${view.perTick} an hour${posting ? "" : ", if you turned posting on now"}. Each counts as published once two relays hold it.`}
              </p>
              <ol className="rows" aria-labelledby="nostr-next-h">
                {view.next.map((n) => (
                  <li key={n.id} className="stack-sm" style={{ padding: "var(--s3) 0" }}>
                    <div className="toolbar">
                      <span className="badge badge-outline">
                        {KIND[n.kind] ?? "Kind"} {n.kind}
                      </span>
                      <span className="small">{n.label}</span>
                      <span className="spacer" />
                      {n.event && (
                        <span className="badge badge-info">
                          sent, {n.relays.length} of 2 relays hold it
                        </span>
                      )}
                    </div>
                    {n.content ? (
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: a long note scrolls, and a keyboard must reach it
                      <pre className="code note-preview" tabIndex={0}>
                        {n.content}
                      </pre>
                    ) : (
                      <p className="small muted">No text: only tags.</p>
                    )}
                    {n.tags.length > 0 && (
                      <details>
                        <summary className="small muted">Tags</summary>
                        <pre className="code">{JSON.stringify(n.tags)}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
              {view.more > 0 && <p className="small muted">And {view.more} more after these.</p>}
            </div>
          )}

          {view && view.held.length > 0 && (
            <div className="stack-sm">
              <h3>Held back</h3>
              <p className="small muted">
                The disclosure screen keeps these out of every note. They wait here and never go out
                while the reason stands.
              </p>
              <ul className="rows">
                {view.held.map((h) => (
                  <li key={h.id} className="row-item" style={{ padding: "var(--s2) 0" }}>
                    <span className="small">{h.label}</span>
                    <span className="small muted">{h.reasons.join("; ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view && view.recent.length > 0 && (
            <div className="stack-sm">
              <h3>Sent lately</h3>
              <ul className="rows">
                {view.recent.map((r) => (
                  <li key={r.id} className="row-item" style={{ padding: "var(--s2) 0" }}>
                    <span className="small">{r.label}</span>
                    <span className="row-side">
                      <span className="hash" title={r.event}>
                        {r.event.slice(0, 12)}
                      </span>
                      <span>
                        on {r.relays.length} relays, <Ago iso={r.at} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
