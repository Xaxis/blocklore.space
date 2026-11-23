"use client";

import type { DaemonState, ReviewItem } from "@blocklore/core/control";
import {
  type Decision,
  type EvaluatorView,
  MUTATION_LABEL,
  type Mutation,
} from "@blocklore/core/evaluate";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import s from "./Evaluator.module.css";
import { Ago, SentList, useBrain } from "./live";
import { ReviewQueue } from "./ReviewQueue";

type Send = ReturnType<typeof useBrain>["send"];

const STATE: Record<EvaluatorView["state"], { label: string; tone: string }> = {
  ready: { label: "Deciding and publishing", tone: "badge-ok" },
  calibrating: { label: "Calibrating: deciding, not publishing", tone: "badge-info" },
  paused: { label: "Paused: deciding, not publishing", tone: "badge-warn" },
  waiting: { label: "Waiting for the subscription token", tone: "badge-bad" },
  owner: { label: "You decide", tone: "badge-outline" },
};

const OUTCOME: Record<Decision["outcome"], { label: string; tone: string }> = {
  publish: { label: "Published", tone: "badge-ok" },
  hold: { label: "Held", tone: "badge-warn" },
  reject: { label: "Not published", tone: "badge-bad" },
};

const STAGE: Record<string, string> = {
  recheck: "Recheck",
  rules: "Rules",
  "verifier-a": "Verifier A",
  "verifier-b": "Verifier B",
};

const pct = (n: number, of: number) => (of === 0 ? "none yet" : `${Math.round((n / of) * 100)}%`);

