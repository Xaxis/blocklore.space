"use client";

import type { DaemonState } from "@blocklore/core/control";
import {
  type AttestationRecord,
  attestationMessage,
  delegationDraft,
  delegationWindow,
  OC_DOMAIN,
  OC_SCOPE,
  OcAuthorizeCommand,
  OcRevokeCommand,
  OwnerAddress,
  ocSignatureProblem,
  revocationDraft,
  secondTime,
} from "@blocklore/core/orangecheck";
import { useState } from "react";
import { BrainStatus, SentList, useBrain } from "./live";

// The owner's keys (ORANGECHECK.md): attest their Bitcoin key for blocklore.space, delegate signing
// to the publisher key, or revoke that delegation. Every message is built here and shown exactly;
// the owner signs it in their own wallet and pastes the signature back. The site checks the
// signatures at once and the daemon checks them again before it records anything.

interface DelegationRow {
  id: string;
  principal: string;
  agent: string;
  issuedAt: string;
  expiresAt: string;
  status: "in force" | "revoked" | "expired" | "not begun";
}

export interface SigningRecords {
  attestation: AttestationRecord | null;
  delegations: DelegationRow[];
  signed: number;
  editions: number;
  signatures: { signer: string; at: string }[];
}

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          },
          () => setDone(false),
        )
      }
    >
      {done ? "Copied" : label}
    </button>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="callout callout-bad" role="alert">
      {text}
    </p>
  ) : null;
}

interface Drafts {
  owner: string;
  attest: boolean;
  nonceA: string;
  nonceD: string;
  issuedAt: string;
  window: { issuedAt: string; expiresAt: string };
}

