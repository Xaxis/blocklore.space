"use client";

import type { AgendaTopic, DaemonState } from "@blocklore/core/control";
import { useState } from "react";
import { SentList, useBrain } from "./live";

const EMPTY: AgendaTopic = { slug: "", title: "", group: "", scope: "" };

/** The topics research works through: what each covers, and how far along it is. */
export function Agenda({ initial, online }: { initial: DaemonState | null; online: boolean }) {
  const b = useBrain({ initial: { state: initial, online } });
  const agenda = b.state?.agenda ?? [];
  const [edit, setEdit] = useState<AgendaTopic | null>(null);
  const [isNew, setIsNew] = useState(false);
  const groups = [...new Set(agenda.map((a) => a.group))].sort();

  return (
    <>
      <header className="page-header">
        <h1>Agenda</h1>
        <p className="lede">
          The topics research works through. The scope is the brief a session gets for the topic;
          the planner picks the topic with the most need (open gaps, reader questions, thin depths)
          unless you start one yourself.
        </p>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEdit({ ...EMPTY, group: groups[0] ?? "" });
              setIsNew(true);
            }}
          >
            Add a topic
          </button>
        </div>
      </header>

      {edit && (
        <form
          className="panel block"
          onSubmit={(e) => {
            e.preventDefault();
            b.send(
              { type: "agenda.save", topic: edit },
              `${isNew ? "Add" : "Save"} topic ${edit.slug}`,
            );
            setEdit(null);
          }}
        >
          <div className="panel-head">
            <h2>{isNew ? "New topic" : `Edit ${edit.title}`}</h2>
          </div>
          <div className="panel-body stack">
            <div className="form-grid">
              <label className="field">
                <span>Title</span>
                <input
                  className="input"
                  required
                  minLength={2}
                  maxLength={120}
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Slug (in URLs; fixed once published)</span>
                <input
                  className="input mono"
                  required
                  pattern="[a-z0-9][a-z0-9-]{0,62}"
                  value={edit.slug}
                  readOnly={!isNew}
                  onChange={(e) => setEdit({ ...edit, slug: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Group</span>
                <input
                  className="input mono"
                  required
                  list="agenda-groups"
                  pattern="[a-z0-9][a-z0-9-]{0,62}"
                  value={edit.group}
                  onChange={(e) => setEdit({ ...edit, group: e.target.value })}
                />
                <datalist id="agenda-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>
            </div>
            <label className="field">
              <span>Scope: what the topic covers, and what it leaves out</span>
              <textarea
                className="textarea"
                required
                minLength={20}
                maxLength={4000}
                rows={6}
                value={edit.scope}
                onChange={(e) => setEdit({ ...edit, scope: e.target.value })}
              />
            </label>
            <div className="toolbar">
              <button type="submit" className="btn btn-primary">
                Save and commit
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setEdit(null)}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      <SentList sent={b.sent} />

      {agenda.length === 0 ? (
        <p className="empty">The brain has not reported its agenda yet.</p>
      ) : (
        <div className="table-wrap block">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Group</th>
                <th scope="col" className="num">
                  Claims
                </th>
                <th scope="col" className="num">
                  In review
                </th>
                <th
                  scope="col"
                  className="num"
                  title="The planner's need score: higher runs sooner"
                >
                  Need
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {[...agenda]
                .sort((a, c) => c.score - a.score)
                .map((a) => (
                  <tr key={a.slug}>
                    <th scope="row">
                      {a.title}
                      <div className="small muted" style={{ fontWeight: 400, maxWidth: "36rem" }}>
                        {a.scope.length > 160 ? `${a.scope.slice(0, 157)}...` : a.scope}
                      </div>
                    </th>
                    <td className="mono small">{a.group}</td>
                    <td className="num">{a.claims}</td>
                    <td className="num">{a.pending || ""}</td>
                    <td className="num">{a.score.toFixed(1)}</td>
                    <td>
                      <div className="toolbar" style={{ flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            b.send(
                              { type: "research.start", topic: a.slug },
                              `Research ${a.title} now`,
                            )
                          }
                        >
                          Research
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          onClick={() => {
                            setEdit({
                              slug: a.slug,
                              title: a.title,
                              group: a.group,
                              scope: a.scope,
                            });
                            setIsNew(false);
                          }}
                        >
                          Edit
                        </button>
                        {a.claims === 0 && (
                          <button
                            type="button"
                            className="btn btn-quiet btn-sm"
                            onClick={() => {
                              if (window.confirm(`Remove ${a.title} from the agenda?`))
                                b.send(
                                  { type: "agenda.remove", slug: a.slug },
                                  `Remove ${a.title}`,
                                );
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
