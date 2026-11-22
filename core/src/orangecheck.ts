// OrangeCheck (ORANGECHECK.md): who stands behind an edition. Blocklore's publisher key signs every
// snapshot with an OC Stamp (BIP-322 over the stamp id). The owner's own Bitcoin key binds itself
// to dns:blocklore.space with an OrangeCheck attestation and delegates one narrow scope to the
// publisher key with an OC Agent delegation, which the owner (or the publisher key itself) can
// revoke. The specs are in ~/Projects/ochk (oc-stamp-protocol, oc-agent-protocol,
// oc-attest-protocol); the published @orangecheck packages do the canonical messages and ids.
//
// Pure: messages, ids, envelopes from signatures someone else made, the checks, and the record a
// reader sees. Signing with the publisher key is brain/src/orangecheck.ts; the owner signs in their
// own wallet and pastes the signature into the admin. Time comes in as arguments.
import {
  type ActionEnvelope,
  actionCanonicalMessage,
  canonicalizeScopes,
  computeActionId,
  computeDelegationId,
  computeRevocationId,
  type DelegationEnvelope,
  delegationCanonicalMessage,
  isSubScope,
  parseScope,
  type RevocationEnvelope,
  revocationCanonicalMessage,
  validateScope,
} from "@orangecheck/agent-core";
import { decodeAddress, verifySignature } from "@orangecheck/bip322";
import { buildCanonicalMessage, isCanonicalAttestation } from "@orangecheck/sdk/canonical";
import {
  canonicalize,
  computeEnvelopeId,
  isSignedAt,
  type StampEnvelope,
  canonicalMessage as stampCanonicalMessage,
} from "@orangecheck/stamp-core";
import { z } from "zod";
import { sha256Hex } from "./hash.ts";
import type { OcAuthorizeCommand, OcRevokeCommand } from "./orangecheck-commands.ts";

export * from "./orangecheck-commands.ts";

export type { ActionEnvelope, DelegationEnvelope, RevocationEnvelope, StampEnvelope };

export const OC_DOMAIN = "blocklore.space";
/** The one identity the owner's attestation binds (ORANGECHECK.md, default 4). */
export const OC_IDENTITY = `dns:${OC_DOMAIN}`;
/** Snapshots and agent actions are JSON. */
export const OC_MIME = "application/json";
/** The only authority the owner hands the publisher key: stamping JSON. */
export const OC_SCOPE = "stamp:sign(mime=application/json)";
/** The longest delegation OC Agent allows (SPEC section 4.4); the owner renews it each year. */
export const OC_DELEGATION_DAYS = 365;
/** The family's default relays, as @orangecheck/nostr-core 0.8.3 publishes them (a brain test pins it). */
export const OC_RELAYS = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://nostr.oxtr.dev",
  "wss://relay.ochk.io",
] as const;
/** Nostr kinds the family registry (KINDS.md) assigns. */
export const OC_KINDS = {
  attestation: 30078,
  stamp: 30083,
  delegation: 30083,
  action: 30084,
  revocation: 30085,
} as const;
/** The package versions Blocklore pins, and the CLIs a reader can run without Blocklore's code. */
export const OC_VERSIONS = {
  stampCore: "1.4.0",
  agentCore: "2.10.0",
  bip322: "1.1.3",
  sdk: "1.26.2",
  nostrCore: "0.8.3",
  stampCli: "0.4.1",
  agentCli: "0.3.5",
  cli: "0.5.6",
} as const;
/** A stamp made this long after its edition was taken is labelled as signed later. */
export const BACK_SIGNED_MS = 60 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const DAY_MS = 86_400_000;

/** The one-second UTC form of a moment. */
export const secondTime = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// --- records ---------------------------------------------------------------------------------------

/** An attestation as stored (SPEC section 5.3). Only `message` and `signature` are signed. */
export interface AttestationRecord {
  attestation_id: string;
  scheme: "bip322";
  address: string;
  identities: { protocol: string; identifier: string }[];
  message: string;
  message_b64url: string;
  signature: string;
  issued_at: string;
  verification_url: string;
}

/** The public record in knowledge/orangecheck/: what stands behind every signature. */
export interface OcRecords {
  attestations: AttestationRecord[];
  delegations: DelegationEnvelope[];
  revocations: RevocationEnvelope[];
}

export const EMPTY_RECORDS: OcRecords = { attestations: [], delegations: [], revocations: [] };

const actor = z.object({ address: z.string().max(100), alg: z.literal("bip322") });
const sig = z.object({ alg: z.literal("bip322"), pubkey: z.string().max(100), value: z.string() });
const ots = z
  .object({
    status: z.enum(["pending", "confirmed"]),
    proof: z.string(),
    calendars: z.array(z.string()),
    block_height: z.number().int().nullable(),
    block_hash: z.string().nullable(),
    upgraded_at: z.string().nullable(),
  })
  .nullable();
