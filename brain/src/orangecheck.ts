// The publisher key on the devbox (ORANGECHECK.md, SECURITY.md T3). It signs every snapshot with
// an OC Stamp and every evaluator decision as an OC Agent action, records the owner's signed
// attestation, delegation and revocations in knowledge/orangecheck/, and publishes all of it on
// Nostr. Only deterministic code holds the key: it lives in .env as BLOCKLORE_PUBLISHER_KEY (mode
// 600), and model roles run with a scrubbed environment that never carries it (agent.ts, roleEnv).
// The key is never printed, logged or put on a command line; only its address is shown.
//
//   pnpm brain orangecheck keygen            make the key (refuses when there is one)
//   pnpm brain orangecheck status            the address, the records, each edition's signature
//   pnpm brain orangecheck backfill [--no-commit] [--push]   sign the snapshots that have no stamp
//   pnpm brain orangecheck publish [--dry-run]               the records to the family's relays
import { hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type ActionEnvelope,
  type Authority,
  actionDraft,
  actionEnvelope,
  authorityAt,
  buildAuthorization,
  buildRevocation,
  checkActionSignature,
  checkRecords,
  checkStamp,
  EMPTY_RECORDS,
  envelopeFile,
  isSubScopeOf,
  jsonContent,
  nostrFilter,
  nostrTemplate,
  OC_DOMAIN,
  OC_MIME,
  OC_RELAYS,
  OC_SCOPE,
  type OcCommand,
  type OcRecords,
  ocPath,
  type Publishable,
  publishableId,
  readEditionSignature,
  type StampEnvelope,
  type Store,
  secondTime,
  snapshotFile,
  stampDraft,
  stampEnvelope,
  textContent,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { schnorr } from "@noble/curves/secp256k1.js";
import { addressFromPrivateKey, signMessage } from "@orangecheck/bip322";
import {
  getEventHash,
  type NostrEvent,
  type PublishResult,
  publishEvent,
  queryEvents,
} from "@orangecheck/nostr-core";
import { KNOWLEDGE, ROOT, VAR } from "./env.ts";
import { feedEvent } from "./feed.ts";
import { commitAsOwner } from "./git.ts";

export const PUBLISHER_KEY_VAR = "BLOCKLORE_PUBLISHER_KEY";
const ENV_FILE = path.join(ROOT, ".env");
const PUBLISHED = path.join(VAR, "orangecheck", "published.json");
/** A record counts as published once this many relays hold it (OC Agent section 9.4). */
const WRITE_QUORUM = 2;

export interface Publisher {
  /** The P2WPKH address the key signs for; public. */
  address: string;
  /** A BIP-322 simple signature by the key over `message`, base64 (deterministic, RFC 6979). */
  sign(message: string): string;
  /** The Nostr service key, derived from the publisher key; it signs events, never envelopes. */
  nostr: { secret: Uint8Array; pubkey: string };
  /**
   * The Nostr channel key people follow (brain/src/nostr.ts), a sibling of `nostr` derived from the
   * publisher key under its own label, so the channel and the records never share a key.
   */
  channel: { secret: Uint8Array; pubkey: string };
}

/** The HKDF labels (info) each Nostr key is derived under, with salt "blocklore" (ORANGECHECK.md). */
export const NOSTR_KEY_LABELS = {
  records: "nostr-service-key/v1",
  channel: "nostr-channel-key/v1",
} as const;

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** The publisher key from the environment (.env), or null when there is none. */
export function publisherFrom(
  env: Record<string, string | undefined> = process.env,
): Publisher | null {
  const key = env[PUBLISHER_KEY_VAR]?.trim();
  if (!key) return null;
  if (!/^[0-9a-f]{64}$/.test(key))
    throw new Error(`${PUBLISHER_KEY_VAR} in .env is not 64 lowercase hex characters`);
  const address = addressFromPrivateKey(key, "p2wpkh");
  const derive = (info: string) => {
    const secret = new Uint8Array(
      hkdfSync("sha256", Buffer.from(key, "hex"), "blocklore", info, 32),
    );
    return { secret, pubkey: hex(schnorr.getPublicKey(secret)) };
  };
  return {
    address,
    sign: (message) => signMessage(address, message, key),
    nostr: derive(NOSTR_KEY_LABELS.records),
    channel: derive(NOSTR_KEY_LABELS.channel),
  };
}

/** What the daemon reports to the admin: public values only, null when there is no usable key. */
export function publisherState(): { publisher: string | null; nostr: string | null } {
  try {
    const p = publisherFrom();
    return { publisher: p?.address ?? null, nostr: p?.nostr.pubkey ?? null };
  } catch {
    return { publisher: null, nostr: null };
  }
}

function requirePublisher(): Publisher {
  const p = publisherFrom();
  if (!p)
    throw new Error(
      `no publisher key: run \`pnpm brain orangecheck keygen\` on the devbox (it writes ${PUBLISHER_KEY_VAR} to .env)`,
    );
  return p;
}

/**
 * Makes the publisher key and writes it to .env (mode 600). Prints the address and the Nostr key,
 * never the key. Refuses when a key is already set: a new key would orphan the owner's delegation.
 */
export function keygen(envFile = ENV_FILE): number {
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = new RegExp(`^${PUBLISHER_KEY_VAR}=(.*)$`, "m").exec(text);
  if (line?.[1]?.trim() || process.env[PUBLISHER_KEY_VAR]?.trim()) {
    const p = publisherFrom({ [PUBLISHER_KEY_VAR]: line?.[1] || process.env[PUBLISHER_KEY_VAR] });
    console.error(
      `keygen: ${PUBLISHER_KEY_VAR} is already set (address ${p?.address}); refusing to replace it, since the owner's delegation names that key`,
    );
    return 1;
  }
  let key = "";
  for (;;) {
    key = randomBytes(32).toString("hex");
    try {
      addressFromPrivateKey(key, "p2wpkh");
      break;
    } catch {
      // Out of the curve's range: astronomically rare; draw again.
    }
  }
  const entry = `${PUBLISHER_KEY_VAR}=${key}`;
  const next = line
    ? text.replace(line[0], entry)
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}# The publisher key (ORANGECHECK.md): signs snapshots and agent actions. Never print it.\n${entry}\n`;
  writeFileSync(envFile, next, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  const p = publisherFrom({ [PUBLISHER_KEY_VAR]: key });
  key = "";
  console.log(`publisher key written to ${path.relative(ROOT, envFile) || envFile} (mode 600)`);
  console.log(`  address    ${p?.address}`);
  console.log(`  nostr key  ${p?.nostr.pubkey}`);
  console.log("next: pnpm brain orangecheck backfill --push, then pnpm brain orangecheck publish");
  return 0;
}

/** The records in the store, only those whose signatures check. */
export function validRecords(store?: Store): OcRecords {
  return checkRecords((store ?? loadStore(KNOWLEDGE).store).orangecheck ?? EMPTY_RECORDS).valid;
}

// --- signing ---------------------------------------------------------------------------------------

/** The stamp of a snapshot file's exact text, by the publisher key, at `at`. */
export function stampSnapshotText(n: number, text: string, p: Publisher, at: Date): StampEnvelope {
  const input = {
    address: p.address,
    content: textContent(text),
    mime: OC_MIME,
    signedAt: secondTime(at),
  };
  return stampEnvelope(
    input,
    p.sign(stampDraft(input).id),
    `https://${OC_DOMAIN}/snapshots/${snapshotFile(n)}`,
  );
}

/**
 * Signs a snapshot file just written and puts its stamp beside it. Returns the stamp's path
 * relative to the repository, or null (with a line saying why) when there is no publisher key.
 */
export function signSnapshot(n: number, text: string, at = new Date()): string | null {
  const p = publisherFrom();
  if (!p) {
    console.log(`  snapshot ${n} is not signed: no publisher key (pnpm brain orangecheck keygen)`);
    return null;
  }
  const file = path.join(KNOWLEDGE, ocPath.stamp(n));
  writeFileSync(file, envelopeFile(stampSnapshotText(n, text, p, at)));
  console.log(`  snapshot ${n} signed by ${p.address}`);
  feedEvent({ kind: "snapshot", text: `Signed edition ${n} with OrangeCheck`, outcome: "ok" });
  return path.relative(ROOT, file);
}

/**
 * A JSON value signed by the publisher key, for the evaluator's decisions and anything else the
 * brain must stand behind. While the owner's delegation is in force it is an OC Agent action that
 * names the delegation (scope stamp:sign(mime=application/json)); before that, or after a
 * revocation, a plain OC Stamp, and the record says the key signed alone. `content` is the exact
 * text signed (RFC 8785 JSON): keep it with the envelope, or recompute it from the value.
 */
export function stampJson(
  value: unknown,
  opts: { at?: Date; ref?: string | null; records?: OcRecords; publisher?: Publisher } = {},
): { envelope: StampEnvelope | ActionEnvelope; content: string; authority: Authority } {
  const p = opts.publisher ?? requirePublisher();
  const valid = opts.records ? checkRecords(opts.records).valid : validRecords();
  const c = jsonContent(value);
  const signedAt = secondTime(opts.at ?? new Date());
  const authority = authorityAt(valid, p.address, signedAt, OC_MIME);
  const base = { address: p.address, content: c, mime: OC_MIME, signedAt };
  if (authority.state === "delegated") {
    const input = { ...base, delegationId: authority.delegation, scope: OC_SCOPE };
    return {
      envelope: actionEnvelope(input, p.sign(actionDraft(input).id), opts.ref ?? null),
      content: c.text,
      authority,
    };
  }
  return {
    envelope: stampEnvelope(base, p.sign(stampDraft(base).id), opts.ref ?? null),
    content: c.text,
    authority,
  };
}

export type StampedCheck =
  | { ok: true; kind: "stamp" | "action"; signer: string; signedAt: string; authority: Authority }
  | { ok: false; why: string };

/**
 * Checks a value against an envelope `stampJson` made: the signature, that it covers exactly this
 * value, and, for an action, that it names a delegation in force at its time (not revoked then).
 */
export function verifyStampedJson(
  value: unknown,
  envelope: StampEnvelope | ActionEnvelope,
  records?: OcRecords,
): StampedCheck {
  const valid = records ? checkRecords(records).valid : validRecords();
  const c = jsonContent(value);
  if (envelope.content.hash !== c.hash || envelope.content.length !== c.length)
    return { ok: false, why: "the envelope covers other content" };
  if (envelope.content.mime !== OC_MIME) return { ok: false, why: "the envelope is not JSON" };
  const authority = authorityAt(valid, envelope.signer.address, envelope.signed_at, OC_MIME);
  if (envelope.kind === "stamp") {
    const s = checkStamp(envelope, c);
    if (!s.ok) return s;
    return {
      ok: true,
      kind: "stamp",
      signer: envelope.signer.address,
      signedAt: envelope.signed_at,
      authority,
    };
  }
  const a = checkActionSignature(envelope);
  if (!a.ok) return a;
  if (authority.state !== "delegated" || authority.delegation !== envelope.delegation_id)
    return {
      ok: false,
      why:
        authority.state === "alone"
          ? `the action names a delegation not in force then: ${authority.why}`
          : "the action names another delegation than the one in force",
    };
  const d = valid.delegations.find((x) => x.id === envelope.delegation_id);
  if (!d || !isSubScopeOf(envelope.scope_exercised, d.scopes ?? []))
    return { ok: false, why: "the exercised scope is not one the delegation grants" };
  return {
    ok: true,
    kind: "action",
    signer: envelope.signer.address,
    signedAt: envelope.signed_at,
    authority,
  };
}

/** Signs every snapshot that has no stamp yet, labelled with the time of signing (after the fact). */
export function backfill(opts: { commit: boolean; push: boolean; at?: Date }): number {
  const p = requirePublisher();
  const { store } = loadStore(KNOWLEDGE);
  const at = opts.at ?? new Date();
  const todo = store.snapshots.filter((s) => !s.stamp).sort((a, b) => a.manifest.n - b.manifest.n);
  if (!todo.length) {
    console.log("backfill: every snapshot already has a stamp");
    return 0;
  }
  const paths: string[] = [];
  for (const s of todo) {
    const file = path.join(KNOWLEDGE, ocPath.stamp(s.manifest.n));
    writeFileSync(file, envelopeFile(stampSnapshotText(s.manifest.n, s.text, p, at)));
    paths.push(path.relative(ROOT, file));
    console.log(`backfill: snapshot ${s.manifest.n} signed by ${p.address} at ${secondTime(at)}`);
  }
  const ns = todo.map((s) => s.manifest.n);
  const which = ns.length === 1 ? `snapshot ${ns[0]}` : `snapshots ${ns[0]} to ${ns.at(-1)}`;
  if (opts.commit)
    commitAsOwner(
      paths,
      `Sign ${which} with the publisher key after the fact, so each edition carries a signature anyone can check. The stamps say when they were signed.`,
      opts.push,
    );
  return 0;
}

// --- the owner's commands ----------------------------------------------------------------------------

/**
 * Applies the owner's signed attestation, delegation or revocation: checks every BIP-322 signature
 * here, writes the public record into knowledge/orangecheck/ and commits it as the owner, pushed.
 * Publishing to Nostr follows on the hourly tick (or `pnpm brain orangecheck publish`).
 */
export function applyOrangecheck(cmd: OcCommand): { code: number; message: string } {
  const valid = validRecords();
  const writes: { rel: string; text: string }[] = [];
  let message: string;
  if (cmd.type === "orangecheck.authorize") {
    const b = buildAuthorization(cmd, publisherState().publisher, valid);
    if (!b.ok) return { code: 1, message: b.error };
    if (b.attestation)
      writes.push({
        rel: ocPath.attestation(b.attestation.attestation_id),
        text: envelopeFile(b.attestation),
      });
    if (b.delegation)
      writes.push({ rel: ocPath.delegation(b.delegation.id), text: envelopeFile(b.delegation) });
    message = [
      b.attestation ? `the owner's key ${cmd.owner} is attested for ${OC_DOMAIN}` : "",
      b.delegation
        ? `it delegates ${OC_SCOPE} to the publisher key until ${b.delegation.expires_at}`
        : "",
    ]
      .filter(Boolean)
      .join(", and ");
  } else {
    const b = buildRevocation(cmd, valid);
    if (!b.ok) return { code: 1, message: b.error };
    writes.push({ rel: ocPath.revocation(b.revocation.id), text: envelopeFile(b.revocation) });
    message = `the delegation ${cmd.delegationId.slice(0, 12)} is revoked as of ${cmd.signedAt}`;
  }
  for (const w of writes) {
    const abs = path.join(KNOWLEDGE, w.rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, w.text);
  }
  // The store must still check with the new records in it before anything is committed.
  const problems = checkRecords(loadStore(KNOWLEDGE).store.orangecheck ?? EMPTY_RECORDS).problems;
  if (problems.length) {
    for (const w of writes) rmSync(path.join(KNOWLEDGE, w.rel), { force: true });
    return { code: 1, message: `the record does not check: ${problems[0]}` };
  }
  const sentence = message.charAt(0).toUpperCase() + message.slice(1);
  commitAsOwner(
    writes.map((w) => path.relative(ROOT, path.join(KNOWLEDGE, w.rel))),
    `Record what the owner signed in their own wallet: ${message}. Every signature on the site chains to it.`,
    true,
  );
  feedEvent({
    kind: "publish",
    text:
      cmd.type === "orangecheck.authorize"
        ? "Recorded the owner's signed delegation to the publisher key"
        : "Recorded the owner's signed revocation of the publisher key's delegation",
    outcome: "ok",
  });
  return { code: 0, message: `${sentence}; recorded and pushed` };
}

// --- Nostr ---------------------------------------------------------------------------------------

/** Everything the store has to publish: the owner's records and each edition's stamp. */
export function publishables(store: Store): Publishable[] {
  const valid = validRecords(store);
  const out: Publishable[] = [
    ...valid.attestations.map((record) => ({ type: "attestation" as const, record })),
    ...valid.delegations.map((envelope) => ({ type: "delegation" as const, envelope })),
    ...valid.revocations.map((envelope) => ({ type: "revocation" as const, envelope })),
  ];
  for (const s of [...store.snapshots].sort((a, b) => a.manifest.n - b.manifest.n)) {
    const r = readEditionSignature(s.stamp ?? null, s.manifest, s.text, valid);
    if (r.signature?.ok && s.stamp)
      out.push({ type: "stamp", envelope: JSON.parse(s.stamp) as StampEnvelope });
  }
  return out;
}

/** A signed Nostr event for a record, under the brain's Nostr service key. */
export function signedEvent(
  p: Publishable,
  nostr: Publisher["nostr"],
  createdAt: number,
): NostrEvent {
  const t = nostrTemplate(p);
  const unsigned = { ...t, pubkey: nostr.pubkey, created_at: createdAt };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: hex(schnorr.sign(Buffer.from(id, "hex"), nostr.secret)) };
}

