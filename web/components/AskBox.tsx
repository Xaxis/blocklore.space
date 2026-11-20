"use client";

import { DEPTH_LABEL, DEPTHS, type Depth, type QueueStatus } from "@blocklore/core";
import Link from "next/link";
import { useRef, useState } from "react";
import type { AskEvent, AskResult } from "@/lib/ask";
import { DEPTH_HINT, KIND_LABEL } from "@/lib/labels";

type Summary = AskResult["read"][number];
type State =
  | { phase: "idle" }
  | { phase: "asking"; question: string; read: Summary[] | null }
  | { phase: "done"; result: AskResult }
  | { phase: "error"; message: string };

const MAX = 300;

/**
 * The question box. The question goes in a POST body and comes back as two lines of NDJSON: the
 * claims search found, then the checked answer (or the claims alone, and why). Nothing is kept in
 * the browser.
 */
export function AskBox({ examples, initialDepth }: { examples: string[]; initialDepth: Depth }) {
  const [q, setQ] = useState("");
  const [depth, setDepth] = useState<Depth>(initialDepth);
  const [state, setState] = useState<State>({ phase: "idle" });
  const result = useRef<HTMLDivElement>(null);

  async function submit(question: string) {
    const text = question.trim();
    if (!text || state.phase === "asking") return;
    setState({ phase: "asking", question: text, read: null });
    try {
      const res = await fetch("/api/v1/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ q: text, depth }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ phase: "error", message: body?.error ?? `The server answered ${res.status}.` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
          if (!line) continue;
          const e = JSON.parse(line) as AskEvent;
          if (e.type === "read") setState({ phase: "asking", question: text, read: e.read });
          else if (e.type === "result") setState({ phase: "done", result: e.result });
          else setState({ phase: "error", message: e.error });
        }
        if (done) break;
      }
    } catch {
      setState({ phase: "error", message: "The connection failed. Try again in a moment." });
    }
    requestAnimationFrame(() => result.current?.focus());
  }

  return (
    <div className="ask">
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <label htmlFor="ask-q" className="visually-hidden">
          Your question about Bitcoin
        </label>
        <textarea
          id="ask-q"
          value={q}
          maxLength={MAX}
          rows={2}
          placeholder="Ask about how Bitcoin works, its history or its proposals"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(q);
            }
          }}
        />
        <div className="ask-row">
          <fieldset className="dial-stops ask-depth">
            <legend className="visually-hidden">Write the answer for</legend>
            {DEPTHS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === depth}
                title={DEPTH_HINT[d]}
                onClick={() => setDepth(d)}
              >
                {DEPTH_LABEL[d]}
              </button>
            ))}
          </fieldset>
          <button type="submit" className="ask-go" disabled={!q.trim() || state.phase === "asking"}>
            {state.phase === "asking" ? "Reading" : "Ask"}
          </button>
        </div>
        <p className="ask-small">
          {q.length > MAX - 60 ? `${MAX - q.length} characters left. ` : ""}
          Never paste a seed, key or address: Blocklore refuses them and never needs them.
        </p>
      </form>

      {state.phase === "idle" && (
        <div className="ask-examples">
          <span>Try</span>
          {examples.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => {
                setQ(x);
                submit(x);
              }}
            >
              {x}
            </button>
          ))}
        </div>
      )}

      <div ref={result} tabIndex={-1} className="ask-result" aria-live="polite">
        {state.phase === "asking" && (
          <p className="muted ask-status">
            {state.read === null
              ? "Searching the published claims"
              : state.read.length
                ? `Writing an answer from ${state.read.length} claims`
                : "No claim matches"}
            <span className="ask-dots" aria-hidden="true" />
          </p>
        )}
        {state.phase === "error" && <p className="callout">{state.message}</p>}
        {state.phase === "done" && <Result r={state.result} />}
      </div>
    </div>
  );
}

