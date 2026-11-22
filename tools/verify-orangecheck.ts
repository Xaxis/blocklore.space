// Checks who signed a Blocklore snapshot, from a clone of the repository, with OrangeCheck's own
// libraries only (none of Blocklore's code decides anything here):
//   1. the snapshot's OC Stamp verifies (BIP-322 over its id) and covers the snapshot file's bytes;
//   2. every record the owner signed checks: attestations (canonical message, id, BIP-322 signature,
//      binding dns:blocklore.space), delegations and revocations (OC Agent);
//   3. the domain proof: https://blocklore.space/.well-known/orangecheck.txt names the attestation
//      (skipped with --offline);
//   4. the chain: whether a delegation from an attested owner to the stamp's key, granting JSON
//      signing, was in force at the stamp's time and not yet revoked. Without one the key signed
//      alone, which is reported, not failed.
//
//   pnpm verify:orangecheck [n] [--offline] [--knowledge <dir>]     n defaults to the newest snapshot
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type DelegationEnvelope,
  isSubScope,
  parseScope,
  type RevocationEnvelope,
  verifyDelegation,
  verifyRevocation,
} from "@orangecheck/agent-core";
import { verifySignature } from "@orangecheck/bip322";
import { isCanonicalAttestation } from "@orangecheck/sdk/canonical";
import { isDnsIdentityVerified } from "@orangecheck/sdk/identity";
import { parseStamp, verify as verifyStamp } from "@orangecheck/stamp-core";

const DOMAIN = "blocklore.space";
const IDENTITY = `dns:${DOMAIN}`;
const SCOPE = "stamp:sign(mime=application/json)";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const offline = args.includes("--offline");
const KNOWLEDGE = path.resolve(
  flag("--knowledge") ?? path.join(import.meta.dirname, "..", "knowledge"),
);
const SNAPSHOTS = path.join(KNOWLEDGE, "snapshots");
const RECORDS = path.join(KNOWLEDGE, "orangecheck");

let failed = false;
const ok = (what: string) => console.log(`  ok    ${what}`);
const bad = (what: string) => {
  failed = true;
  console.log(`  FAIL  ${what}`);
};
const note = (what: string) => console.log(`  note  ${what}`);
const bip322 = async (message: string, signature: string, address: string) =>
  verifySignature(address, message, signature);
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const numbers = existsSync(SNAPSHOTS)
  ? readdirSync(SNAPSHOTS)
      .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number)
      .sort((a, b) => a - b)
  : [];
const positional = args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== "--knowledge");
const n = positional ? Number(positional) : numbers.at(-1);
if (!n || !numbers.includes(n)) {
  console.error(`verify:orangecheck: no snapshot ${n ?? ""} in ${SNAPSHOTS}`);
  process.exit(2);
}

console.log(`Snapshot ${n}: its signature`);
const stampFile = path.join(SNAPSHOTS, `${n}.json.stamp`);
if (!existsSync(stampFile)) {
  console.log(`  FAIL  snapshot ${n} is not signed (no ${n}.json.stamp)`);
  process.exit(1);
}
const stamp = parseStamp(readFileSync(stampFile, "utf8"));
const content = readFileSync(path.join(SNAPSHOTS, `${n}.json`));
const s = await verifyStamp({
  envelope: stamp,
  content: new Uint8Array(content),
  verifyBip322: bip322,
});
if (s.ok)
  ok(
    `the stamp ${stamp.id.slice(0, 16)} is signed by ${stamp.signer.address} at ${stamp.signed_at} over the file's ${content.length} bytes`,
  );
else bad(`the stamp does not verify: ${s.message}`);

const read = <T>(kind: string): T[] => {
  const dir = path.join(RECORDS, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as T);
};

interface Attestation {
  attestation_id: string;
  address: string;
  message: string;
  signature: string;
  issued_at: string;
}