type PublishLog = Record<string, { event: string; relays: string[]; at: string }>;

const readLog = (file: string): PublishLog =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PublishLog) : {};

export interface PublishDeps {
  relays?: readonly string[];
  /** Sends one event to the relays; the real one is nostr-core's publishEvent. */
  send?: (e: NostrEvent, relays: readonly string[]) => Promise<PublishResult[]>;
  /** How many relays, each asked alone, serve back a copy whose envelope checks. */
  readBack?: (p: Publishable, relays: readonly string[]) => Promise<string[]>;
  log?: string;
  now?: () => Date;
  publisher?: Publisher;
}

/** Relays that serve back a copy of `p` whose content is the same record (each asked alone). */
async function readBackFromRelays(p: Publishable, relays: readonly string[]): Promise<string[]> {
  const id = publishableId(p);
  const answers = await Promise.all(
    relays.map(async (relay) => {
      const r = await queryEvents(nostrFilter(p), [relay], 4000);
      const held = r.events.some((e) => {
        try {
          const c = JSON.parse(e.content) as { id?: string; attestation_id?: string };
          return (c.attestation_id ?? c.id) === id;
        } catch {
          return false;
        }
      });
      return held ? relay : null;
    }),
  );
  return answers.filter((r): r is string => r !== null);
}