/** "it decides ..." or "paused: ..." as a sentence: capitalized, with a full stop. */
const sentence = (t: string) =>
  `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;

/**
 * The owner's evaluator: who decides gated claims, the canary threshold, what the evaluator
 * decided and why at every check, its calibration, and withdrawing any published claim. Every
 * action is a signed command (ADMIN.md).
 */
export function Evaluator({
  initial,
  online,
  view,
  items,
}: {
  initial: DaemonState | null;
  online: boolean;
  view: EvaluatorView | null;
  items: ReviewItem[];
}) {
  const b = useBrain({ initial: { state: initial, online } });
  const router = useRouter();
  const settings = b.state?.settings.evaluator;
  const decides = settings?.decides ?? view?.decides ?? "evaluator";

  // The view comes from the server; load it again when a command lands, and every 20 s.
  const done = b.sent.filter((x) => x.result?.phase === "done").length;
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [router]);

  const state = view ? STATE[decides === "owner" ? "owner" : view.state] : null;

  return (
    <>
      <section className="block" aria-labelledby="who-h">
        <div className="block-head">
          <h2 id="who-h">Who decides</h2>
          {state && <span className={`badge ${state.tone}`}>{state.label}</span>}
        </div>
        <div className="panel">
          <div className="panel-body stack">
            <div className="toolbar">
              <fieldset className="segmented" style={{ width: "18rem" }}>
                <legend className="visually-hidden">Who decides gated claims</legend>
                {(["evaluator", "owner"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={decides === d}
                    disabled={!settings}
                    onClick={() =>
                      decides !== d &&
                      b.send(
                        { type: "settings", patch: { evaluator: { decides: d } } },
                        d === "owner" ? "Hold gated claims for you" : "Let the evaluator decide",
                      )
                    }
                  >
                    {d === "evaluator" ? "The evaluator" : "Hold for me"}
                  </button>
                ))}
              </fieldset>
              <button
                type="button"
                className="btn btn-sm"
                disabled={decides === "owner" || !b.online}
                onClick={() => b.send({ type: "evaluator.run" }, "Evaluate a batch now")}
              >
                Evaluate a batch now
              </button>
            </div>
            <p className="small">
              {decides === "owner"
                ? "Gated claims wait for you below. The evaluator does nothing until you hand it back."
                : view?.why
                  ? sentence(view.why)
                  : "The evaluator decides gated claims as code and publishes what passes every check."}
            </p>
            {view && (
              <dl className={`dl ${s.facts}`}>
                <dt>Waiting</dt>
                <dd>
                  {view.backlog} gated claim{view.backlog === 1 ? "" : "s"}, {view.due} due now
                </dd>
                <dt>Last batch</dt>
                <dd>
                  {view.lastBatch ? (
                    <>
                      <span className="mono">{view.lastBatch.id}</span>: {view.lastBatch.note},{" "}
                      <Ago iso={view.lastBatch.at} />
                    </>
                  ) : (
                    "none yet"
                  )}
                </dd>
                {view.lastBatch && (
                  <>
                    <dt>Signed</dt>
                    <dd>
                      {view.signed ? (
                        <>
                          each decision, by the publisher key{" "}
                          <span className="mono">{view.signed.by}</span>
                          {view.signed.authority === "delegated"
                            ? ", under your delegation"
                            : ", alone: no delegation of yours was in force"}{" "}
                          (<Link href="/admin/signing">Signing</Link>)
                        </>
                      ) : (
                        <>
                          not signed: the devbox has no publisher key (
                          <Link href="/admin/signing">Signing</Link>)
                        </>
                      )}
                    </dd>
                  </>
                )}
                <dt>As of</dt>
                <dd>
                  <Ago iso={view.at} />
                </dd>
              </dl>
            )}
            {!view && (
              <p className="empty">The brain has not sent the evaluator&apos;s state yet.</p>
            )}
            <SentList sent={b.sent} />
          </div>
        </div>
      </section>

      {decides === "owner" && (
        <section className="block" aria-labelledby="queue-h">
          <div className="block-head">
            <h2 id="queue-h">Waiting for you ({items.length})</h2>
          </div>
          <ReviewQueue items={items} />
        </section>
      )}

      <Calibration view={view} settings={settings} send={b.send} />
      <Withdraw view={view} send={b.send} />
      <Decisions view={view} />
    </>
  );
}

function Calibration({
  view,
  settings,
  send,
}: {
  view: EvaluatorView | null;
  settings: DaemonState["settings"]["evaluator"] | undefined;
  send: Send;
}) {
  const [form, setForm] = useState({ rate: "", window: "", batch: "", canaries: "" });
  // Follow the daemon's settings only when they change there: every poll brings a new object, and
  // resetting on each one wiped what the owner was typing.
  const key = JSON.stringify(settings ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the settings object
  useEffect(() => {
    if (settings)
      setForm({
        rate: String(Math.round(settings.minCatchRate * 100)),
        window: String(settings.window),
        batch: String(settings.batchSize),
        canaries: String(settings.canaries),
      });
  }, [key]);
  const c = view?.calibration;
  const n = (v: string) => Number.parseInt(v, 10);
  const valid =
    n(form.rate) >= 50 &&
    n(form.rate) <= 100 &&
    n(form.window) >= 5 &&
    n(form.window) <= 200 &&
    n(form.batch) >= 1 &&
    n(form.batch) <= 30 &&
    n(form.canaries) >= 1 &&
    n(form.canaries) <= 10;
  const field = (key: keyof typeof form, label: string, hint: string, min: number, max: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      <small>{hint}</small>
    </label>
  );
  return (
    <section className="block" aria-labelledby="cal-h">
      <div className="block-head">
        <h2 id="cal-h">Calibration</h2>
        <span className="small muted">
          Test claims are copies of published claims with one thing made false.
        </span>
      </div>
      {c && (
        <div className="stats" style={{ marginBottom: "var(--s4)" }}>
          <div className="stat">
            <strong>{pct(c.recentCaught, c.recent)}</strong>
            <span>Caught lately</span>
            <small>
              {c.recentCaught} of the last {c.recent}; publishing needs{" "}
              {Math.round(c.threshold * 100)}%
            </small>
          </div>
          <div className="stat">
            <strong>{pct(c.caught, c.total)}</strong>
            <span>Caught in all</span>
            <small>
              {c.caught} of {c.total}
            </small>
          </div>
        </div>
      )}
      <div className="grid-2">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            send(
              {
                type: "settings",
                patch: {
                  evaluator: {
                    minCatchRate: n(form.rate) / 100,
                    window: n(form.window),
                    batchSize: n(form.batch),
                    canaries: n(form.canaries),
                  },
                },
              },
              `Set the evaluator's threshold to ${n(form.rate)}%`,
            );
          }}
        >
          <div className="panel-body stack">
            <div className="form-grid">
              {field("rate", "Threshold (%)", "Publishing pauses below this catch rate.", 50, 100)}
              {field("window", "Measured over", "The last this many test claims.", 5, 200)}
              {field(
                "batch",
                "Claims per batch",
                "What the verifiers read at once. Code rejects do not count.",
                1,
                30,
              )}
              {field("canaries", "Test claims per batch", "More while it calibrates.", 1, 10)}
            </div>
            <div className="toolbar">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!settings || !valid}
              >
                Save
              </button>
            </div>
          </div>
        </form>
        {c && c.kinds.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Made false</th>
                <th scope="col" className="num">
                  Tried
                </th>
                <th scope="col" className="num">
                  Caught
                </th>
              </tr>
            </thead>
            <tbody>
              {c.kinds.map((k) => (
                <tr key={k.kind}>
                  <th scope="row">{MUTATION_LABEL[k.kind as Mutation] ?? k.kind}</th>
                  <td className="num">{k.n}</td>
                  <td className="num">{pct(k.caught, k.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No test claims yet. The first batch mixes in at least five.</p>
        )}
      </div>
    </section>
  );
}

function Withdraw({ view, send }: { view: EvaluatorView | null; send: Send }) {
  const [id, setId] = useState("");
  const [found, setFound] = useState<{ id: string; hash: string; statement: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const lookUp = async () => {
    setProblem("");
    setFound(null);
    const want = id.trim();
    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(want))
      return setProblem("A claim id looks like topic.slug.");
    try {
      const res = await fetch(`/api/v1/claims/${want}`, { cache: "no-store" });
      const body = (await res.json()) as {
        claim?: { id: string; hash: string; statement: string; status: string };
      };
      if (!body.claim) return setProblem(`No published claim has the id ${want}.`);
      if (body.claim.status === "withdrawn") return setProblem(`${want} is already withdrawn.`);
      setFound(body.claim);
      setOpen(body.claim.id);
    } catch {
      setProblem("The site did not answer.");
    }
  };

  const recent = view?.published ?? [];
  return (
    <section className="block" aria-labelledby="withdraw-h">
      <div className="block-head">
        <h2 id="withdraw-h">Withdraw a claim</h2>
        <span className="small muted">
          Any published claim. It leaves every topic and search, keeps its page with your reason,
          and becomes a test claim and a lesson for research.
        </span>
      </div>
      <form
        className="toolbar"
        style={{ marginBottom: "var(--s4)" }}
        onSubmit={(e) => {
          e.preventDefault();
          lookUp();
        }}
      >
        <input
          className="input mono"
          style={{ flex: 1, minWidth: "16rem" }}
          aria-label="Claim id"
          placeholder="topic.slug, for example taproot.activation-height"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <button type="submit" className="btn btn-sm">
          Look up
        </button>
      </form>
      {problem && <p className="callout callout-warn">{problem}</p>}
      <ul className="rows">
        {[...(found && !recent.some((p) => p.id === found.id) ? [found] : []), ...recent].map(
          (p) => (
            <li key={p.id} className={`row-item ${s.withdrawRow}`}>
              <div className="stack-sm">
                <p className={s.statement}>{p.statement}</p>
                <span className="small muted mono">{p.id}</span>
                {open === p.id && (
                  <RevokeForm
                    claim={p}
                    send={send}
                    onDone={() => {
                      setOpen(null);
                      setFound(null);
                    }}
                  />
                )}
              </div>
              <span className="row-side">
                {open !== p.id && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => setOpen(p.id)}
                  >
                    Withdraw
                  </button>
                )}
              </span>
            </li>
          ),
        )}
      </ul>
      {recent.length === 0 && !found && (
        <p className="empty">
          The evaluator has published nothing lately. Look up any claim by its id.
        </p>
      )}
    </section>
  );
}

