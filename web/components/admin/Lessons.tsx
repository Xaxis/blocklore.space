"use client";

import type { DaemonState } from "@blocklore/core/control";
import { useEffect, useState } from "react";
import { Ago, SentList, useBrain } from "./live";

/**
 * The owner's standing words to research: a current focus, and lessons that stay until removed.
 * Both reach every session as the owner's, in a section of their own (ADMIN.md).
 */
export function Lessons({ initial, online }: { initial: DaemonState | null; online: boolean }) {
  const b = useBrain({ initial: { state: initial, online } });
  const s = b.state;
  const [focus, setFocus] = useState(s?.settings.focus ?? "");
  const [lesson, setLesson] = useState("");
  const saved = s?.settings.focus ?? "";
  useEffect(() => setFocus(saved), [saved]);
  const lessons = s?.settings.lessons ?? [];

  return (
    <>
      <header className="page-header">
        <h1>Lessons and focus</h1>
        <p className="lede">
          What you tell research in your own words. The focus steers every session until you clear
          it; lessons are standing notes, often the reason you gave when rejecting a claim. Neither
          can override the editorial rules or the gate.
        </p>
      </header>

      <section className="block" aria-labelledby="focus-h">
        <div className="block-head">
          <h2 id="focus-h">Current focus</h2>
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            b.send(
              { type: "settings", patch: { focus: focus.trim() } },
              focus.trim() ? "Set the research focus" : "Clear the research focus",
            );
          }}
        >
          <textarea
            className="textarea"
            rows={4}
            maxLength={2000}
            aria-label="Current focus"
            placeholder="For example: prioritize the covenant proposals; look for primary sources from the mailing list before blog posts."
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
          <div className="toolbar">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={focus.trim() === saved}
            >
              Save focus
            </button>
            {saved && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() =>
                  b.send({ type: "settings", patch: { focus: "" } }, "Clear the research focus")
                }
              >
                Clear
              </button>
            )}
            <span className="small muted">{focus.length} of 2000</span>
          </div>
        </form>
      </section>

      <section className="block" aria-labelledby="lessons-h">
        <div className="block-head">
          <h2 id="lessons-h">Lessons ({lessons.length})</h2>
        </div>
        <form
          className="toolbar"
          style={{ marginBottom: "var(--s4)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (lesson.trim().length < 3) return;
            b.send({ type: "lesson.add", text: lesson.trim() }, "Add a lesson");
            setLesson("");
          }}
        >
          <input
            className="input"
            style={{ flex: 1, minWidth: "16rem" }}
            maxLength={600}
            aria-label="New lesson"
            placeholder="A standing note for research"
            value={lesson}
            onChange={(e) => setLesson(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" disabled={lesson.trim().length < 3}>
            Add lesson
          </button>
        </form>
        <SentList sent={b.sent} />
        {lessons.length === 0 ? (
          <p className="empty">
            No lessons yet. Rejecting a claim with &quot;Teach research this&quot; adds one.
          </p>
        ) : (
          <ul className="rows">
            {[...lessons].reverse().map((l) => (
              <li key={l.id} className="row-item">
                <div className="stack-sm">
                  <p style={{ color: "var(--ink)" }}>{l.text}</p>
                  <span className="small muted">
                    {l.from === "review" ? "From a review" : "Added by you"}, <Ago iso={l.at} />
                  </span>
                </div>
                <span className="row-side">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => b.send({ type: "lesson.remove", id: l.id }, "Remove a lesson")}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