/**
 * Publishes every record not yet held by WRITE_QUORUM relays, and keeps a log in
 * var/orangecheck/published.json. Refuses to touch a public relay from a test run: tests pass
 * their own `send` and `readBack` and never reach the network.
 */
export async function publishPending(
  items: Publishable[],
  deps: PublishDeps = {},
): Promise<{ published: string[]; waiting: string[]; skipped: number }> {
  if (!deps.send && process.env.NODE_TEST_CONTEXT)
    throw new Error("refusing to publish to public relays from a test");
  const p = deps.publisher ?? requirePublisher();
  const relays = deps.relays ?? OC_RELAYS;
  const send = deps.send ?? ((e, r) => publishEvent(e, r, 8000));
  const readBack = deps.readBack ?? readBackFromRelays;
  const logFile = deps.log ?? PUBLISHED;
  const log = readLog(logFile);
  const published: string[] = [];
  const waiting: string[] = [];
  let skipped = 0;
  for (const item of items) {
    if (item.type === "stamp" && item.envelope.signer.address !== p.address) {
      skipped++;
      continue;
    }
    const d = nostrTemplate(item).tags[0]?.[1] ?? publishableId(item);
    if ((log[d]?.relays.length ?? 0) >= WRITE_QUORUM) {
      skipped++;
      continue;
    }
    const now = deps.now?.() ?? new Date();
    const event = signedEvent(item, p.nostr, Math.floor(now.getTime() / 1000));
    const results = await send(event, relays);
    const accepted = results.filter((r) => r.ok).map((r) => r.relay);
    const held = accepted.length ? await readBack(item, accepted) : [];
    log[d] = { event: event.id, relays: held, at: now.toISOString() };
    (held.length >= WRITE_QUORUM ? published : waiting).push(d);
    console.log(
      `nostr: ${d} kind ${event.kind}: ${accepted.length} of ${relays.length} relays took it, ${held.length} serve it back`,
    );
  }
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `${JSON.stringify(log, null, 2)}\n`);
  return { published, waiting, skipped };
}