console.log("The owner's records");
const attested = new Map<string, Attestation>();
for (const a of read<Attestation>("attestations")) {
  const lines = a.message.split("\n");
  const ids =
    lines
      .find((l) => l.startsWith("identities: "))
      ?.slice(12)
      .split(",") ?? [];
  const what = `attestation ${a.attestation_id.slice(0, 16)} by ${a.address}`;
  if (!isCanonicalAttestation(a.message)) bad(`${what}: the message is not canonical`);
  else if (sha256(a.message) !== a.attestation_id)
    bad(`${what}: the id is not the message's SHA-256`);
  else if (lines.find((l) => l.startsWith("address: "))?.slice(9) !== a.address)
    bad(`${what}: the address is not the signed one`);
  else if (!ids.includes(IDENTITY)) bad(`${what}: it does not bind ${IDENTITY}`);
  else if (!verifySignature(a.address, a.message, a.signature))
    bad(`${what}: the BIP-322 signature does not verify`);
  else {
    ok(`${what} binds ${IDENTITY}, signed ${a.issued_at}`);
    attested.set(a.address, a);
  }
}

const delegations: DelegationEnvelope[] = [];
for (const d of read<DelegationEnvelope>("delegations")) {
  const r = await verifyDelegation({
    envelope: d,
    verifyBip322: bip322,
    skipTemporalCheck: true,
    revocations: [],
  });
  const what = `delegation ${d.id.slice(0, 16)} from ${d.principal.address} to ${d.agent.address}`;
  if (r.ok) {
    ok(`${what}, ${d.issued_at} to ${d.expires_at}, scopes ${(d.scopes ?? []).join(", ")}`);
    delegations.push(d);
  } else bad(`${what}: ${r.message}`);
}

const revocations: RevocationEnvelope[] = [];
for (const v of read<RevocationEnvelope>("revocations")) {
  const d = delegations.find((x) => x.id === v.delegation_id);
  const what = `revocation ${v.id.slice(0, 16)} of ${v.delegation_id.slice(0, 16)} by ${v.signer.address}`;
  if (!d) {
    bad(`${what}: it names no delegation that checks`);
    continue;
  }
  const r = await verifyRevocation({ envelope: v, delegation: d, verifyBip322: bip322 });
  if (r.ok) {
    ok(`${what} at ${v.signed_at}`);
    revocations.push(v);
  } else bad(`${what}: ${r.message}`);
}
if (!attested.size && !delegations.length && !revocations.length)
  note("the owner has not signed any record yet");

if (attested.size) {
  console.log("The domain proof");
  if (offline) note("skipped (--offline)");
  else {
    const url = `https://${DOMAIN}/.well-known/orangecheck.txt`;
    const res = await fetch(url).catch(() => null);
    const text = res?.ok ? await res.text() : null;
    const named = [...attested.values()].filter(
      (a) => text && isDnsIdentityVerified(a.attestation_id, DOMAIN, text),
    );
    if (named.length) ok(`${url} names attestation ${named[0]?.attestation_id.slice(0, 16)}`);
    else bad(`${url} ${text ? "names none of the attestations" : "did not answer"}`);
  }
}

console.log("The chain of authority");
const grants = (d: DelegationEnvelope) =>
  (d.scopes ?? []).some((g) => {
    try {
      return isSubScope(parseScope(SCOPE), parseScope(g));
    } catch {
      return false;
    }
  });
const t = Date.parse(stamp.signed_at);
const why: string[] = [];
let owner: string | null = null;
for (const d of delegations.filter((x) => x.agent.address === stamp.signer.address)) {
  const rev = revocations
    .filter((v) => v.delegation_id === d.id)
    .sort((a, b) => Date.parse(a.signed_at) - Date.parse(b.signed_at))[0];
  if (!grants(d)) why.push(`delegation ${d.id.slice(0, 16)} does not grant ${SCOPE}`);
  else if (t < Date.parse(d.issued_at) || t >= Date.parse(d.expires_at))
    why.push(`the stamp's time is outside delegation ${d.id.slice(0, 16)}`);
  else if (rev && Date.parse(rev.signed_at) <= t)
    why.push(`delegation ${d.id.slice(0, 16)} was revoked at ${rev.signed_at}`);
  else if (!attested.has(d.principal.address))
    why.push(`${d.principal.address} has no attestation for ${IDENTITY}`);
  else {
    owner = d.principal.address;
    ok(
      `the owner ${owner} (attested for ${IDENTITY}) had delegated to ${stamp.signer.address} at ${stamp.signed_at} (delegation ${d.id.slice(0, 16)})`,
    );
    break;
  }
}
if (!owner)
  note(
    `${stamp.signer.address} signed alone: ${why[0] ?? "no delegation from the owner names this key"}`,
  );

console.log(failed ? "verify:orangecheck FAILED" : `verify:orangecheck ok: snapshot ${n}`);
process.exit(failed ? 1 : 0);