const content = z.object({
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  length: z.number().int().min(0),
  mime: z.string().min(1).max(200),
  ref: z.string().nullable(),
});

/** Shapes for reading records from files; a record that parses is then checked by signature. */
export const StampEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("stamp"),
  id: z.string().regex(HEX64),
  content,
  signer: actor,
  signed_at: z.string(),
  stake: z.null(),
  ots,
  sig,
});
export const ActionEnvelopeSchema = StampEnvelopeSchema.omit({ kind: true, stake: true }).extend({
  kind: z.literal("agent-action"),
  delegation_id: z.string().regex(HEX64),
  scope_exercised: z.string().max(500),
});
export const DelegationEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("agent-delegation"),
  id: z.string().regex(HEX64),
  principal: actor,
  agent: actor,
  scopes: z.array(z.string().max(500)).min(1).max(20),
  bond: z.null(),
  issued_at: z.string(),
  expires_at: z.string(),
  nonce: z.string().regex(HEX32),
  revocation: z.object({
    holders: z.array(z.enum(["principal", "agent"])),
    ref: z.string().nullable(),
  }),
  sig,
});
export const RevocationEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("agent-revocation"),
  id: z.string().regex(HEX64),
  delegation_id: z.string().regex(HEX64),
  signer: actor,
  reason: z.string(),
  signed_at: z.string(),
  ots,
  sig,
});
export const AttestationRecordSchema = z.object({
  attestation_id: z.string().regex(HEX64),
  scheme: z.literal("bip322"),
  address: z.string().max(100),
  identities: z.array(z.object({ protocol: z.string(), identifier: z.string() })),
  message: z.string().max(2000),
  message_b64url: z.string(),
  signature: z.string(),
  issued_at: z.string(),
  verification_url: z.string(),
});

// --- content ---------------------------------------------------------------------------------------

export interface ContentFacts {
  /** "sha256:<64 hex>" */
  hash: string;
  length: number;
}

const utf8 = new TextEncoder();

/** Facts about text as UTF-8 bytes, the form a stamp commits to. */
export function textContent(text: string): ContentFacts {
  return { hash: `sha256:${sha256Hex(text)}`, length: utf8.encode(text).byteLength };
}

/**
 * A JSON value as the exact text a stamp or action covers: RFC 8785 canonical JSON (keys sorted,
 * no whitespace), no final newline. A reader recomputes it with any RFC 8785 library.
 */
export function jsonContent(value: unknown): ContentFacts & { text: string } {
  const text = canonicalize(JSON.parse(JSON.stringify(value)));
  return { text, ...textContent(text) };
}

/** Canonical JSON plus a final newline: how every envelope file in the store is written. */
export const envelopeFile = (env: object): string =>
  `${canonicalize(JSON.parse(JSON.stringify(env)))}\n`;

// --- stamps and actions ----------------------------------------------------------------------------

export interface StampInput {
  address: string;
  content: ContentFacts;
  mime: string;
  signedAt: string;
}

/** What the signer signs: the hex id of the canonical message (OC Stamp section 4.5). */
export function stampDraft(i: StampInput): { message: string; id: string } {
  const canon = {
    address: i.address,
    content_hash: i.content.hash,
    content_length: i.content.length,
    content_mime: i.mime,
    signed_at: i.signedAt,
  };
  return { message: stampCanonicalMessage(canon), id: computeEnvelopeId(canon) };
}

/** The envelope for a signature over `stampDraft(i).id`; throws when the signature does not verify. */
export function stampEnvelope(i: StampInput, signature: string, ref: string | null): StampEnvelope {
  const { id } = stampDraft(i);
  const env: StampEnvelope = {
    v: 1,
    kind: "stamp",
    id,
    content: { hash: i.content.hash, length: i.content.length, mime: i.mime, ref },
    signer: { address: i.address, alg: "bip322" },
    signed_at: i.signedAt,
    stake: null,
    ots: null,
    sig: { alg: "bip322", pubkey: i.address, value: signature },
  };
  const c = checkStamp(env);
  if (!c.ok) throw new Error(c.why);
  return env;
}

/**
 * A JSON value stamped by any key, the owner's included: what their wallet signs (`id`) and the
 * exact text it covers. The owner's veto of an evaluator decision is signed this way, pasted back,
 * and turned into an envelope by `jsonStampEnvelope`.
 */
export function jsonStampDraft(
  value: unknown,
  address: string,
  signedAt: string,
): { message: string; id: string; content: string } {
  const c = jsonContent(value);
  return { ...stampDraft({ address, content: c, mime: OC_MIME, signedAt }), content: c.text };
}

/** The envelope for a pasted signature over `jsonStampDraft(...).id`; throws when it does not verify. */
export function jsonStampEnvelope(
  value: unknown,
  address: string,
  signedAt: string,
  signature: string,
): StampEnvelope {
  return stampEnvelope(
    { address, content: jsonContent(value), mime: OC_MIME, signedAt },
    signature,
    null,
  );
}

