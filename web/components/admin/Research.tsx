"use client";

import type { DaemonState, LiveEvent, Settings } from "@blocklore/core/control";
import { useEffect, useRef, useState } from "react";
import { Ago, BrainStatus, SentList, useBrain } from "./live";
import { RunsTable } from "./Overview";

type R = Settings["research"];
type B = Settings["budget"];

const MODES: { id: R["mode"]; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Only sessions you start here." },
  { id: "daily", label: "Daily", hint: "One session a day at the hour you pick." },
  {
    id: "continuous",
    label: "Continuous",
    hint: "Back to back with a rest between, up to the daily count, while the budget allows.",
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
          gate holds what needs you. Here you start and stop it, set when it runs and what it may
          spend, and watch it work.
        </p>
        <div className="meta">
          <BrainStatus state={s} online={b.online} />
        </div>
      </header>

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
  const [bud, setBud] = useState<B>(s.settings.budget);
  // Follow the daemon's settings when they change there (another tab, or the CLI).
  const key = JSON.stringify([s.settings.research, s.settings.budget]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for both settings objects
  useEffect(() => {
    setR(s.settings.research);
    setBud(s.settings.budget);
  }, [key]);
  const dirty = JSON.stringify([r, bud]) !== key;
  const mode = MODES.find((m) => m.id === r.mode);
  const set = <K extends keyof R>(k: K, v: R[K]) => setR((x) => ({ ...x, [k]: v }));

  return (
    <section className="block" aria-labelledby="sched-h">
      <div className="block-head">
        <h2 id="sched-h">Schedule, model and budget</h2>
        <span className="small muted">
          Spent today ${s.spend.today.toFixed(2)} of ${s.settings.budget.dailyUsd.toFixed(2)}
        </span>
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          send(
            { type: "settings", patch: { research: r, budget: bud } },
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
                <option value="opus">Opus (best research, costs more)</option>
                <option value="sonnet">Sonnet (faster, cheaper)</option>
              </select>
            </label>
            <label className="field">
              <span>Pays with</span>
              <select
                className="select"
                value={r.credential}
                onChange={(e) => set("credential", e.target.value as R["credential"])}
              >
                <option value="api">
                  API key, billed per token{s.credentials.api ? "" : " (not set)"}
                </option>
                <option value="plan">
                  Your Claude plan{s.credentials.plan ? "" : " (not set)"}
                </option>
              </select>
            </label>
            <label className="field">
              <span>Daily budget (USD)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1000}
                step={1}
                value={bud.dailyUsd}
                onChange={(e) => setBud((x) => ({ ...x, dailyUsd: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Most per session (USD)</span>
              <input
                className="input"
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={bud.perRunUsd}
                onChange={(e) => setBud((x) => ({ ...x, perRunUsd: Number(e.target.value) }))}
              />
            </label>
          </div>

          {r.credential === "plan" && !s.credentials.plan && (
            <p className="callout callout-warn">
              <span>
                The devbox has no plan token yet. Run <code>claude setup-token</code> there and put
                the token in <code>.env</code> as <code>CLAUDE_CODE_OAUTH_TOKEN</code>. Plan usage
                is shared with your other Claude sessions; the dollar budget still caps what the
                sessions would cost on the API.
              </span>
            </p>
          )}
          {r.credential === "api" && !s.credentials.api && (
            <p className="callout callout-warn">
              <span>
                The devbox has no <code>ANTHROPIC_API_KEY</code> in <code>.env</code>.
              </span>
            </p>
          )}

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
                  setBud(s.settings.budget);
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
