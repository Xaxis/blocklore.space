"use client";

import {
  type LinkedClaim,
  PART_WORDS,
  THREAT_PARTS,
  type ThreatAdminThreat,
  type ThreatAdminView,
  type ThreatCommand,
  type ThreatPart,
  threatCommandProblem,
} from "@blocklore/core/threatadmin";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { SentList, useBrain } from "./live";
import s from "./ThreatMap.module.css";

// The owner's threat map (ADMIN.md, "Threat map"): every threat by layer, gaps first, with the
// published claims it lists as what it is and as what defends against it, and code's suggestions.
// Each link or unlink is a signed command; the brain edits the threat's file, commits it as the
// owner's and ships it, and the page follows when the daemon reports the job done. Nothing is
// linked without a click.

const SENDING = "sending";
const PART_TITLE: Record<ThreatPart, string> = {
  claims: "What it is",
  mitigations: "What defends against it",
};
const LIST_ID = "threat-map-published";

export function ThreatMap({ view }: { view: ThreatAdminView | null }) {
  const router = useRouter();
  const b = useBrain();
  // Which command each claim of a threat sent, so its buttons wait until the brain reports it.
  const [rows, setRows] = useState<Record<string, string>>({});
  const doneCount = b.sent.filter((x) => x.result?.phase === "done").length;
  useEffect(() => {
    if (doneCount > 0) router.refresh();
  }, [doneCount, router]);

  if (!view)
    return (
      <>
        <p className="empty">
          The brain has not sent the threat map yet. It does on its next sync, within a minute of
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
  const send = async (cmd: ThreatCommand) => {
    // The row waits from the click, so a second click cannot send the same change twice.
    const row = `${cmd.threat}:${cmd.claim}`;
    setRows((r) => ({ ...r, [row]: SENDING }));
    const label =
      cmd.type === "threat.link"
        ? `Link ${cmd.claim} to ${cmd.threat} as ${PART_WORDS[cmd.part]}`
        : `Unlink ${cmd.claim} from ${cmd.threat}`;
    const x = await b.send(cmd, label);
    setRows((r) => ({ ...r, [row]: x.id }));
  };

  return (
    <>
      <SentList sent={b.sent} />
      <datalist id={LIST_ID}>
        {view.published.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {view.layers.map((layer) => {
        const threats = view.threats.filter((t) => t.layer === layer.id);
        if (!threats.length) return null;
        const gaps = threats.filter((t) => t.missing.length).length;
        return (
          <section key={layer.id} className="block" aria-labelledby={`layer-${layer.id}`}>
            <div className="block-head">
              <h2 id={`layer-${layer.id}`}>{layer.label}</h2>
              <p>
                {threats.length} threat{threats.length === 1 ? "" : "s"}
                {gaps ? `, ${gaps} with a gap` : ", none with a gap"}
              </p>
            </div>
            <ul className="rows">
              {threats.map((t) => (
                <Threat
                  key={t.id}
                  threat={t}
                  view={view}
                  waiting={(claim) => waiting(`${t.id}:${claim}`)}
                  onSend={send}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function Threat({
  threat: t,
  view,
  waiting,
  onSend,
}: {
  threat: ThreatAdminThreat;
  view: ThreatAdminView;
  waiting: (claim: string) => boolean;
  onSend: (cmd: ThreatCommand) => void;
}) {
  const id = `threat-${t.id}`;
  return (
    <li className={s.threat} data-threat={t.id} data-gap={t.missing.join(" ") || undefined}>
      <div className={s.head}>
        <h3 className={s.title} id={id}>
          <Link href={`/security/${t.id}`}>{t.title}</Link>
        </h3>
        <p className={s.facts}>
          <span className="mono">{t.id}</span>
          <span>Status {t.status}</span>
          <span>Filed under {t.topic}</span>
          {t.missing.map((m) => (
            <span key={m} className="badge badge-warn">
              Needs {PART_WORDS[m]}
            </span>
          ))}
        </p>
      </div>
      <div className={s.parts}>
        {THREAT_PARTS.map((part) => (
          <Part
            key={part}
            threat={t}
            part={part}
            claims={t[part]}
            waiting={waiting}
            onUnlink={(claim) => onSend({ type: "threat.unlink", threat: t.id, part, claim })}
          />
        ))}
      </div>
      {t.suggestions.length > 0 && (
        <div className={s.suggest}>
          <h4 className={s.partTitle}>Code&apos;s suggestions</h4>
          <ul className={s.claims}>
            {t.suggestions.map((c) => (
              <li key={c.id} className={s.claim} data-suggestion={c.id}>
                <div className={s.claimText}>
                  <p>{c.statement}</p>
                  <p className="small muted">
                    <Link className="mono" href={`/claims/${c.id}`}>
                      {c.id}
                    </Link>{" "}
                    names &ldquo;{c.match}&rdquo;
                    {c.onTopic ? "" : ", filed under another topic"}
                  </p>
                </div>
                <div className={s.actions}>
                  {waiting(c.id) ? (
                    <span className="badge badge-info">Sent</span>
                  ) : (
                    THREAT_PARTS.map((part) => {
                      // The name starts with the words shown, so speech control finds the button.
                      const shown = part === "claims" ? "Link as what it is" : "Link as a defense";
                      return (
                        <button
                          key={part}
                          type="button"
                          className="btn btn-sm"
                          aria-label={`${shown}: ${c.id} to ${t.id}`}
                          onClick={() =>
                            onSend({ type: "threat.link", threat: t.id, part, claim: c.id })
                          }
                        >
                          {shown}
                        </button>
                      );
                    })
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <LinkAny threat={t} view={view} waiting={waiting} onSend={onSend} />
    </li>
  );
}

function Part({
  threat: t,
  part,
  claims,
  waiting,
  onUnlink,
}: {
  threat: ThreatAdminThreat;
  part: ThreatPart;
  claims: LinkedClaim[];
  waiting: (claim: string) => boolean;
  onUnlink: (claim: string) => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <div className={s.part} data-part={part}>
      <h4 className={s.partTitle}>{PART_TITLE[part]}</h4>
      {claims.length === 0 ? (
        <p className="small muted">No claim linked.</p>
      ) : (
        <ul className={s.claims}>
          {claims.map((c) => (
            <li key={c.id} className={s.claim} data-linked={c.id}>
              <div className={s.claimText}>
                <p>{c.statement || c.id}</p>
                <p className="small muted">
                  <Link className="mono" href={`/claims/${c.id}`}>
                    {c.id}
                  </Link>
                  {!c.published && (
                    <>
                      {" "}
                      <span className="badge badge-bad">Withdrawn</span>
                    </>
                  )}
                </p>
              </div>
              <div className={s.actions}>
                {waiting(c.id) ? (
                  <span className="badge badge-info">Sent</span>
                ) : asking === c.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        setAsking(null);
                        onUnlink(c.id);
                      }}
                    >
                      Unlink
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => setAsking(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    aria-label={`Unlink ${c.id} from ${t.id}`}
                    onClick={() => setAsking(c.id)}
                  >
                    Unlink
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Link any published claim by its id, as either part; checked as the site and the brain check it. */
function LinkAny({
  threat: t,
  view,
  waiting,
  onSend,
}: {
  threat: ThreatAdminThreat;
  view: ThreatAdminView;
  waiting: (claim: string) => boolean;
  onSend: (cmd: ThreatCommand) => void;
}) {
  const [claim, setClaim] = useState("");
  const [part, setPart] = useState<ThreatPart | null>(null);
  const inputId = useId();
  const errId = useId();
  const c = claim.trim();
  const cmd: ThreatCommand | null =
    c && part ? { type: "threat.link", threat: t.id, part, claim: c } : null;
  const problem = c
    ? !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(c)
      ? "A claim id is <topic>.<slug>."
      : cmd
        ? threatCommandProblem(cmd, view)
        : null
    : null;
  return (
    <form
      className={s.add}
      onSubmit={(e) => {
        e.preventDefault();
        if (!cmd || problem || waiting(c)) return;
        onSend(cmd);
        setClaim("");
        setPart(null);
      }}
    >
      <div className="field">
        <label htmlFor={inputId}>Link another published claim</label>
        <input
          id={inputId}
          className="input mono"
          value={claim}
          list={LIST_ID}
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          placeholder="topic.slug"
          aria-invalid={!!problem}
          aria-describedby={errId}
          onChange={(e) => setClaim(e.target.value)}
        />
        <small id={errId} className={problem ? s.error : undefined}>
          {problem ?? "Any published claim, by its id."}
        </small>
      </div>
      <fieldset className={s.choice}>
        <legend className={s.legend}>As</legend>
        <div className="segmented">
          {THREAT_PARTS.map((p) => (
            <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(p)}>
              {PART_WORDS[p]}
            </button>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="btn btn-sm" disabled={!cmd || !!problem || waiting(c)}>
        Link
      </button>
    </form>
  );
}