export interface ActionInput extends StampInput {
  delegationId: string;
  scope: string;
}

export function actionDraft(i: ActionInput): { message: string; id: string } {
  const canon = {
    address: i.address,
    content_hash: i.content.hash,
    content_length: i.content.length,
    content_mime: i.mime,
    signed_at: i.signedAt,
    delegation_id: i.delegationId,
    scope_exercised: i.scope,
  };
  return { message: actionCanonicalMessage(canon), id: computeActionId(canon) };
}

export function actionEnvelope(
  i: ActionInput,
  signature: string,
  ref: string | null,
): ActionEnvelope {
  const { id } = actionDraft(i);
  const env: ActionEnvelope = {
    v: 1,
    kind: "agent-action",
    id,
    content: { hash: i.content.hash, length: i.content.length, mime: i.mime, ref },
    signer: { address: i.address, alg: "bip322" },
    signed_at: i.signedAt,
    delegation_id: i.delegationId,
    scope_exercised: i.scope,
    ots: null,
    sig: { alg: "bip322", pubkey: i.address, value: signature },
  };
  const c = checkActionSignature(env);
  if (!c.ok) throw new Error(c.why);
  return env;
}

// --- the owner's attestation and delegation ----------------------------------------------------------

/** The attestation the owner signs: their address bound to dns:blocklore.space (SPEC section 2). */
export function attestationMessage(owner: string, nonce: string, issuedAt: string): string {
  return buildCanonicalMessage(
    { address: owner, identities: [{ protocol: "dns", identifier: OC_DOMAIN }] },
    {},
    { nonce, issuedAt },
  );
}