function Authorize({
  publisher,
  records,
  send,
}: {
  publisher: string;
  records: SigningRecords;
  send: (cmd: OcAuthorizeCommand, label: string) => void;
}) {
  const [address, setAddress] = useState(records.attestation?.address ?? "");
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [sigA, setSigA] = useState("");
  const [sigD, setSigD] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const parsed = OwnerAddress.safeParse(address);
  const first =
    records.signatures
      .filter((s) => s.signer === publisher)
      .map((s) => s.at)
      .sort()[0] ?? null;

  function prepare() {
    if (!parsed.success) return;
    const now = new Date();
    setDrafts({
      owner: parsed.data,
      attest: records.attestation?.address !== parsed.data,
      nonceA: nonce(),
      nonceD: nonce(),
      issuedAt: secondTime(now),
      window: delegationWindow(now, first),
    });
    setSigA("");
    setSigD("");
    setProblem(null);
  }

  const message = drafts ? attestationMessage(drafts.owner, drafts.nonceA, drafts.issuedAt) : "";
  const delegation = drafts
    ? delegationDraft({
        principal: drafts.owner,
        agent: publisher,
        issuedAt: drafts.window.issuedAt,
        expiresAt: drafts.window.expiresAt,
        nonce: drafts.nonceD,
      })
    : null;

  function submit() {
    if (!drafts) return;
    const p = OcAuthorizeCommand.safeParse({
      type: "orangecheck.authorize",
      owner: drafts.owner,
      agent: publisher,
      attestation: drafts.attest
        ? { nonce: drafts.nonceA, issuedAt: drafts.issuedAt, sig: sigA }
        : null,
      delegation: {
        nonce: drafts.nonceD,
        issuedAt: drafts.window.issuedAt,
        expiresAt: drafts.window.expiresAt,
        sig: sigD,
      },
    });
    if (!p.success) {
      setProblem(
        "A signature is missing or is not a BIP-322 signature: paste the base64 text the wallet gives.",
      );
      return;
    }
    const wrong = ocSignatureProblem(p.data);
    setProblem(wrong);
    if (!wrong) {
      send(p.data, `Delegate signing to ${publisher.slice(0, 12)}`);
      setDrafts(null);
    }
  }

  return (
    <section className="panel block" aria-labelledby="authorize-h">
      <div className="panel-head">
        <h2 id="authorize-h">Delegate the publisher key</h2>
      </div>
      <div className="panel-body stack">
        <p>
          Your wallet signs two messages. The first ties your Bitcoin key to {OC_DOMAIN}. The second
          lets the publisher key sign JSON (<span className="mono">{OC_SCOPE}</span>) for a year,
          until you revoke it. Any wallet that signs BIP-322 messages works, hardware included. No
          key of yours is ever on the server.
        </p>
        <div className="toolbar">
          <label className="field" style={{ flex: 1, minWidth: "18rem" }}>
            <span>Your Bitcoin address (bc1q, bc1p or 1)</span>
            <input
              className="input mono"
              spellCheck={false}
              autoComplete="off"
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!parsed.success}
            onClick={prepare}
          >
            {drafts ? "Make new messages" : "Make the messages"}
          </button>
        </div>
        {address && !parsed.success ? (
          <p className="small muted">
            That is not a mainnet single-key address (P2WPKH, P2TR or P2PKH).
          </p>
        ) : (
          <p className="small muted">
            Use your OrangeCheck identity&apos;s address: OrangeCheck&apos;s own tools also read
            the coins it holds, and show an empty address as having no bond.
          </p>
        )}

        {drafts && delegation && (
          <>
            {drafts.attest ? (
              <div className="stack">
                <h3>1. Sign this text exactly, including the empty last line</h3>
                <pre className="code">{message}</pre>
                <div className="toolbar">
                  <CopyButton text={message} label="Copy the text" />
                  <span className="small muted">
                    Use your wallet&apos;s &quot;sign message&quot; with the address above.
                  </span>
                </div>
                <label className="field">
                  <span>The signature it gives</span>
                  <textarea
                    className="textarea mono"
                    rows={3}
                    spellCheck={false}
                    value={sigA}
                    onChange={(e) => setSigA(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <p className="small muted">
                This address is already attested for {OC_DOMAIN}; only the delegation is needed.
              </p>
            )}
            <div className="stack">
              <h3>{drafts.attest ? "2. " : ""}Sign the delegation&apos;s id</h3>
              <pre className="code">{delegation.id}</pre>
              <div className="toolbar">
                <CopyButton text={delegation.id} label="Copy the id" />
                <span className="small muted">
                  From {drafts.window.issuedAt} to {drafts.window.expiresAt}
                  {first && drafts.window.issuedAt === first
                    ? ", so it also covers what the key signed before today"
                    : ""}
                  .
                </span>
              </div>
              <details>
                <summary>What the id stands for</summary>
                <pre className="code">{delegation.message}</pre>
              </details>
              <label className="field">
                <span>The signature it gives</span>
                <textarea
                  className="textarea mono"
                  rows={3}
                  spellCheck={false}
                  value={sigD}
                  onChange={(e) => setSigD(e.target.value)}
                />
              </label>
            </div>
            <Problem text={problem} />
            <div className="toolbar">
              <button type="button" className="btn btn-primary" onClick={submit}>
                Check and send to the brain
              </button>
              <span className="small muted">
                The brain checks both signatures again, commits the records and deploys.
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Revoke({
  d,
  send,
}: {
  d: DelegationRow;
  send: (cmd: OcRevokeCommand, label: string) => void;
}) {
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [reason, setReason] = useState("The owner revoked this delegation.");
  const [sig, setSig] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const draft = signedAt
    ? revocationDraft({ signer: d.principal, delegationId: d.id, reason, signedAt })
    : null;

  function submit() {
    if (!signedAt) return;
    const p = OcRevokeCommand.safeParse({
      type: "orangecheck.revoke",
      delegationId: d.id,
      signer: d.principal,
      reason,
      signedAt,
      sig,
    });
    if (!p.success) {
      setProblem(
        "The reason must be plain ASCII of at most 128 characters, and the signature the base64 text the wallet gives.",
      );
      return;
    }
    const wrong = ocSignatureProblem(p.data);
    setProblem(wrong);
    if (!wrong) {
      send(p.data, `Revoke delegation ${d.id.slice(0, 12)}`);
      setSignedAt(null);
      setSig("");
    }
  }

  return (
    <div className="stack">
      <p>
        <span className="hash">{d.id}</span> to <span className="hash">{d.agent}</span>,{" "}
        {d.issuedAt} to {d.expiresAt}: <strong>{d.status}</strong>.
      </p>
      {!draft ? (
        <div className="toolbar">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setSignedAt(secondTime(new Date()))}
          >
            Revoke it
          </button>
          <span className="small muted">
            Takes effect from the moment you press this. What the key signed before still counts.
          </span>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Reason (public; plain ASCII, at most 128 characters)</span>
            <input
              className="input"
              maxLength={128}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p>Sign this id with {d.principal}:</p>
          <pre className="code">{draft.id}</pre>
          <div className="toolbar">
            <CopyButton text={draft.id} label="Copy the id" />
            <span className="small muted">Changing the reason changes the id.</span>
          </div>
          <details>
            <summary>What the id stands for</summary>
            <pre className="code">{draft.message}</pre>
          </details>
          <label className="field">
            <span>The signature it gives</span>
            <textarea
              className="textarea mono"
              rows={3}
              spellCheck={false}
              value={sig}
              onChange={(e) => setSig(e.target.value)}
            />
          </label>
          <Problem text={problem} />
          <div className="toolbar">
            <button type="button" className="btn btn-danger" onClick={submit}>
              Check and send the revocation
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setSignedAt(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Signing({
  initial,
  online,
  records,
}: {
  initial: DaemonState | null;
  online: boolean;
  records: SigningRecords;
}) {
  const b = useBrain({ initial: { state: initial, online } });
  const oc = b.state?.orangecheck;
  const publisher = oc?.publisher ?? null;
  const active = records.delegations.filter(
    (d) => d.status === "in force" || d.status === "not begun",
  );
  const send = (cmd: OcAuthorizeCommand | OcRevokeCommand, label: string) => {
    b.send(cmd, label);
  };

  return (
    <>
      <header className="page-header">
        <h1>Signing</h1>
        <p className="lede">
          Who stands behind what Blocklore publishes. The publisher key signs every edition and
          every evaluator decision; your delegation makes those signatures yours, and you can revoke
          it at any time. Readers see all of it on <a href="/verify/keys">/verify/keys</a>.
        </p>
      </header>

      <section className="block" aria-labelledby="keys-h">
        <div className="block-head">
          <h2 id="keys-h">The keys</h2>
          <BrainStatus state={b.state} online={b.online} />
        </div>
        <div className="panel">
          <div className="panel-body">
            <dl className="dl stacked">
              <dt>Publisher key</dt>
              <dd className="hash">
                {publisher ??
                  (b.state
                    ? "None yet. On the server: pnpm brain orangecheck keygen"
                    : "Waiting for the brain to report.")}
              </dd>
              <dt>Nostr key</dt>
              <dd className="hash">{oc?.nostr ?? "None yet."}</dd>
              <dt>Your key</dt>
              <dd className="hash">
                {records.attestation
                  ? `${records.attestation.address}, attested ${records.attestation.issued_at}`
                  : "Not attested yet."}
              </dd>
              <dt>Delegation</dt>
              <dd>
                {active[0]
                  ? `In force until ${active[0].expiresAt}.`
                  : records.delegations.length
                    ? "None in force: the publisher key signs alone."
                    : "Not delegated yet: the publisher key signs alone."}
              </dd>
              <dt>Editions</dt>
              <dd>
                {records.signed} of {records.editions} signed (as of the deployed site).
              </dd>
            </dl>
          </div>
        </div>
      </section>

      {publisher ? (
        <Authorize publisher={publisher} records={records} send={send} />
      ) : (
        <p className="callout callout-warn">
          The brain has no publisher key yet, so there is nothing to delegate to. Make it on the
          server with <span className="mono">pnpm brain orangecheck keygen</span>.
        </p>
      )}

      {active.length > 0 && (
        <section className="panel block" aria-labelledby="revoke-h">
          <div className="panel-head">
            <h2 id="revoke-h">Revoke</h2>
          </div>
          <div className="panel-body stack">
            {active.map((d) => (
              <Revoke key={d.id} d={d} send={send} />
            ))}
          </div>
        </section>
      )}

      <SentList sent={b.sent} />
    </>
  );
}