function Result({ r }: { r: AskResult }) {
  const a = r.answer;
  const cited = new Set(r.cited.map((c) => c.id));
  const others = r.read.filter((c) => !cited.has(c.id));
  return (
    <article className="ask-answer">
      <h2 className="ask-q">{r.question}</h2>
      {a && a.sentences.length > 0 && (
        <p className="ask-text">
          {a.sentences.map((s, i) => (
            <span key={`${i}-${s.text.slice(0, 12)}`}>
              {s.text}
              {s.cites.map((n) => (
                <a key={n} className="cite" href={`#cited-${n}`}>
                  [{n}]
                </a>
              ))}{" "}
            </span>
          ))}
        </p>
      )}
      {a?.verdict === "partial" && a.missing && (
        <p className="ask-missing">
          <strong>Not covered yet:</strong> {a.missing}
        </p>
      )}
      {a?.verdict === "not_covered" && (
        <p className="callout">
          <strong>Not covered yet.</strong>{" "}
          {a.missing ?? "Blocklore's published claims do not answer this question."}
        </p>
      )}
      {r.note && <p className="callout">{r.note}</p>}
      {r.queue_ticket && <QueueButton r={r} ticket={r.queue_ticket} />}

      {r.cited.length > 0 && (
        <>
          <h3>The claims this answer rests on</h3>
          <ol className="ask-claims">
            {r.cited.map((c, i) => (
              <li key={c.id} id={`cited-${i + 1}`}>
                <ClaimItem c={c} />
              </li>
            ))}
          </ol>
        </>
      )}
      {others.length > 0 && (
        <details className="ask-others" open={!a || a.sentences.length === 0}>
          <summary>
            {r.cited.length
              ? `Also read: ${others.length} more claims`
              : `Claims that match best (${others.length})`}
          </summary>
          <ul className="ask-claims">
            {others.map((c) => (
              <li key={c.id}>
                <ClaimItem c={c} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="ask-made muted">
        {r.mode === "answer" || r.mode === "cached"
          ? `Written by ${r.model} from ${r.read.length} published claims${r.mode === "cached" ? " (an answer given earlier today to the same question)" : ""}. Each sentence was checked to cite only claims it was given. The claims are the record: open one to see its sources and checks.`
          : "No model wrote anything here; these are search results over the published claims."}
      </p>
    </article>
  );
}

type Queued =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "done"; added: boolean; asks: number; status: QueueStatus }
  | { phase: "error"; message: string };

/** For a question about Bitcoin the claims do not answer yet: hands it to the research queue. */
function QueueButton({ r, ticket }: { r: AskResult; ticket: string }) {
  const [s, setS] = useState<Queued>({ phase: "idle" });
  async function send() {
    setS({ phase: "sending" });
    try {
      const res = await fetch("/api/v1/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: r.question, ticket, missing: r.answer?.missing ?? "" }),
      });
      const body = (await res.json()) as {
        error?: string;
        queued?: boolean;
        item?: { asks: number; status: QueueStatus };
      };
      if (!res.ok || !body.item) throw new Error(body.error ?? `The queue answered ${res.status}.`);
      setS({ phase: "done", added: !!body.queued, asks: body.item.asks, status: body.item.status });
    } catch (e) {
      setS({
        phase: "error",
        message: e instanceof Error ? e.message : "The queue did not answer.",
      });
    }
  }
  if (s.phase === "done")
    return (
      <p className="ask-queued" role="status">
        {s.status === "declined" ? (
          "Blocklore looked at this question before and is not researching it."
        ) : s.status === "answered" ? (
          <>
            Answered since it was first asked: see <Link href="/queue">the research queue</Link>.
          </>
        ) : (
          <>
            {s.added ? "Queued for research. " : `Already queued; asked ${s.asks} times now. `}
            Progress shows on <Link href="/queue">the research queue</Link> once it is triaged.
          </>
        )}
      </p>
    );
  return (
    <div className="ask-queue">
      <button type="button" className="ask-ghost" onClick={send} disabled={s.phase === "sending"}>
        {s.phase === "sending" ? "Queueing..." : "Ask Blocklore to research this"}
      </button>
      <span className="ask-small">
        {s.phase === "error"
          ? s.message
          : "Adds your question, with links and contacts removed, to the research queue."}
      </span>
    </div>
  );
}

function ClaimItem({ c }: { c: Summary }) {
  return (
    <>
      <Link href={`/claims/${c.id}`}>{c.statement}</Link>
      <span className="ask-meta">
        {KIND_LABEL[c.kind]}, {DEPTH_LABEL[c.depth]}
        {c.status !== "established" ? `, ${c.status}` : ""}, {c.sources} source
        {c.sources === 1 ? "" : "s"}
      </span>
    </>
  );
}