export function attestationRecord(message: string, signature: string): AttestationRecord {
  const id = sha256Hex(message);
  const address = field(message, "address") ?? "";
  const identities = (field(message, "identities") ?? "")
    .split(",")
    .filter(Boolean)
    .map((b) => {
      const at = b.indexOf(":");
      return { protocol: b.slice(0, at), identifier: b.slice(at + 1) };
    });
  return {
    attestation_id: id,
    scheme: "bip322",
    address,
    identities,
    message,
    message_b64url: base64url(utf8.encode(message)),
    signature,
    issued_at: field(message, "issued_at") ?? "",
    verification_url: `https://attest.ochk.io/attest/${id}`,
  };
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function field(message: string, key: string): string | undefined {
  for (const line of message.split("\n")) {
    const at = line.indexOf(": ");
    if (at > 0 && line.slice(0, at) === key) return line.slice(at + 2);
  }
  return undefined;
}

export interface DelegationInput {
  principal: string;
  agent: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

function delegationCanon(i: DelegationInput) {
  return {
    principal: i.principal,
    agent: i.agent,
    scopes: [OC_SCOPE],
    bond_sats: 0,
    bond_attestation: "none",
    issued_at: i.issuedAt,
    expires_at: i.expiresAt,
    nonce: i.nonce,
  };
}

/** The delegation the owner signs: what it grants, in full, and the id their wallet signs. */
export function delegationDraft(i: DelegationInput): { message: string; id: string } {
  const canon = delegationCanon(i);
  return { message: delegationCanonicalMessage(canon), id: computeDelegationId(canon) };
}

export function delegationEnvelope(i: DelegationInput, signature: string): DelegationEnvelope {
  return {
    v: 1,
    kind: "agent-delegation",
    id: delegationDraft(i).id,
    principal: { address: i.principal, alg: "bip322" },
    agent: { address: i.agent, alg: "bip322" },
    scopes: canonicalizeScopes([OC_SCOPE]),
    bond: null,
    issued_at: i.issuedAt,
    expires_at: i.expiresAt,
    nonce: i.nonce,
    revocation: { holders: ["principal", "agent"], ref: null },
    sig: { alg: "bip322", pubkey: i.principal, value: signature },
  };
}

export interface RevocationInput {
  signer: string;
  delegationId: string;
  reason: string;
  signedAt: string;
}

function revocationCanon(i: RevocationInput) {
  return {
    address: i.signer,
    delegation_id: i.delegationId,
    reason: i.reason,
    signed_at: i.signedAt,
  };
}

export function revocationDraft(i: RevocationInput): { message: string; id: string } {
  const canon = revocationCanon(i);
  return { message: revocationCanonicalMessage(canon), id: computeRevocationId(canon) };
}

export function revocationEnvelope(i: RevocationInput, signature: string): RevocationEnvelope {
  return {
    v: 1,
    kind: "agent-revocation",
    id: revocationDraft(i).id,
    delegation_id: i.delegationId,
    signer: { address: i.signer, alg: "bip322" },
    reason: i.reason,
    signed_at: i.signedAt,
    ots: null,
    sig: { alg: "bip322", pubkey: i.signer, value: signature },
  };
}

/**
 * The delegation window the admin offers: from the publisher key's first signature (so the owner's
 * delegation covers what the key already signed, and the admin says so) or from now, for a year.
 */
export function delegationWindow(
  now: Date,
  firstSignature: string | null,
): { issuedAt: string; expiresAt: string } {
  const nowMs = Math.floor(now.getTime() / 1000) * 1000;
  const first = firstSignature ? Date.parse(firstSignature) : Number.NaN;
  // Keep at least 30 days of the year ahead; a first signature older than that starts from now.
  const from =
    Number.isFinite(first) && first <= nowMs && nowMs - first < (OC_DELEGATION_DAYS - 30) * DAY_MS
      ? first
      : nowMs;
  return {
    issuedAt: secondTime(new Date(from)),
    expiresAt: secondTime(new Date(from + OC_DELEGATION_DAYS * DAY_MS)),
  };
}

// --- checks ----------------------------------------------------------------------------------------

export type SigCheck = { ok: true } | { ok: false; why: string };
const fail = (why: string): SigCheck => ({ ok: false, why });
const OK: SigCheck = { ok: true };

const verifies = (address: string, message: string, signature: string) =>
  verifySignature(address, message, signature);

/** OC Stamp section 8.1 steps 1 to 4, and the content hash when the content is given. */
export function checkStamp(env: StampEnvelope, content?: ContentFacts): SigCheck {
  if (env.v !== 1) return fail("unsupported stamp version");
  if (env.kind !== "stamp") return fail("not a stamp");
  if (!isSignedAt(env.signed_at)) return fail("signed_at is not a SPEC time");
  if (env.sig.pubkey !== env.signer.address) return fail("sig.pubkey differs from the signer");
  const { id } = stampDraft({
    address: env.signer.address,
    content: env.content,
    mime: env.content.mime,
    signedAt: env.signed_at,
  });
  if (id !== env.id) return fail("the id does not match the signed fields");
  if (!verifies(env.signer.address, env.id, env.sig.value))
    return fail("the BIP-322 signature does not verify");
  if (content && (content.hash !== env.content.hash || content.length !== env.content.length))
    return fail("the stamp covers other content");
  return OK;
}

/** An action's own signature and id (OC Agent section 8.2), not yet its authority. */
export function checkActionSignature(env: ActionEnvelope): SigCheck {
  if (env.v !== 1 || env.kind !== "agent-action") return fail("not an agent action");
  if (!isSignedAt(env.signed_at)) return fail("signed_at is not a SPEC time");
  if (env.sig.pubkey !== env.signer.address) return fail("sig.pubkey differs from the signer");
  const { id } = actionDraft({
    address: env.signer.address,
    content: env.content,
    mime: env.content.mime,
    signedAt: env.signed_at,
    delegationId: env.delegation_id,
    scope: env.scope_exercised,
  });
  if (id !== env.id) return fail("the id does not match the signed fields");
  if (!verifies(env.signer.address, env.id, env.sig.value))
    return fail("the BIP-322 signature does not verify");
  return OK;
}

/** An attestation: canonical, signed by its address, and binding dns:blocklore.space. */
export function checkAttestation(a: AttestationRecord): SigCheck {
  if (!isCanonicalAttestation(a.message)) return fail("the message is not a canonical attestation");
  if (sha256Hex(a.message) !== a.attestation_id) return fail("the id is not the message's SHA-256");
  const address = field(a.message, "address") ?? "";
  if (address !== a.address) return fail("the address differs from the signed message's");
  const d = decodeAddress(address);
  if (d?.network !== "mainnet") return fail("not a mainnet address");
  const ids = (field(a.message, "identities") ?? "").split(",");
  if (!ids.includes(OC_IDENTITY)) return fail(`the attestation does not bind ${OC_IDENTITY}`);
  if (!verifies(address, a.message, a.signature))
    return fail("the BIP-322 signature does not verify");
  return OK;
}

/** A delegation (OC Agent section 8.1 steps 1 to 5): shape, window, id, scopes, signature. */
export function checkDelegation(d: DelegationEnvelope): SigCheck {
  if (d.v !== 1 || d.kind !== "agent-delegation") return fail("not a delegation");
  if (!d.scopes?.length) return fail("no scopes");
  if (d.sig.pubkey !== d.principal.address) return fail("sig.pubkey differs from the principal");
  if (!isSignedAt(d.issued_at) || !isSignedAt(d.expires_at)) return fail("a time is malformed");
  const span = Date.parse(d.expires_at) - Date.parse(d.issued_at);
  if (!(span > 0)) return fail("it expires before it begins");
  if (span > OC_DELEGATION_DAYS * DAY_MS) return fail("it lasts longer than 365 days");
  try {
    for (const s of d.scopes) validateScope(parseScope(s), { mode: "strict" });
  } catch (e) {
    return fail(`a scope is malformed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const id = computeDelegationId({
    principal: d.principal.address,
    agent: d.agent.address,
    scopes: canonicalizeScopes(d.scopes),
    bond_sats: d.bond?.sats ?? 0,
    bond_attestation: d.bond?.attestation_id ?? "none",
    issued_at: d.issued_at,
    expires_at: d.expires_at,
    nonce: d.nonce,
  });
  if (id !== d.id) return fail("the id does not match the signed fields");
  if (!verifies(d.principal.address, d.id, d.sig.value))
    return fail("the BIP-322 signature does not verify");
  return OK;
}

/** A revocation of `d` (OC Agent sections 9.1 and 9.5): signed by its principal or its agent. */
export function checkRevocation(r: RevocationEnvelope, d: DelegationEnvelope): SigCheck {
  if (r.delegation_id !== d.id) return fail("it names another delegation");
  if (r.signer.address !== d.principal.address && r.signer.address !== d.agent.address)
    return fail("only the delegation's principal or agent may revoke it");
  if (!isSignedAt(r.signed_at)) return fail("signed_at is malformed");
  const { id } = revocationDraft({
    signer: r.signer.address,
    delegationId: r.delegation_id,
    reason: r.reason,
    signedAt: r.signed_at,
  });
  if (!verifies(r.signer.address, id, r.sig.value))
    return fail("the BIP-322 signature does not verify");
  return OK;
}

/** Whether a delegation grants stamping content of this media type. */
export function grantsStamp(d: DelegationEnvelope, mime: string): boolean {
  let exercised: ReturnType<typeof parseScope>;
  try {
    exercised = parseScope(`stamp:sign(mime=${mime.toLowerCase()})`);
  } catch {
    return false;
  }
  return (d.scopes ?? []).some((g) => {
    try {
      return isSubScope(exercised, parseScope(g));
    } catch {
      return false;
    }
  });
}

/** Whether an exercised scope string narrows one of the granted scopes (OC Agent section 7.4). */
export function isSubScopeOf(exercised: string, granted: string[]): boolean {
  try {
    const e = parseScope(exercised);
    return granted.some((g) => {
      try {
        return isSubScope(e, parseScope(g));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** Every record that checks, and a problem line for each that does not. */
export function checkRecords(r: OcRecords): { valid: OcRecords; problems: string[] } {
  const problems: string[] = [];
  const attestations = r.attestations.filter((a) => {
    const c = checkAttestation(a);
    if (!c.ok) problems.push(`attestation ${a.attestation_id}: ${c.why}`);
    return c.ok;
  });
  const delegations = r.delegations.filter((d) => {
    const c = checkDelegation(d);
    if (!c.ok) problems.push(`delegation ${d.id}: ${c.why}`);
    return c.ok;
  });
  const revocations = r.revocations.filter((v) => {
    const d = delegations.find((x) => x.id === v.delegation_id);
    const c = d ? checkRevocation(v, d) : fail("it names no delegation in the record");
    if (!c.ok) problems.push(`revocation ${v.id}: ${c.why}`);
    return c.ok;
  });
  return { valid: { attestations, delegations, revocations }, problems };
}

// --- authority -------------------------------------------------------------------------------------

export type Authority =
  | {
      state: "delegated";
      /** The owner's address, attested for dns:blocklore.space. */
      owner: string;
      attestation: string;
      delegation: string;
      expires: string;
    }
  | { state: "alone"; why: string };

/** The newest checked attestation for an address, by the issue time it signed. */
export function attestationFor(valid: OcRecords, address: string): AttestationRecord | null {
  return (
    valid.attestations
      .filter((a) => a.address === address)
      .sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1))[0] ?? null
  );
}

/** The earliest checked revocation of a delegation, the one in effect first. */
export function revocationOf(valid: OcRecords, delegationId: string): RevocationEnvelope | null {
  return (
    valid.revocations
      .filter((r) => r.delegation_id === delegationId)
      .sort((a, b) => Date.parse(a.signed_at) - Date.parse(b.signed_at))[0] ?? null
  );
}

/**
 * Whether the owner stood behind a signature by `signer` at `signedAt` over content of `mime`: a
 * checked delegation to that key, granting the scope, in force then (issued, not expired, not yet
 * revoked), from an owner whose key is attested for dns:blocklore.space. `valid` holds only records
 * that passed `checkRecords`. The time is the signer's own claim; ORANGECHECK.md says so to readers.
 */
export function authorityAt(
  valid: OcRecords,
  signer: string,
  signedAt: string,
  mime: string,
): Authority {
  const t = Date.parse(signedAt);
  const mine = valid.delegations.filter((d) => d.agent.address === signer);
  if (!mine.length)
    return {
      state: "alone",
      why: valid.delegations.length
        ? "The owner's delegation names a different publisher key."
        : "The owner has not delegated this key yet.",
    };
  const reasons: string[] = [];
  for (const d of [...mine].sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1))) {
    if (!grantsStamp(d, mime)) {
      reasons.push(`The owner's delegation does not cover ${mime}.`);
      continue;
    }
    if (t < Date.parse(d.issued_at)) {
      reasons.push(`Signed before the owner's delegation began (${d.issued_at}).`);
      continue;
    }
    if (t >= Date.parse(d.expires_at)) {
      reasons.push(`Signed after the owner's delegation ended (${d.expires_at}).`);
      continue;
    }
    const rev = revocationOf(valid, d.id);
    if (rev && Date.parse(rev.signed_at) <= t) {
      reasons.push(`Signed after the delegation was revoked (${rev.signed_at}).`);
      continue;
    }
    const a = attestationFor(valid, d.principal.address);
    if (!a) {
      reasons.push(`The delegating key has no attestation for ${OC_IDENTITY}.`);
      continue;
    }
    return {
      state: "delegated",
      owner: d.principal.address,
      attestation: a.attestation_id,
      delegation: d.id,
      expires: d.expires_at,
    };
  }
  return { state: "alone", why: reasons[0] ?? "The owner has not delegated this key yet." };
}

/** What a reader sees about one edition's signature. */
export interface EditionSignature {
  /** The stamp file beside the snapshot, `<n>.json.stamp`. */
  file: string;
  id: string;
  signer: string;
  signedAt: string;
  /** Signed later than the edition was taken (back-signed), and labelled so. */
  backSigned: boolean;
  /** The stamp verifies and covers this snapshot file's exact bytes. */
  ok: boolean;
  problem: string | null;
  authority: Authority;
}

export function editionSignature(
  env: StampEnvelope,
  file: string,
  snapshotText: string,
  takenAt: string,
  valid: OcRecords,
): EditionSignature {
  const c = checkStamp(env, textContent(snapshotText));
  const mimeOk = env.content.mime === OC_MIME;
  const ok = c.ok && mimeOk;
  return {
    file,
    id: env.id,
    signer: env.signer.address,
    signedAt: env.signed_at,
    backSigned: Date.parse(env.signed_at) - Date.parse(takenAt) > BACK_SIGNED_MS,
    ok,
    problem: c.ok ? (mimeOk ? null : `the stamp's media type is ${env.content.mime}`) : c.why,
    authority: ok
      ? authorityAt(valid, env.signer.address, env.signed_at, env.content.mime)
      : { state: "alone", why: "The signature does not check." },
  };
}

/** An edition's stamp file read and checked; a problem is a store error (a stamp must check). */
export function readEditionSignature(
  stampText: string | null,
  manifest: { n: number; at: { time: string } },
  snapshotText: string,
  valid: OcRecords,
): { signature: EditionSignature | null; problem: string | null } {
  if (stampText === null) return { signature: null, problem: null };
  let raw: unknown;
  try {
    raw = JSON.parse(stampText);
  } catch (e) {
    return { signature: null, problem: `not JSON: ${String(e)}` };
  }
  const p = StampEnvelopeSchema.safeParse(raw);
  if (!p.success) return { signature: null, problem: "not an OC Stamp envelope" };
  const sig = editionSignature(
    p.data as StampEnvelope,
    `${manifest.n}.json.stamp`,
    snapshotText,
    manifest.at.time,
    valid,
  );
  return { signature: sig, problem: sig.ok ? null : sig.problem };
}

// --- the owner's commands, checked --------------------------------------------------------------------

export type Built<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Why a pasted attestation signature fails, in words the owner can act on. */
function attestationSignatureError(owner: string, message: string, signature: string): string {
  // Some wallets drop the message's final line break when it is pasted into them.
  if (verifies(owner, message.replace(/\n$/, ""), signature))
    return "Your wallet signed the attestation without its final line break. Paste the text again with the empty last line kept, and sign it again.";
  return `The attestation signature does not verify for ${owner}. Sign the exact attestation text with the wallet that holds this address, then paste what it gives.`;
}

/**
 * Only the BIP-322 signatures of an owner command, so the site can tell the owner at once that a
 * paste is wrong; the daemon checks the whole command again with the store. Null when they verify.
 */
export function ocSignatureProblem(cmd: OcAuthorizeCommand | OcRevokeCommand): string | null {
  if (cmd.type === "orangecheck.revoke") {
    const { id } = revocationDraft({
      signer: cmd.signer,
      delegationId: cmd.delegationId,
      reason: cmd.reason,
      signedAt: cmd.signedAt,
    });
    return verifies(cmd.signer, id, cmd.sig)
      ? null
      : `The revocation signature does not verify for ${cmd.signer}. Sign the 64-character id shown, with the wallet that holds this address.`;
  }
  if (cmd.attestation) {
    const message = attestationMessage(cmd.owner, cmd.attestation.nonce, cmd.attestation.issuedAt);
    if (!verifies(cmd.owner, message, cmd.attestation.sig))
      return attestationSignatureError(cmd.owner, message, cmd.attestation.sig);
  }
  if (cmd.delegation) {
    const { id } = delegationDraft({
      principal: cmd.owner,
      agent: cmd.agent,
      issuedAt: cmd.delegation.issuedAt,
      expiresAt: cmd.delegation.expiresAt,
      nonce: cmd.delegation.nonce,
    });
    if (!verifies(cmd.owner, id, cmd.delegation.sig))
      return `The delegation signature does not verify for ${cmd.owner}. Sign the delegation's id (the 64 characters shown), not its text, with the same wallet.`;
  }
  return null;
}

/**
 * The records an authorize command makes, each checked: the attestation's BIP-322 signature over
 * its exact message, the delegation's over its id, the agent being this devbox's publisher key,
 * and a delegating owner who is attested (now or before). Errors are for the owner to read.
 */
export function buildAuthorization(
  cmd: OcAuthorizeCommand,
  publisher: string | null,
  valid: OcRecords,
): Built<{ attestation: AttestationRecord | null; delegation: DelegationEnvelope | null }> {
  if (!cmd.attestation && !cmd.delegation)
    return { ok: false, error: "Nothing to record: send an attestation, a delegation or both." };
  let attestation: AttestationRecord | null = null;
  if (cmd.attestation) {
    const message = attestationMessage(cmd.owner, cmd.attestation.nonce, cmd.attestation.issuedAt);
    if (!verifies(cmd.owner, message, cmd.attestation.sig))
      return {
        ok: false,
        error: attestationSignatureError(cmd.owner, message, cmd.attestation.sig),
      };
    attestation = attestationRecord(message, cmd.attestation.sig);
    const c = checkAttestation(attestation);
    if (!c.ok) return { ok: false, error: `The attestation does not check: ${c.why}.` };
  }
  let delegation: DelegationEnvelope | null = null;
  if (cmd.delegation) {
    if (!publisher)
      return {
        ok: false,
        error: "The devbox has no publisher key yet, so there is nothing to delegate to.",
      };
    if (cmd.agent !== publisher)
      return {
        ok: false,
        error: `The delegation names ${cmd.agent}, but the devbox's publisher key is ${publisher}. Reload the page and sign again.`,
      };
    const input: DelegationInput = {
      principal: cmd.owner,
      agent: cmd.agent,
      issuedAt: cmd.delegation.issuedAt,
      expiresAt: cmd.delegation.expiresAt,
      nonce: cmd.delegation.nonce,
    };
    delegation = delegationEnvelope(input, cmd.delegation.sig);
    const c = checkDelegation(delegation);
    if (!c.ok)
      return {
        ok: false,
        error:
          c.why === "the BIP-322 signature does not verify"
            ? `The delegation signature does not verify for ${cmd.owner}. Sign the delegation's id (the 64 characters shown), not its text, with the same wallet.`
            : `The delegation does not check: ${c.why}.`,
      };
    if (!attestation && !attestationFor(valid, cmd.owner))
      return {
        ok: false,
        error: `${cmd.owner} has no attestation for ${OC_IDENTITY} yet. Sign the attestation too.`,
      };
  }
  return { ok: true, attestation, delegation };
}

/** The revocation a revoke command makes, checked against the delegation it names. */
export function buildRevocation(
  cmd: OcRevokeCommand,
  valid: OcRecords,
): Built<{ revocation: RevocationEnvelope }> {
  const d = valid.delegations.find((x) => x.id === cmd.delegationId);
  if (!d) return { ok: false, error: `No delegation ${cmd.delegationId} is on record.` };
  const earlier = revocationOf(valid, d.id);
  if (earlier && Date.parse(earlier.signed_at) <= Date.parse(cmd.signedAt))
    return { ok: false, error: `That delegation was already revoked at ${earlier.signed_at}.` };
  const revocation = revocationEnvelope(
    {
      signer: cmd.signer,
      delegationId: cmd.delegationId,
      reason: cmd.reason,
      signedAt: cmd.signedAt,
    },
    cmd.sig,
  );
  const c = checkRevocation(revocation, d);
  if (!c.ok)
    return {
      ok: false,
      error:
        c.why === "the BIP-322 signature does not verify"
          ? `The revocation signature does not verify for ${cmd.signer}. Sign the revocation's id (the 64 characters shown) with the wallet that holds this address.`
          : `The revocation does not check: ${c.why}.`,
    };
  return { ok: true, revocation };
}

// --- where records live, and what a domain serves -------------------------------------------------------

/** Paths under knowledge/, relative to it. */
export const ocPath = {
  attestation: (id: string) => `orangecheck/attestations/${id}.json`,
  delegation: (id: string) => `orangecheck/delegations/${id}.json`,
  revocation: (id: string) => `orangecheck/revocations/${id}.json`,
  stamp: (n: number) => `snapshots/${n}.json.stamp`,
} as const;

/** The attestation /.well-known/orangecheck.txt names: the newest checked one for the domain. */
export function currentAttestation(valid: OcRecords): AttestationRecord | null {
  return [...valid.attestations].sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1))[0] ?? null;
}

