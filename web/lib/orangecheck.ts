import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type AttestationRecord,
  currentAttestation,
  type DelegationEnvelope,
  type EditionSignature,
  OC_KINDS,
  OC_RELAYS,
  OC_SCOPE,
  OC_VERSIONS,
  type RevocationEnvelope,
  revocationOf,
} from "@blocklore/core";
import { bundle } from "./data";
import { SITE } from "./site";

// Who signs Blocklore's editions and who stands behind that key (ORANGECHECK.md), for /verify,
// /verify/keys, the API and MCP. Everything here comes from the compiled bundle: records whose
// BIP-322 signatures checked when the store was compiled.

export const OC_HOME = "https://ochk.io";

/** What a signature proves, in one sentence (the same on every page that shows one). */
export const SIGNATURE_MEANS =
  "A signature proves that whoever holds the publisher key signed these exact bytes, and while the owner's delegation is in force, that the owner's own Bitcoin key stood behind that key; it does not make any claim true.";

export type DelegationStatus = "in force" | "revoked" | "expired" | "not begun";

export interface DelegationView {
  record: DelegationEnvelope;
  status: DelegationStatus;
  revocation: RevocationEnvelope | null;
  /** Who revoked it, in words: the owner, or the publisher key itself. */
  revokedBy: "the owner" | "the publisher key" | null;
}

export interface Signing {
  /** The key that signs editions: the delegation's agent, else the newest stamp's signer. */
  publisher: string | null;
  attestation: AttestationRecord | null;
  delegations: DelegationView[];
  editions: { n: number; signature: EditionSignature | null }[];
  signed: number;
  /** The time the statuses are given as of: the store's moment, or its newest signing record. */
  asOf: string;
}

function status(d: DelegationEnvelope, at: number): DelegationView {
  const revocation = revocationOf(bundle.orangecheck, d.id);
  const revokedBy = revocation
    ? revocation.signer.address === d.principal.address
      ? "the owner"
      : "the publisher key"
    : null;
  const s: DelegationStatus =
    revocation && Date.parse(revocation.signed_at) <= at
      ? "revoked"
      : at >= Date.parse(d.expires_at)
        ? "expired"
        : at < Date.parse(d.issued_at)
          ? "not begun"
          : "in force";
  return { record: d, status: s, revocation, revokedBy };
}

/**
 * The store's moment counts claims, runs and snapshots, not the owner's records, so a delegation
 * signed after the last claim would read as not begun. Statuses are given as of the later of the two.
 */
function statusMoment(valid: typeof bundle.orangecheck): string {
  const times = [
    bundle.generated.time,
    ...valid.attestations.map((a) => a.issued_at),
    ...valid.delegations.map((d) => d.issued_at),
    ...valid.revocations.map((r) => r.signed_at),
  ];
  return times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

export function signing(): Signing {
  const valid = bundle.orangecheck;
  const asOf = statusMoment(valid);
  const at = Date.parse(asOf);
  const delegations = [...valid.delegations]
    .sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1))
    .map((d) => status(d, at));
  const editions = bundle.snapshots.map((s) => ({ n: s.n, signature: s.signature }));
  return {
    publisher:
      delegations[0]?.record.agent.address ??
      editions.find((e) => e.signature)?.signature?.signer ??
      null,
    attestation: currentAttestation(valid),
    delegations,
    editions,
    signed: editions.filter((e) => e.signature?.ok).length,
    asOf,
  };
}

/** Where the site serves each record (the files exactly as committed). */
export const recordUrl = {
  attestation: (id: string) => `${SITE.url}/orangecheck/attestations/${id}.json`,
  delegation: (id: string) => `${SITE.url}/orangecheck/delegations/${id}.json`,
  revocation: (id: string) => `${SITE.url}/orangecheck/revocations/${id}.json`,
  revocations: `${SITE.url}/orangecheck/revocations.json`,
  stamp: (n: number) => `${SITE.url}/snapshots/${n}.json.stamp`,
  wellKnown: `${SITE.url}/.well-known/orangecheck.txt`,
} as const;

/** Commands that check each piece with OrangeCheck's own tools, offline once downloaded. */
export const ocCommand = {
  stamp: (n: number) =>
    `curl -sO ${SITE.url}/snapshots/${n}.json -sO ${recordUrl.stamp(n)} && npx -y -p @orangecheck/stamp-cli@${OC_VERSIONS.stampCli} stamp verify ${n}.json.stamp ${n}.json`,
  delegation: (id: string) =>
    `curl -s ${recordUrl.delegation(id)} -o delegation.json -s ${recordUrl.revocations} -o revocations.json && npx -y -p @orangecheck/agent-cli@${OC_VERSIONS.agentCli} oc-agent verify delegation.json --revocations revocations.json`,
  attestation: (id: string) =>
    `curl -s ${recordUrl.attestation(id)} -o attestation.json && npx -y -p @orangecheck/cli@${OC_VERSIONS.cli} oc verify --file attestation.json`,
  wellKnown: `curl -s ${recordUrl.wellKnown}`,
  chain: (n: number) =>
    `git clone ${SITE.repo} && cd blocklore.space && pnpm install && pnpm verify:orangecheck ${n}`,
} as const;

/**
 * A link to OrangeCheck's browser verifier with the stamp in the fragment (never sent to a
 * server), or null when the stamp file cannot be read.
 */
export function stampVerifierUrl(n: number): string | null {
  try {
    const text = readFileSync(
      path.join(process.cwd(), "..", "knowledge", "snapshots", `${n}.json.stamp`),
      "utf8",
    );
    return `https://stamp.ochk.io/v#${Buffer.from(text.trim()).toString("base64url")}`;
  } catch {
    return null;
  }
}

export const NOSTR = { relays: OC_RELAYS, kinds: OC_KINDS, scope: OC_SCOPE } as const;