function RevokeForm({
  claim,
  send,
  onDone,
}: {
  claim: { id: string; hash: string };
  send: Send;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        send(
          { type: "claim.revoke", id: claim.id, hash: claim.hash, reason: reason.trim() },
          `Withdraw ${claim.id}`,
        );
        onDone();
      }}
    >
      <textarea
        className="textarea"
        rows={2}
        maxLength={500}
        aria-label={`Why withdraw ${claim.id}`}
        placeholder="Why, in a sentence. Readers see it on the claim's page."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="toolbar">
        <button type="submit" className="btn btn-danger btn-sm" disabled={!ok}>
          Withdraw it
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Decisions({ view }: { view: EvaluatorView | null }) {
  const [show, setShow] = useState<"all" | "real" | "test">("all");
  const all = view?.decisions ?? [];
  const shown = all.filter((d) =>
    show === "all" ? true : show === "test" ? !!d.canary : !d.canary,
  );
  return (
    <section className="block" aria-labelledby="decisions-h">
      <div className="block-head">
        <h2 id="decisions-h">Recent decisions</h2>
        <fieldset className="segmented" style={{ width: "18rem" }}>
          <legend className="visually-hidden">Show</legend>
          {(
            [
              ["all", "All"],
              ["real", "Claims"],
              ["test", "Test claims"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {shown.length === 0 ? (
        <p className="empty">No decisions yet.</p>
      ) : (
        <ul className="rows">
          {shown.map((d) => (
            <li key={`${d.batch}-${d.id}`} className={s.decision}>
              <div className={s.decisionHead}>
                <span className={`badge ${OUTCOME[d.outcome].tone}`}>
                  {OUTCOME[d.outcome].label}
                </span>
                {d.canary ? (
                  <span className="badge badge-outline">
                    Test claim: {MUTATION_LABEL[d.canary.kind]}, from {d.canary.source}
                  </span>
                ) : (
                  <span className="mono small">{d.id}</span>
                )}
                <span className="small muted">
                  <Ago iso={d.at} />
                </span>
              </div>
              <p className={s.statement}>{d.statement}</p>
              <p className="small">{d.why}</p>
              <details>
                <summary className="small">Every check</summary>
                <table className={`table ${s.stages}`}>
                  <tbody>
                    {d.stages.map((x) => (
                      <tr key={x.stage}>
                        <th scope="row">
                          {STAGE[x.stage] ?? x.stage}
                          {x.model ? <span className="small muted"> ({x.model})</span> : null}
                        </th>
                        <td>
                          <span
                            className={`badge ${x.ok === true ? "badge-ok" : x.ok === false ? "badge-bad" : "badge-warn"}`}
                          >
                            {x.ok === true
                              ? "Passed"
                              : x.ok === false
                                ? "Failed"
                                : "Could not finish"}
                          </span>
                        </td>
                        <td className="small">{x.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.reasons.length > 0 && (
                  <p className="small muted">Held for closer checks: {d.reasons.join("; ")}</p>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
