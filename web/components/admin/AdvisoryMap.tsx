"use client";

import type {
  AdminAdvisory,
  AdminExpectation,
  AdminFinding,
  AdminPlacement,
  AdvisoryAdminView,
  AdvisoryCommand,
} from "@blocklore/core/advisoryadmin";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { date } from "@/lib/format";
import s from "./AdvisoryMap.module.css";
import { SentList, useBrain } from "./live";

// The owner's advisory map (ADMIN.md, "Advisories and NVD"): every advisory no rule files, to file
// under threats or mark as concerning none; every NVD finding of the threat map, to settle by
// recording the project NVD names; and the owner's own entries, each with an undo. Every action is
// a signed command; the brain edits knowledge/security/advisory-map.yaml, commits it as the
// owner's and ships it, and the page follows when the daemon reports the job done.

const FINDING_LABEL: Record<AdminFinding["finding"], string> = {
  missing: "No NVD record",
  rejected: "Rejected by NVD",
  product: "Another product",
  unnamed: "Product unclear",
};

/** Why a finding that no recorded project can settle stays open. */
const OPEN_WHY: Record<Exclude<AdminFinding["finding"], "product">, string> = {
  missing:
    "NVD has no record of this id, so there is no product to record. It stays open; the brain asks NVD again a day after each miss.",
  rejected:
    "NVD lists this id as rejected. Recording a project would not change that; check the threat's record instead.",
  unnamed:
    "NVD's record lists no product, so there is nothing to record yet. It stays open until NVD analyses it.",
};

const SENDING = "sending";
const PAIR = /^[a-z0-9_.-]+:[a-z0-9_.-]+$/;
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9 .+_-]{1,39}$/;
const nvdUrl = (id: string) => `https://nvd.nist.gov/vuln/detail/${id}`;

/** A first guess at the project's name from NVD's pair: "libbitcoin:libbitcoin_explorer" gives "libbitcoin explorer". */
const guessName = (pair: string) =>
  (pair.split(":")[1] ?? pair)
    .replace(/_/g, " ")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 40);

const list = (items: ReactNode[]) =>
  items.map((x, i) => (
    <span key={i}>
      {i > 0 && (i === items.length - 1 ? " and " : ", ")}
      {x}
    </span>
  ));