/**
 * `/.well-known/orangecheck.txt`, the one proof of a dns: binding (oc-attest-protocol README): the
 * layout @orangecheck/sdk's generateWellKnownContent writes, with one Domain line, then the
 * delegations that chain to it. Null before the owner has attested.
 */
export function wellKnownText(valid: OcRecords, site: string): string | null {
  const a = currentAttestation(valid);
  if (!a) return null;
  const lines = [
    "orangecheck attestation verification",
    "=====================================",
    "",
    `Domain: ${OC_DOMAIN}`,
    `Attestation ID: ${a.attestation_id}`,
    `Timestamp: ${a.issued_at}`,
    "",
    `This file verifies that the owner of ${OC_DOMAIN} controls the Bitcoin`,
    `address associated with attestation ${a.attestation_id}.`,
    "",
    `Address: ${a.address}`,
  ];
  const ds = valid.delegations
    .filter((d) => d.principal.address === a.address)
    .sort((x, y) => (x.issued_at < y.issued_at ? -1 : 1));
  for (const d of ds) {
    const rev = revocationOf(valid, d.id);
    lines.push(
      `Delegation: ${d.id}`,
      `  to ${d.agent.address}, scope ${(d.scopes ?? []).join(",")}`,
      `  from ${d.issued_at} until ${d.expires_at}${rev ? `, revoked ${rev.signed_at}` : ""}`,
    );
  }
  lines.push(
    "",
    `The records and how to check them offline: ${site}/verify/keys`,
    "Learn more: https://ochk.io",
    "",
    "---",
    "",
    "Verification method: .well-known/orangecheck.txt",
    "Protocol: orangecheck protocol (OCP)",
    "",
  );
  return lines.join("\n");
}

