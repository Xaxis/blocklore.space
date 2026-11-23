"use client";

import type { Command, CommandResult, DaemonState, LiveEvent } from "@blocklore/core/control";
import type { NostrView } from "@blocklore/core/nostr";
import { useCallback, useEffect, useRef, useState } from "react";

// The admin's client side: poll the daemon's state (and the live session), send commands, and
// follow each command until the daemon says it is done.

export interface Poll {
  state: DaemonState | null;
  online: boolean;
  live: LiveEvent[] | null;
  /** The Nostr channel's preview, on pages that ask for it. */
  nostr: NostrView | null;
  at: string | null;
}

export interface Sent {
  id: string;
  label: string;
  at: number;
  result: CommandResult | null;
  error: string | null;
}

/** Polls every few seconds while the page is visible; commands' results come along. */
export function useBrain(opts: { live?: boolean; nostr?: boolean; initial?: Partial<Poll> } = {}) {
  const [poll, setPoll] = useState<Poll>({
    state: opts.initial?.state ?? null,
    online: opts.initial?.online ?? false,
    live: opts.initial?.live ?? null,
    nostr: opts.initial?.nostr ?? null,
    at: null,
  });
  const [sent, setSent] = useState<Sent[]>([]);
  const sentRef = useRef(sent);
  sentRef.current = sent;

  const tick = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const open = sentRef.current
      .filter((s) => !s.error && s.result?.phase !== "done" && s.result?.phase !== "failed")
      .map((s) => s.id);
    const q = new URLSearchParams();
    if (opts.live) q.set("live", "1");
    if (opts.nostr) q.set("nostr", "1");
    if (open.length) q.set("results", open.join(","));
    try {
      const res = await fetch(`/api/admin/poll?${q}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const body = (await res.json()) as Poll & { results: Record<string, CommandResult> };
      setPoll((prev) => ({
        state: body.state,
        online: body.online,
        live: body.live,
        nostr: opts.nostr ? (body.nostr ?? prev.nostr) : null,
        at: body.at,
      }));
      if (Object.keys(body.results).length)
        setSent((all) =>
          all.map((s) => (body.results[s.id] ? { ...s, result: body.results[s.id] ?? null } : s)),
        );
    } catch {
      // the next tick tries again
    }
  }, [opts.live, opts.nostr]);

  useEffect(() => {
    tick();
    const t = setInterval(tick, 3000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tick]);

  /** Posts to an admin route that answers {id} or {error}, and tracks the command it queued. */
  const sendTo = useCallback(async (url: string, body: unknown, label: string): Promise<Sent> => {
    let entry: Sent;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = (await res.json()) as { id?: string; error?: string };
      entry = answer.id
        ? { id: answer.id, label, at: Date.now(), result: null, error: null }
        : {
            id: `x-${Date.now()}`,
            label,
            at: Date.now(),
            result: null,
            error: answer.error ?? `HTTP ${res.status}`,
          };
    } catch {
      entry = {
        id: `x-${Date.now()}`,
        label,
        at: Date.now(),
        result: null,
        error: "The site did not answer.",
      };
    }
    setSent((all) => [entry, ...all].slice(0, 12));
    return entry;
  }, []);

  const send = useCallback(
    (cmd: Command, label: string) => sendTo("/api/admin/command", { cmd }, label),
    [sendTo],
  );

  return { ...poll, sent, send, sendTo, refresh: tick };
}

function phaseText(s: Sent): { text: string; tone: string } {
  if (s.error) return { text: s.error, tone: "badge-bad" };
  const r = s.result;
  if (!r) {
    const waited = (Date.now() - s.at) / 1000;
    return {
      text: waited > 60 ? "Waiting for the brain to pick it up" : "Sent",
      tone: "",
    };
  }
  if (r.phase === "received") return { text: "Received, queued on the devbox", tone: "badge-info" };
  if (r.phase === "running") return { text: r.message || "Running", tone: "badge-accent" };
  if (r.phase === "done") return { text: r.message || "Done", tone: "badge-ok" };
  return { text: r.message || "Failed", tone: "badge-bad" };
}

/** What happened to the commands this page sent, newest first. */
export function SentList({ sent }: { sent: Sent[] }) {
  if (!sent.length) return null;
  return (
    <ul className="rows" aria-live="polite" style={{ marginTop: "var(--s4)" }}>
      {sent.map((s) => {
        const p = phaseText(s);
        return (
          <li
            key={s.id}
            className="row-item"
            // A job's result is often a sentence or two; capped, it wraps beside the label
            // instead of taking the row and squeezing the label to a letter a line.
            style={{
              padding: "var(--s2) 0",
              gridTemplateColumns: "minmax(min(12rem, 40%), 1fr) fit-content(28rem)",
            }}
          >
            <span className="small">{s.label}</span>
            <span className="row-side">
              <span
                className={`badge ${p.tone}`}
                style={{
                  whiteSpace: "normal",
                  height: "auto",
                  padding: "0.2rem 0.45rem",
                  textAlign: "left",
                }}
              >
                {p.text}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/** The brain's status in one line: online and what it is doing, or since when it went quiet. */
export function BrainStatus({ state, online }: { state: DaemonState | null; online: boolean }) {
  if (!state)
    return (
      <span className="admin-status off">
        <span className="dot" aria-hidden="true" />
        The brain has not reported yet
      </span>
    );
  const busy = state.activity.kind !== "idle" && state.activity.kind !== "paused";
  const cls = !online ? "off" : busy ? "busy" : "on";
  return (
    <span className={`admin-status ${cls}`}>
      <span className="dot" aria-hidden="true" />
      {!online ? (
        <>
          Offline: last heard <Ago iso={state.at} />
        </>
      ) : state.settings.paused ? (
        "Paused by you"
      ) : busy ? (
        <>
          {state.activity.label} (since <Ago iso={state.activity.since} />)
        </>
      ) : (
        "Online, idle"
      )}
    </span>
  );
}

/** A relative time; the server's and the browser's clocks differ by the render gap, so no warning. */
export function Ago({ iso }: { iso: string }) {
  return (
    <time
      dateTime={iso}
      title={`${iso.slice(0, 16).replace("T", " ")} UTC`}
      suppressHydrationWarning
    >
      {ago(iso)}
    </time>
  );
}

export { ago };
