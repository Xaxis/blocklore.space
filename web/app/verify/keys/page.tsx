import { OC_IDENTITY, OC_KINDS, OC_RELAYS, OC_SCOPE } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/CopyCommand";
import { Block, Page, PageHeader } from "@/components/ui";
import { date, dateTime, plural } from "@/lib/format";
import {
  type DelegationStatus,
  OC_HOME,
  ocCommand,
  recordUrl,
  SIGNATURE_MEANS,
  signing,
} from "@/lib/orangecheck";

export const metadata: Metadata = {
  title: "Signing keys",
  description:
    "Who signs Blocklore's editions: the owner's Bitcoin key, its delegation to the publisher key, and how to check every signature offline with OrangeCheck's tools.",
  alternates: { canonical: "/verify/keys" },
};

const STATUS_BADGE: Record<DelegationStatus, string> = {
  "in force": "badge badge-ok",
  revoked: "badge badge-bad",
  expired: "badge badge-warn",
  "not begun": "badge",
};

export default function Keys() {
  const s = signing();
  const a = s.attestation;
  const newest = s.editions[0]?.n ?? 1;
  const inForce = s.delegations.find((d) => d.status === "in force");
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/verify", label: "Snapshots" }, { label: "Signing keys" }]}
        title="Signing keys"
        lede={SIGNATURE_MEANS}
        meta={
          <>
            <span>
              {s.signed} of {plural(s.editions.length, "edition")} signed
            </span>
            <span>
              {inForce ? "The owner's delegation is in force" : "The publisher key signs alone"}
            </span>
            <span>As of {dateTime(s.asOf)}</span>
            <a href={OC_HOME}>Signed with OrangeCheck</a>
          </>
        }
      />

      <Block id="chain" title="The chain of authority">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>1. The owner&apos;s Bitcoin key</h3>
              {a ? (
                <span className="badge badge-ok">Attested for {OC_IDENTITY}</span>
              ) : (
                <span className="badge">Not attested yet</span>
              )}
            </div>
            <div className="panel-body">
              {a ? (
                <>
                  <dl className="dl stacked">
                    <dt>Address</dt>
                    <dd className="hash">{a.address}</dd>
                    <dt>Attestation</dt>
                    <dd className="hash">
                      <a href={recordUrl.attestation(a.attestation_id)}>{a.attestation_id}</a>
                    </dd>
                    <dt>Signed</dt>
                    <dd>{dateTime(a.issued_at)}, in the owner&apos;s own wallet (BIP-322)</dd>
                    <dt>Domain proof</dt>
                    <dd>
                      <a href={recordUrl.wellKnown}>/.well-known/orangecheck.txt</a> names this
                      attestation, which is how OrangeCheck ties a key to a domain.
                    </dd>
                  </dl>
                  <CopyCommand command={ocCommand.attestation(a.attestation_id)} />
                  <p className="small muted">
                    OrangeCheck&apos;s tool also reads the coins held at the address, its bond. The
                    signature is the code <span className="mono">sig_ok_bip322</span>; the bond is
                    not part of Blocklore&apos;s chain.
                  </p>
                  <CopyCommand command={ocCommand.wellKnown} />
                </>
              ) : (
                <p>
                  The owner has not attested a key yet. Until they do, the publisher key signs
                  alone, and no signature on this site is the owner&apos;s.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>2. The delegation to the publisher key</h3>
              {!s.delegations.length && <span className="badge">Not delegated yet</span>}
            </div>
            <div className="panel-body">
              {s.delegations.length ? (
                s.delegations.map((d) => (
                  <div key={d.record.id} className="stack">
                    <dl className="dl stacked">
                      <dt>Delegation</dt>
                      <dd className="hash">
                        <a href={recordUrl.delegation(d.record.id)}>{d.record.id}</a>{" "}
                        <span className={STATUS_BADGE[d.status]}>{d.status}</span>
                      </dd>
                      <dt>From</dt>
                      <dd className="hash">{d.record.principal.address}</dd>
                      <dt>To</dt>
                      <dd className="hash">{d.record.agent.address}</dd>
                      <dt>May sign</dt>
                      <dd>
                        <span className="mono">{(d.record.scopes ?? []).join(", ")}</span>: JSON
                        documents, such as an edition&apos;s snapshot file
                      </dd>
                      <dt>Window</dt>
                      <dd>
                        {date(d.record.issued_at)} to {date(d.record.expires_at)}
                      </dd>
                      {d.revocation && (
                        <>
                          <dt>Revoked</dt>
                          <dd>
                            By {d.revokedBy} at {dateTime(d.revocation.signed_at)}
                            {d.revocation.reason && `: "${d.revocation.reason}"`} (
                            <a href={recordUrl.revocation(d.revocation.id)}>record</a>). What the
                            key signed before then still counts; nothing after. OrangeCheck&apos;s
                            tool below reports the delegation as revoked (E_REVOKED); the repository
                            check says which editions it still covers.
                          </dd>
                        </>
                      )}
                    </dl>
                    <CopyCommand command={ocCommand.delegation(d.record.id)} />
                  </div>
                ))
              ) : (
                <p>
                  The owner has not delegated <span className="mono">{OC_SCOPE}</span> to the
                  publisher key yet. A delegation is signed in the owner&apos;s wallet, lasts at
                  most a year, and the owner can revoke it at any time.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>3. The publisher key</h3>
              {s.publisher ? (
                <span className="badge badge-info">{plural(s.signed, "edition")} signed</span>
              ) : (
                <span className="badge">No key yet</span>
              )}
            </div>
            <div className="panel-body">
              <dl className="dl stacked">
                <dt>Address</dt>
                <dd className="hash">{s.publisher ?? "Not made yet."}</dd>
                <dt>Held by</dt>
                <dd>
                  Blocklore&apos;s deterministic code on its own server. The models that research
                  and check claims never see it, and nothing they write is signed until code has
                  checked it.
                </dd>
                <dt>Signs</dt>
                <dd>
                  Every edition&apos;s snapshot file (an OC Stamp), and each decision the evaluator
                  makes in place of a manual review (an OC Agent action that names the delegation).
                </dd>
              </dl>
              {s.editions.some((e) => e.signature) && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Edition</th>
                        <th scope="col">Signed</th>
                        <th scope="col">Owner behind the key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.editions.map((e) => (
                        <tr key={e.n}>
                          <th scope="row">
                            <Link href={`/verify#snapshot-${e.n}`}>{e.n}</Link>
                          </th>
                          <td>
                            {!e.signature
                              ? "Not signed"
                              : !e.signature.ok
                                ? `Does not check: ${e.signature.problem}`
                                : `${dateTime(e.signature.signedAt)}${e.signature.backSigned ? ", after the edition" : ""}`}
                          </td>
                          <td>
                            {!e.signature?.ok
                              ? ""
                              : e.signature.authority.state === "delegated"
                                ? "Yes"
                                : e.signature.authority.why}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </Block>

      <div className="prose block">
        <h2 id="check">Check it all yourself</h2>
        <p>
          One command checks the newest edition&apos;s stamp against its file, the delegation and
          any revocation, the owner&apos;s attestation and the domain proof, each with
          OrangeCheck&apos;s own libraries:
        </p>
        <CopyCommand command={ocCommand.chain(newest)} />
        <p>Or each piece alone, offline once downloaded, with OrangeCheck&apos;s tools:</p>
        <CopyCommand command={ocCommand.stamp(newest)} />

        <h2 id="nostr">On Nostr</h2>
        <p>
          Each record is also published on Nostr, so it outlives this site: the attestation as kind{" "}
          {OC_KINDS.attestation}, edition stamps and the delegation as kind {OC_KINDS.stamp}, the
          evaluator&apos;s actions as kind {OC_KINDS.action} and revocations as kind{" "}
          {OC_KINDS.revocation}, on {OC_RELAYS.map((r) => new URL(r).host).join(", ")}.
        </p>

        <h2 id="limits">What a signature proves, and what it does not</h2>
        <ul>
          <li>
            It proves the publisher key signed the file&apos;s exact bytes. Change one byte and it
            fails.
          </li>
          <li>
            The time in a signature is the signer&apos;s own statement. The OpenTimestamps proof on{" "}
            <Link href="/verify">Snapshots</Link> is what fixes on Bitcoin when the file existed.
          </li>
          <li>
            Editions taken before the key existed were signed later, and say so. Their timestamps
            still date them.
          </li>
          <li>
            A signature is the owner&apos;s only while their delegation is in force: after it
            expires or is revoked, the key signs alone and this page says so.
          </li>
          <li>It does not make a claim true. Each claim&apos;s sources and checks do that.</li>
        </ul>
      </div>
    </Page>
  );
}