export function AdvisoryMap({ view }: { view: AdvisoryAdminView | null }) {
  const router = useRouter();
  const b = useBrain();
  // Which command each row sent, so the row waits until the brain reports it done or failed.
  const [rows, setRows] = useState<Record<string, string>>({});
  const doneCount = b.sent.filter((x) => x.result?.phase === "done").length;
  useEffect(() => {
    if (doneCount > 0) router.refresh();
  }, [doneCount, router]);

  if (!view)
    return (
      <>
        <p className="empty">
          The brain has not sent the advisory map yet. It does on its next sync, within a minute of
          this page opening.
        </p>
        <SentList sent={b.sent} />
      </>
    );

  const waiting = (row: string) => {
    if (rows[row] === SENDING) return true;
    const x = b.sent.find((y) => y.id === rows[row]);
    return !!x && !x.error && x.result?.phase !== "done" && x.result?.phase !== "failed";
  };
  const send = async (row: string, cmd: AdvisoryCommand, label: string) => {
    // The row waits from the click, so a second click cannot send the same change twice.
    setRows((r) => ({ ...r, [row]: SENDING }));
    const x = await b.send(cmd, label);
    setRows((r) => ({ ...r, [row]: x.id }));
  };
  const titles = new Map(view.threats.map((t) => [t.id, t.title]));
  const threatLink = (id: string) => (
    <Link key={id} href={`/security/${id}`}>
      {titles.get(id) ?? id}
    </Link>
  );

  return (
    <>
      <SentList sent={b.sent} />

      <section className="block" aria-labelledby="tomap-h">
        <div className="block-head">
          <h2 id="tomap-h">Advisories to map</h2>
          <p>
            Advisories the watch read that no rule files under a threat. File each under the threats
            it concerns, or say it concerns none; either way it leaves /gaps.
          </p>
        </div>
        {view.unmatched.length === 0 ? (
          <p className="empty">Every advisory the watch has read is filed, or placed by you.</p>
        ) : (
          <div className="panel">
            <div className="panel-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
              {view.unmatched.map((a) => (
                <ToMap
                  key={a.key}
                  advisory={a}
                  view={view}
                  waiting={waiting(`assign:${a.key}`)}
                  onSend={(cmd, label) => send(`assign:${a.key}`, cmd, label)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="block" aria-labelledby="findings-h">
        <div className="block-head">
          <h2 id="findings-h">NVD findings</h2>
          <p>
            CVE ids of the threat map whose NVD record disagrees with it. When the record rightly
            names another project, record that project as the one expected for the id; it applies on
            every threat that names the id. Anything left here stays open on the threat&apos;s page.
          </p>
        </div>
        {view.findings.length === 0 ? (
          <p className="empty">NVD agrees with every CVE id of the threat map it has checked.</p>
        ) : (
          <div className="panel">
            <div className="panel-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
              {view.findings.map((f) => (
                <Finding
                  key={f.id}
                  finding={f}
                  projects={view.projects}
                  threatLink={threatLink}
                  waiting={waiting(`expect:${f.id}`)}
                  onSend={(cmd, label) => send(`expect:${f.id}`, cmd, label)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="block" aria-labelledby="placed-h">
        <div className="block-head">
          <h2 id="placed-h">Your placements</h2>
          <p>
            Advisories you filed. Undo takes your placement out of the map, and the rules file the
            advisory again (or list it to map).
          </p>
        </div>
        {view.placed.length === 0 ? (
          <p className="empty">You have placed no advisory yet.</p>
        ) : (
          <ul className="rows">
            {view.placed.map((p) => (
              <Placement
                key={p.key}
                placement={p}
                threatLink={threatLink}
                waiting={waiting(`unassign:${p.key}`)}
                onUndo={() =>
                  send(
                    `unassign:${p.key}`,
                    { type: "advisory.unassign", advisory: p.key },
                    `Undo your placement of ${p.key}`,
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="block" aria-labelledby="expected-h">
        <div className="block-head">
          <h2 id="expected-h">Settled by you</h2>
          <p>
            The projects you recorded as expected for a CVE id. Undo takes the expectation out, and
            a project made for it here when nothing else names it, so the check reads the id afresh.
          </p>
        </div>
        {view.expected.length === 0 ? (
          <p className="empty">You have settled no NVD finding yet.</p>
        ) : (
          <ul className="rows">
            {view.expected.map((e) => (
              <Expectation
                key={e.id}
                expectation={e}
                threatLink={threatLink}
                waiting={waiting(`unexpect:${e.id}`)}
                onUndo={() =>
                  send(
                    `unexpect:${e.id}`,
                    { type: "advisory.unexpect", cve: e.id },
                    `Undo what you settled for ${e.id}`,
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Waiting() {
  return (
    <p className="small" aria-live="polite">
      <span className="badge badge-info">Sent: the brain commits it as yours</span>{" "}
      <span className="muted">This row changes once the brain reports it done.</span>
    </p>
  );
}

function ToMap({
  advisory: a,
  view,
  waiting,
  onSend,
}: {
  advisory: AdminAdvisory;
  view: AdvisoryAdminView;
  waiting: boolean;
  onSend: (cmd: AdvisoryCommand, label: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const id = `adv-${a.key.replace(/[^A-Za-z0-9]/g, "-")}`;
  return (
    <article className="review-item" aria-labelledby={id} data-key={a.key}>
      <div className="stack-sm">
        <h3 className={s.title} id={id}>
          <a href={a.url} rel="noopener noreferrer nofollow" target="_blank">
            {a.title}
          </a>
        </h3>
        <div className="evidence-facts">
          <span>{a.source}</span>
          <span>{date(a.published)}</span>
          {a.severity && <span className="badge">{a.severity}</span>}
          {a.ids.map((x) => (
            <span key={x} className="mono">
              {x}
            </span>
          ))}
        </div>
      </div>
      {waiting ? (
        <Waiting />
      ) : picking ? (
        <form
          className={s.picker}
          onSubmit={(e) => {
            e.preventDefault();
            if (!chosen.length) return;
            onSend(
              { type: "advisory.assign", advisory: a.key, threats: chosen },
              `File ${a.key} under ${chosen.join(", ")}`,
            );
            setPicking(false);
          }}
        >
          <fieldset className={s.layers}>
            <legend className="visually-hidden">The threats {a.key} concerns</legend>
            {view.layers.map((l) => {
              const ts = view.threats.filter((t) => t.layer === l.id);
              if (!ts.length) return null;
              return (
                <div key={l.id} className={s.layer}>
                  <p className={s.layerName}>{l.label}</p>
                  {ts.map((t) => (
                    <label key={t.id} className="check-row small">
                      <input
                        type="checkbox"
                        value={t.id}
                        checked={chosen.includes(t.id)}
                        onChange={(e) =>
                          setChosen((c) =>
                            e.target.checked ? [...c, t.id] : c.filter((x) => x !== t.id),
                          )
                        }
                      />
                      {t.title}
                    </label>
                  ))}
                </div>
              );
            })}
          </fieldset>
          <div className="toolbar">
            <button type="submit" className="btn btn-sm btn-primary" disabled={!chosen.length}>
              {chosen.length
                ? `File under ${chosen.length} threat${chosen.length === 1 ? "" : "s"}`
                : "Choose its threats"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => {
                setPicking(false);
                setChosen([]);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setPicking(true)}>
            File under threats
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() =>
              onSend(
                { type: "advisory.assign", advisory: a.key, threats: [] },
                `Say ${a.key} concerns no threat`,
              )
            }
          >
            It concerns no threat
          </button>
        </div>
      )}
    </article>
  );
}

function Finding({
  finding: f,
  projects,
  threatLink,
  waiting,
  onSend,
}: {
  finding: AdminFinding;
  projects: string[];
  threatLink: (id: string) => ReactNode;
  waiting: boolean;
  onSend: (cmd: AdvisoryCommand, label: string) => void;
}) {
  const pairs = f.other.filter((p) => PAIR.test(p));
  const [name, setName] = useState(pairs[0] ? guessName(pairs[0]) : "");
  const [chosen, setChosen] = useState<string[]>(pairs.slice(0, 1));
  const taken = projects.some((p) => p.toLowerCase() === name.trim().toLowerCase());
  const nameOk = PROJECT.test(name.trim()) && !taken;
  const id = `nvd-${f.id}`;
  return (
    <article className="review-item" aria-labelledby={id} data-cve={f.id}>
      <div className="stack-sm">
        <div className="evidence-facts">
          <a id={id} className="mono" href={nvdUrl(f.id)} rel="noopener noreferrer" target="_blank">
            {f.id}
          </a>
          <span className="badge badge-warn">{FINDING_LABEL[f.finding]}</span>
          <span>named by {list(f.threats.map((t) => threatLink(t.id)))}</span>
          {f.checked && <span>checked {date(f.checked)}</span>}
        </div>
        {f.products.length > 0 && (
          <p className={`small ${s.wrap}`}>
            NVD lists as affected: <span className="mono">{f.products.join(", ")}</span>
            {f.named.length > 0 && ` (${f.named.join(", ")})`}.
          </p>
        )}
        {f.finding === "product" && (
          <p className="small muted">
            {f.expected.length
              ? `Expected ${f.expected.join(" or ")}, by ${f.basis === "owner" ? "your map" : `its ${f.basis}`}.`
              : "No advisory or cited page says which project it belongs to, and NVD names none the map knows."}
          </p>
        )}
      </div>
      {waiting ? (
        <Waiting />
      ) : f.finding !== "product" ? (
        <p className="small muted">{OPEN_WHY[f.finding]}</p>
      ) : (
        <div className="stack-sm">
          {f.named.length > 0 && (
            <div className="toolbar">
              {f.named.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    onSend(
                      { type: "advisory.expect", cve: f.id, project: p, cpe: [] },
                      `Expect ${p} for ${f.id}`,
                    )
                  }
                >
                  Expect {p}
                </button>
              ))}
            </div>
          )}
          {pairs.length > 0 && (
            <form
              className={s.settle}
              onSubmit={(e) => {
                e.preventDefault();
                if (!nameOk || !chosen.length) return;
                onSend(
                  { type: "advisory.expect", cve: f.id, project: name.trim(), cpe: chosen },
                  `Expect ${name.trim()} (${chosen.join(", ")}) for ${f.id}`,
                );
              }}
            >
              <label className="field">
                <span>The project NVD names, as the map will call it</span>
                <input
                  className="input"
                  value={name}
                  maxLength={40}
                  aria-invalid={!nameOk}
                  onChange={(e) => setName(e.target.value)}
                />
                {taken ? (
                  <small className={s.error}>
                    The map already has a project called that; give this one its own name.
                  </small>
                ) : (
                  !PROJECT.test(name.trim()) && (
                    <small className={s.error}>
                      2 to 40 letters, digits, spaces and . + _ -, starting with a letter or digit.
                    </small>
                  )
                )}
              </label>
              <fieldset className={s.pairs}>
                <legend className="small muted">NVD&apos;s pairs that are this project</legend>
                {pairs.map((p) => (
                  <label key={p} className="check-row small">
                    <input
                      type="checkbox"
                      value={p}
                      checked={chosen.includes(p)}
                      onChange={(e) =>
                        setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))
                      }
                    />
                    <span className="mono">{p}</span>
                  </label>
                ))}
              </fieldset>
              <div className="toolbar">
                <button
                  type="submit"
                  className="btn btn-sm btn-primary"
                  disabled={!nameOk || !chosen.length}
                >
                  Record it as expected
                </button>
                <span className="small muted">or leave it open</span>
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

function Placement({
  placement: p,
  threatLink,
  waiting,
  onUndo,
}: {
  placement: AdminPlacement;
  threatLink: (id: string) => ReactNode;
  waiting: boolean;
  onUndo: () => void;
}) {
  const first = p.advisories[0];
  return (
    <li className="row-item" data-key={p.key}>
      <div className="stack-sm">
        <h3 className={s.title}>
          {first ? (
            <a href={first.url} rel="noopener noreferrer nofollow" target="_blank">
              {first.title}
            </a>
          ) : (
            <span className={`mono ${s.wrap}`}>{p.key}</span>
          )}
        </h3>
        <p className="small">
          <span className={`mono ${s.wrap}`}>{p.key}</span>
          {first && `, ${first.source}`}
          {p.advisories.length > 1 &&
            `, and ${p.advisories.length - 1} more ${p.advisories.length === 2 ? "advisory" : "advisories"} it names`}
        </p>
        <p className="small">
          {p.threats.length ? (
            <>Filed under {list(p.threats.map(threatLink))}.</>
          ) : (
            "You said it concerns no threat."
          )}
        </p>
        {waiting && <Waiting />}
      </div>
      <span className="row-side">
        <button type="button" className="btn btn-sm btn-quiet" disabled={waiting} onClick={onUndo}>
          Undo
        </button>
      </span>
    </li>
  );
}

function Expectation({
  expectation: e,
  threatLink,
  waiting,
  onUndo,
}: {
  expectation: AdminExpectation;
  threatLink: (id: string) => ReactNode;
  waiting: boolean;
  onUndo: () => void;
}) {
  return (
    <li className="row-item" data-cve={e.id}>
      <div className="stack-sm">
        <h3 className={s.title}>
          <a className="mono" href={nvdUrl(e.id)} rel="noopener noreferrer" target="_blank">
            {e.id}
          </a>
        </h3>
        <p className="small">
          NVD&apos;s record should name {e.projects.join(" or ")}.
          {e.made.length > 0 &&
            ` ${e.made.join(" and ")} was made from NVD's record here; undoing removes it too.`}
        </p>
        <p className="small">
          {e.finding ? (
            <span className="badge badge-warn">Still a finding: {FINDING_LABEL[e.finding]}</span>
          ) : (
            <span className="badge badge-ok">Matches now</span>
          )}
          {e.threats.length > 0 && <> on {list(e.threats.map((t) => threatLink(t.id)))}</>}
        </p>
        {waiting && <Waiting />}
      </div>
      <span className="row-side">
        <button type="button" className="btn btn-sm btn-quiet" disabled={waiting} onClick={onUndo}>
          Undo
        </button>
      </span>
    </li>
  );
}
