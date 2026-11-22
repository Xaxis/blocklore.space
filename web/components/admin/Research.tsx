"use client";

import type { DaemonState, LiveEvent, Settings } from "@blocklore/core/control";
import { useEffect, useRef, useState } from "react";
import { Ago, BrainStatus, SentList, useBrain } from "./live";
import { RunsTable } from "./Overview";

type R = Settings["research"];
type U = Settings["usage"];

const MODES: { id: R["mode"]; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Only sessions you start here." },
  { id: "daily", label: "Daily", hint: "One session a day at the hour you pick." },
  {
    id: "continuous",
    label: "Continuous",
    hint: "Back to back with a rest between, up to the daily count, while your plan allows.",
  },
];

export function Research({ initial, online }: { initial: DaemonState | null; online: boolean }) {
  const b = useBrain({ live: true, initial: { state: initial, online } });
  const s = b.state;
  const running = s?.activity.kind === "research";
  const [topic, setTopic] = useState("");
  const [focus, setFocus] = useState("");

  return (
    <>
      <header className="page-header">
        <h1>Research</h1>
        <p className="lede">
          A Claude Code session on the devbox researches one topic at a time: it drafts claims with
          sources, code checks every quote and number, a second model tries to falsify them, and the
          gate holds what needs you. It runs on your Claude subscription. Here you start and stop
          it, set when it runs and how long a session may take, and watch it work.
        </p>
        <div className="meta">
          <BrainStatus state={s} online={b.online} />
        </div>
      </header>

      {s && <Subscription s={s} b={b} />}

      <section className="block" aria-labelledby="now-h">
        <div className="block-head">
          <h2 id="now-h">{running ? "Running now" : "Start a session"}</h2>
          {running && s?.activity.run && <span className="mono small">{s.activity.run}</span>}
        </div>
        {running ? (
          <div className="toolbar">
            <span className="small">
              {s?.activity.label}, started {s ? <Ago iso={s.activity.since} /> : ""}.
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => b.send({ type: "research.stop" }, "Stop the running session")}
            >
              Stop it
            </button>
          </div>
        ) : (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              b.send(
                {
                  type: "research.start",
                  topic: topic || null,
                  ...(focus.trim() ? { focus: focus.trim() } : {}),
                },
                `Start research on ${topic || "the planner's pick"}`,
              );
            }}
          >
            <label className="field">
              <span>Topic</span>
              <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">
                  The planner&apos;s pick
                  {s?.research.next.topic ? ` (${s.research.next.topic})` : ""}
                </option>
                {(s?.agenda ?? []).map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.title} ({a.claims} claims{a.pending ? `, ${a.pending} in review` : ""})
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>Focus for this session (optional)</span>
              <input
                className="input"
                maxLength={2000}
                placeholder="What to look at first, in your words"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
              />
            </label>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className="btn btn-primary" disabled={!s}>
                Start now
              </button>
            </div>
          </form>
        )}
        <SentList sent={b.sent} />
      </section>

      <section className="block" aria-labelledby="live-h">
        <div className="block-head">
          <h2 id="live-h">Live</h2>
          <span className="small muted">
            {b.live?.length ? `${b.live.length} events from the last session` : "Nothing yet"}
          </span>
        </div>
        <LiveFeed events={b.live ?? []} />
      </section>

      {s && <Schedule s={s} send={b.send} />}

      {s && (
        <section className="block" aria-labelledby="recent-h">
          <div className="block-head">
            <h2 id="recent-h">Recent sessions</h2>
          </div>
          <RunsTable runs={s.runs.slice(0, 8)} />
        </section>
      )}
    </>
  );
}