// --- Nostr ---------------------------------------------------------------------------------------

/** An event before its pubkey, id and signature: what the brain signs with its Nostr key. */
export interface NostrTemplate {
  kind: number;
  tags: string[][];
  content: string;
}

export type Publishable =
  | { type: "stamp"; envelope: StampEnvelope }
  | { type: "action"; envelope: ActionEnvelope }
  | { type: "delegation"; envelope: DelegationEnvelope }
  | { type: "revocation"; envelope: RevocationEnvelope }
  | { type: "attestation"; record: AttestationRecord };

/** The id a published record is known by (its d tag value). */
export function publishableId(p: Publishable): string {
  return p.type === "attestation" ? p.record.attestation_id : p.envelope.id;
}

/** Each record as the event its spec defines (stamp 7, agent 10.1, 10.3, 9.4, attest 6.1). */
export function nostrTemplate(p: Publishable): NostrTemplate {
  const json = (v: object) => canonicalize(JSON.parse(JSON.stringify(v)));
  switch (p.type) {
    case "stamp": {
      const e = p.envelope;
      return {
        kind: OC_KINDS.stamp,
        tags: [
          ["d", `oc-stamp:${e.id}`],
          ["t", e.signer.address],
          ["t", e.content.hash],
          ["t", "oc-stamp"],
        ],
        content: json(e),
      };
    }
    case "action": {
      const e = p.envelope;
      return {
        kind: OC_KINDS.action,
        tags: [
          ["d", `oc-agent-act:${e.id}`],
          ["t", e.delegation_id],
          ["kind", "agent-action"],
          ["delegation", e.delegation_id],
          ["agent", e.signer.address],
          ["scope", e.scope_exercised],
          ["hash", e.content.hash],
          ["signed_at", e.signed_at],
        ],
        content: json(e),
      };
    }
    case "delegation": {
      const e = p.envelope;
      return {
        kind: OC_KINDS.delegation,
        tags: [
          ["d", `oc-agent-del:${e.id}`],
          ["t", e.principal.address],
          ["t", e.agent.address],
          ["principal", e.principal.address],
          ["agent", e.agent.address],
          ["expires", String(Math.floor(Date.parse(e.expires_at) / 1000))],
          ...(e.scopes ?? []).map((s) => ["scope", s]),
        ],
        content: json(e),
      };
    }
    case "revocation": {
      const e = p.envelope;
      return {
        kind: OC_KINDS.revocation,
        tags: [
          ["d", `oc-agent-rev:${e.id}`],
          ["t", e.delegation_id],
          ["t", e.signer.address],
          ["delegation", e.delegation_id],
          ["signer_addr", e.signer.address],
        ],
        content: json(e),
      };
    }
    case "attestation": {
      const a = p.record;
      return {
        kind: OC_KINDS.attestation,
        tags: [
          ["d", a.attestation_id],
          ["t", a.address],
          ["t", "oc-attest"],
          ["address", a.address],
          ["scheme", "bip322"],
          ["issued_at", a.issued_at],
          ...a.identities.map((i) => ["i", `${i.protocol}:${i.identifier}`]),
        ],
        content: json(a),
      };
    }
  }
}

/** The relay filter that finds a published record again. */
export function nostrFilter(p: Publishable): { kinds: number[]; "#d": string[] } {
  const t = nostrTemplate(p);
  return { kinds: [t.kind], "#d": [t.tags[0]?.[1] ?? ""] };
}