/** The hourly tick's step: publish what is pending, or say why nothing was. */
export async function nostrStep(): Promise<string | undefined> {
  if (!publisherFrom()) return "no publisher key";
  const r = await publishPending(publishables(loadStore(KNOWLEDGE).store));
  if (r.published.length)
    feedEvent({
      kind: "publish",
      text: `Published ${r.published.length} signed record(s) on Nostr`,
      outcome: "ok",
    });
  return r.waiting.length ? `${r.waiting.length} record(s) not yet on two relays` : undefined;
}

// --- the CLI -------------------------------------------------------------------------------------

function status(): number {
  const { store } = loadStore(KNOWLEDGE);
  const p = publisherState();
  const raw = store.orangecheck ?? EMPTY_RECORDS;
  const { valid, problems } = checkRecords(raw);
  console.log(`publisher key  ${p.publisher ?? "none (pnpm brain orangecheck keygen)"}`);
  console.log(`nostr key      ${p.nostr ?? "none"}`);
  console.log(
    `records        ${valid.attestations.length} attestation(s), ${valid.delegations.length} delegation(s), ${valid.revocations.length} revocation(s)`,
  );
  for (const x of problems) console.log(`  problem: ${x}`);
  for (const s of [...store.snapshots].sort((a, b) => a.manifest.n - b.manifest.n)) {
    const r = readEditionSignature(s.stamp ?? null, s.manifest, s.text, valid);
    const sig = r.signature;
    console.log(
      `snapshot ${s.manifest.n}  ${
        !sig
          ? "unsigned"
          : `${sig.ok ? "signed" : `BAD (${sig.problem})`} by ${sig.signer} at ${sig.signedAt}${sig.backSigned ? " (after the edition)" : ""}; ${
              sig.authority.state === "delegated"
                ? `the owner ${sig.authority.owner} stands behind the key`
                : sig.authority.why
            }`
      }`,
    );
  }
  return problems.length ? 1 : 0;
}

export async function orangecheck(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const has = (f: string) => rest.includes(f);
  switch (sub) {
    case "keygen":
      return keygen();
    case "status":
      return status();
    case "backfill":
      return backfill({ commit: !has("--no-commit"), push: has("--push") });
    case "publish": {
      const items = publishables(loadStore(KNOWLEDGE).store);
      if (has("--dry-run")) {
        const p = requirePublisher();
        for (const it of items) {
          const e = signedEvent(it, p.nostr, Math.floor(Date.now() / 1000));
          console.log(`${e.kind}  ${e.tags[0]?.[1]}  (${e.content.length} bytes)`);
        }
        console.log(`dry run: ${items.length} event(s) for ${OC_RELAYS.join(", ")}; nothing sent`);
        return 0;
      }
      const r = await publishPending(items);
      console.log(
        `nostr: ${r.published.length} published, ${r.waiting.length} not yet on two relays, ${r.skipped} already there`,
      );
      return r.waiting.length ? 1 : 0;
    }
    default:
      console.error("usage: pnpm brain orangecheck <keygen | status | backfill | publish> ...");
      return 2;
  }
}
