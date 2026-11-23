"use client";

import {
  flagsText,
  type GatePolicyView,
  type PolicyCommand,
  type PolicyTopicView,
  TERM_MAX,
  termProblem,
} from "@blocklore/core/gatepolicy";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import s from "./GatePolicy.module.css";
import { SentList, useBrain } from "./live";

// The owner's gate policy (ADMIN.md, "Gate policy"): every topic on the agenda or published, with
// its two flags as brain/policy/topics.yaml sets them, and the contested terms. Each save is a
// signed command; the brain edits the file, commits it as the owner's and ships it, and the page
// follows when the daemon reports the job done. Nothing is pre-selected for a topic the file does
// not list: the owner picks both flags before Save is on.

const SENDING = "sending";

export function GatePolicy({ view }: { view: GatePolicyView | null }) {
  const router = useRouter();
  const b = useBrain();
  // Which command each row or term sent, so it waits until the brain reports it done or failed.
  const [rows, setRows] = useState<Record<string, string>>({});
  const doneCount = b.sent.filter((x) => x.result?.phase === "done").length;
  useEffect(() => {
    if (doneCount > 0) router.refresh();
  }, [doneCount, router]);

  if (!view)
    return (
      <>
        <p className="empty">
          The brain has not sent the gate policy yet. It does on its next sync, within a minute of
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
  const send = async (row: string, cmd: PolicyCommand, label: string) => {
    // The row waits from the click, so a second click cannot send the same change twice.
    setRows((r) => ({ ...r, [row]: SENDING }));
    const x = await b.send(cmd, label);
    setRows((r) => ({ ...r, [row]: x.id }));
  };
  const adding = Object.keys(rows)
    .filter((k) => k.startsWith("add:") && waiting(k))
    .map((k) => k.slice(4))
    .filter((t) => !view.terms.includes(t));

  return (
    <>
      <SentList sent={b.sent} />

      <section className="block" aria-labelledby="topics-h">
        <div className="block-head">
          <h2 id="topics-h">Topics</h2>
          <p>
            The agenda&apos;s topics in its order, then any other published one. Pick both flags,
            then save the row.
          </p>
        </div>
        <ul className="rows">
          {view.topics.map((t) => (
            <Topic
              key={t.slug}
              topic={t}
              waiting={waiting(`topic:${t.slug}`)}
              onSend={(cmd, label) => send(`topic:${t.slug}`, cmd, label)}
            />
          ))}
        </ul>
      </section>

      <section className="block" aria-labelledby="terms-h">
        <div className="block-head">
          <h2 id="terms-h">Contested terms</h2>
          <p>
            A claim whose statement names one of these waits for the evaluator on any topic, so a
            contested question cannot slip through a topic that is mostly settled fact. They match
            as whole words, whatever the case.
          </p>
        </div>
        <ul className={s.terms} aria-label="Contested terms">
          {view.terms.map((term) => (
            <Term
              key={term}
              term={term}
              waiting={waiting(`remove:${term}`)}
              onRemove={() =>
                send(
                  `remove:${term}`,
                  { type: "policy.term", term, add: false },
                  `Remove the contested term ${term}`,
                )
              }
            />
          ))}
          {adding.map((term) => (
            <li key={`adding-${term}`} className={s.term} data-term={term} data-adding="">
              <span className={s.termText}>{term}</span>
              <span className="badge badge-info">Sent</span>
            </li>
          ))}
        </ul>
        <AddTerm
          terms={view.terms}
          onAdd={(term) =>
            send(
              `add:${term}`,
              { type: "policy.term", term, add: true },
              `Add the contested term ${term}`,
            )
          }
        />
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

/** One flag as a choice of two, with nothing pressed until the owner picks or the file says. */
function Flag({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean | null;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <fieldset className={s.flag}>
      <legend className={s.flagName}>{label}</legend>
      <div className={`segmented ${s.choice}`}>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            disabled={disabled}
            onClick={() => onChange(v)}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Topic({
  topic: t,
  waiting,
  onSend,
}: {
  topic: PolicyTopicView;
  waiting: boolean;
  onSend: (cmd: PolicyCommand, label: string) => void;
}) {
  // The owner's picks over what the file says; a flag the file does not set starts unpicked.
  const [picked, setPicked] = useState<{ contested?: boolean; safety?: boolean }>({});
  const contested = picked.contested ?? t.listed?.contested ?? null;
  const safety = picked.safety ?? t.listed?.safety ?? null;
  const both = contested !== null && safety !== null;
  const changed =
    both && (!t.listed || t.listed.contested !== contested || t.listed.safety !== safety);
  const editable = t.agenda || t.published;
  const id = `topic-${t.slug}`;
  return (
    <li className={s.topic} data-slug={t.slug}>
      <div className={s.about}>
        <h3 className={s.title} id={id}>
          {t.title} <span className={`mono ${s.slug}`}>{t.slug}</span>
        </h3>
        <p className={s.facts}>
          <span>{t.agenda ? "On the agenda" : "Not on the agenda"}</span>
          <span>{t.published ? "Published" : "Not published yet"}</span>
          <span data-waiting={t.waiting}>
            {t.waiting === 0
              ? "No claim waits for the evaluator"
              : `${t.waiting} claim${t.waiting === 1 ? "" : "s"} wait${t.waiting === 1 ? "s" : ""} for the evaluator`}
          </span>
        </p>
        <p className={s.state} data-listed={t.listed ? flagsText(t.listed) : "no"}>
          {t.listed ? (
            <>
              The file sets it as <strong>{flagsText(t.listed)}</strong>.
            </>
          ) : (
            <span className="badge badge-warn">
              Not listed: every claim on it waits for the evaluator
            </span>
          )}
        </p>
        {waiting && <Waiting />}
      </div>
      {editable ? (
        <form
          className={s.controls}
          onSubmit={(e) => {
            e.preventDefault();
            if (!changed || contested === null || safety === null) return;
            const flags = { contested, safety };
            onSend(
              { type: "policy.topic", slug: t.slug, ...flags },
              `${t.listed ? "Set" : "List"} ${t.slug} as ${flagsText(flags)}`,
            );
          }}
        >
          <Flag
            label="Contested"
            value={contested}
            disabled={waiting}
            onChange={(v) => setPicked((p) => ({ ...p, contested: v }))}
          />
          <Flag
            label="Safety advice"
            value={safety}
            disabled={waiting}
            onChange={(v) => setPicked((p) => ({ ...p, safety: v }))}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={waiting || !changed}>
            Save
          </button>
          {!t.listed && !both && !waiting && (
            <span className={`small muted ${s.hint}`}>Pick both flags to save.</span>
          )}
        </form>
      ) : (
        <p className="small muted">
          Listed in the file, but neither on the agenda nor published, so it is not changed here.
        </p>
      )}
    </li>
  );
}

function Term({
  term,
  waiting,
  onRemove,
}: {
  term: string;
  waiting: boolean;
  onRemove: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <li className={s.term} data-term={term}>
      <span className={s.termText}>{term}</span>
      {waiting ? (
        <span className="badge badge-info">Sent</span>
      ) : asking ? (
        <>
          <button
            type="button"
            className={`btn btn-sm btn-danger ${s.termButton}`}
            onClick={() => {
              setAsking(false);
              onRemove();
            }}
          >
            Remove
          </button>
          <button
            type="button"
            className={`btn btn-sm btn-quiet ${s.termButton}`}
            onClick={() => setAsking(false)}
          >
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          className={s.remove}
          aria-label={`Remove ${term}`}
          title={`Remove ${term}`}
          onClick={() => setAsking(true)}
        >
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        </button>
      )}
    </li>
  );
}

function AddTerm({ terms, onAdd }: { terms: string[]; onAdd: (term: string) => void }) {
  const [term, setTerm] = useState("");
  const inputId = useId();
  const errId = useId();
  const t = term.trim();
  const has = terms.find((x) => x.toLowerCase() === t.toLowerCase());
  const problem = t
    ? (termProblem(t) ??
      (has !== undefined
        ? `${has} is already a contested term; terms match whatever their case.`
        : null))
    : null;
  return (
    <form
      className={s.add}
      onSubmit={(e) => {
        e.preventDefault();
        if (!t || problem) return;
        onAdd(t);
        setTerm("");
      }}
    >
      <div className="field">
        <label htmlFor={inputId}>Add a term</label>
        <input
          id={inputId}
          className="input"
          value={term}
          maxLength={TERM_MAX}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!problem}
          aria-describedby={errId}
          onChange={(e) => setTerm(e.target.value)}
        />
        <small id={errId} className={problem ? s.error : undefined}>
          {problem ?? `Up to ${TERM_MAX} characters on one line: a name, a BIP or an opcode.`}
        </small>
      </div>
      <button type="submit" className="btn btn-sm" disabled={!t || !!problem}>
        Add
      </button>
    </form>
  );
}