function LiveFeed({ events }: { events: LiveEvent[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current && events.length) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  if (!events.length)
    return (
      <p className="empty">
        When a session runs, each step, tool call and message shows here as it happens.
      </p>
    );
  return (
    <ol
      className="live"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      aria-live="off"
    >
      {events.map((e, i) => (
        <li
          key={`${e.at}-${i}`}
          className={e.kind === "phase" || e.kind === "result" ? "phase" : ""}
        >
          <span className="t">{e.at.slice(11, 19)}</span>
          <span className="k">
            {e.role} {e.kind === "tool" ? "tool" : e.kind === "text" ? "says" : ""}
          </span>
          <span className="x">{e.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Schedule({ s, send }: { s: DaemonState; send: ReturnType<typeof useBrain>["send"] }) {
  const [r, setR] = useState<R>(s.settings.research);
  const [use, setUse] = useState<U>(s.settings.usage);
  // Follow the daemon's settings when they change there (another tab, or the CLI).
  const key = JSON.stringify([s.settings.research, s.settings.usage]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for both settings objects
  useEffect(() => {
    setR(s.settings.research);
    setUse(s.settings.usage);
  }, [key]);
  const dirty = JSON.stringify([r, use]) !== key;
  const mode = MODES.find((m) => m.id === r.mode);
  const set = <K extends keyof R>(k: K, v: R[K]) => setR((x) => ({ ...x, [k]: v }));

  return (
    <section className="block" aria-labelledby="sched-h">
      <div className="block-head">
        <h2 id="sched-h">Schedule, model and limits</h2>
        <span className="small muted">
          {s.usage.today.sessions} sessions, {s.usage.today.minutes} minutes today
        </span>
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          send(
            { type: "settings", patch: { research: r, usage: use } },
            "Save the research schedule",
          );
        }}
      >
        <div className="panel-body stack">
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ marginBottom: "var(--s2)" }}>
              When it runs
            </legend>
            <div className="segmented" style={{ maxWidth: "26rem" }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={r.mode === m.id}
                  onClick={() => set("mode", m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="small muted">{mode?.hint}</span>
          </fieldset>

          <div className="form-grid">
            <label className="field">
              <span>Daily session at (UTC)</span>
              <select
                className="select"
                value={r.dailyAt}
                disabled={r.mode !== "daily"}
                onChange={(e) => set("dailyAt", Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Most sessions a day</span>
              <input
                className="input"
                type="number"
                min={1}
                max={24}
                value={r.maxRunsPerDay}
                onChange={(e) => set("maxRunsPerDay", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Rest between sessions (minutes)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1440}
                value={r.restMinutes}
                disabled={r.mode !== "continuous"}
                onChange={(e) => set("restMinutes", Number(e.target.value))}
              />
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Model</span>
              <select
                className="select"
                value={r.model}
                onChange={(e) => set("model", e.target.value as R["model"])}
              >
                <option value="opus">Opus (the best research, uses more of your plan)</option>
                <option value="sonnet">Sonnet (faster, uses less of your plan)</option>
              </select>
            </label>
            <label className="field">
              <span>Most minutes a session</span>
              <input
                className="input"
                type="number"
                min={10}
                max={180}
                value={use.sessionMinutes}
                onChange={(e) => setUse((x) => ({ ...x, sessionMinutes: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Most turns a session</span>
              <input
                className="input"
                type="number"
                min={20}
                max={300}
                value={use.sessionTurns}
                onChange={(e) => setUse((x) => ({ ...x, sessionTurns: Number(e.target.value) }))}
              />
            </label>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={r.skipPending}
              onChange={(e) => set("skipPending", e.target.checked)}
            />
            <span>Leave a topic alone while its claims wait for your review</span>
          </label>

          <div className="toolbar">
            <button type="submit" className="btn btn-primary" disabled={!dirty}>
              Save
            </button>
            {dirty && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setR(s.settings.research);
                  setUse(s.settings.usage);
                }}
              >
                Discard changes
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

/**
 * Research runs on the owner's Claude subscription and nothing else: no API key, nothing billed
 * per token. This says whether the devbox has the token, and when the plan's limit paused work.
 */
/**
 * The Claude subscription every model session runs on. The owner pastes the token `claude
 * setup-token` prints; the site seals it, the devbox checks it with a one-turn session and saves it.
 */
function Subscription({ s, b }: { s: DaemonState; b: ReturnType<typeof useBrain> }) {
  const sub = s.subscription;
  const [token, setToken] = useState("");
  const [start, setStart] = useState(s.settings.research.mode === "off");
  const [open, setOpen] = useState(!sub.token);
  const valid = /^sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]{20,400}$/.test(token.replace(/\s+/g, ""));
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const sent = await b.sendTo(
      "/api/admin/subscription",
      { token },
      "Connect your Claude subscription",
    );
    setToken("");
    if (!sent.error && start)
      await b.send(
        { type: "settings", patch: { research: { mode: "continuous" } } },
        "Let research run on its own",
      );
    if (!sent.error) setOpen(false);
  };
  const word = !sub.token ? "Not connected" : sub.limitedUntil ? "At its limit" : "Connected";
  return (
    <section className="block" aria-labelledby="sub-h">
      <div className="block-head">
        <h2 id="sub-h">Your Claude subscription</h2>
        <span className={`badge ${sub.token && !sub.limitedUntil ? "badge-ok" : "badge-warn"}`}>
          {word}
        </span>
      </div>
      {!sub.token && (
        <p className="callout callout-warn">
          <span>
            Every model session (research, the verifier, the evaluator) runs on your Claude plan and
            nothing else: no API key, nothing billed per token. Until you connect it, nothing
            researches.
          </span>
        </p>
      )}
      {sub.token && sub.limitedUntil && (
        <p className="callout callout-warn">
          <span>
            Your plan's usage limit stopped the last session. Research resumes on its own after{" "}
            {new Date(sub.limitedUntil).toUTCString().slice(5, 22)} UTC.
            {sub.limitedWhy ? ` (${sub.limitedWhy})` : ""}
          </span>
        </p>
      )}
      {sub.token && !sub.limitedUntil && (
        <p className="small">
          Sessions share your plan's usage with your other Claude use. When the plan's limit is
          reached, research pauses and resumes on its own.
        </p>
      )}
      {open ? (
        <form className="stack" onSubmit={connect}>
          <ol className="sub-steps">
            <li>
              On any computer with Claude Code, run <code>claude setup-token</code> and sign in with
              your Claude account.
            </li>
            <li>
              Paste the token it prints here. It is sealed before it leaves this page's server.
            </li>
            <li>
              The devbox checks it with a one-turn session, then saves it. Nothing else is needed.
            </li>
          </ol>
          <label className="field">
            <span>Token</span>
            <input
              className="input mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-oat01-..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-invalid={token !== "" && !valid}
            />
          </label>
          {token !== "" && !valid && (
            <p className="callout callout-warn" role="alert">
              <span>
                That is not a subscription token. It starts with sk-ant-oat; an API key is never
                accepted.
              </span>
            </p>
          )}
          {s.settings.research.mode === "off" && (
            <label className="check-row">
              <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />
              <span>
                Then let research run on its own (continuous, at most{" "}
                {s.settings.research.maxRunsPerDay} sessions a day)
              </span>
            </label>
          )}
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" disabled={!valid}>
              {sub.token ? "Replace the token" : "Connect"}
            </button>
            {sub.token && (
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            Replace the token
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => {
              if (window.confirm("Disconnect? No model session starts until you connect again."))
                b.send({ type: "subscription.disconnect" }, "Disconnect the subscription");
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </section>
  );
}
