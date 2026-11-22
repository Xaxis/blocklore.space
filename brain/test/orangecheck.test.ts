import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  attestationMessage,
  buildAuthorization,
  delegationDraft,
  EMPTY_RECORDS,
  OC_RELAYS,
  OcAuthorizeCommand,
  type OcRecords,
  revocationDraft,
  revocationEnvelope,
  textContent,
} from "@blocklore/core";
import { addressFromPrivateKey, signMessage, verifySignature } from "@orangecheck/bip322";
import { DEFAULT_RELAYS, verifyEvent } from "@orangecheck/nostr-core";
import { roleCredential, roleEnv } from "../src/agent.ts";
import {
  keygen,
  PUBLISHER_KEY_VAR,
  publisherFrom,
  publishPending,
  signedEvent,
  stampJson,
  stampSnapshotText,
  verifyStampedJson,
} from "../src/orangecheck.ts";

// Throwaway keys for tests only: nothing they sign is written to knowledge/ or sent to a relay.
const PUBLISHER_KEY = "22".repeat(32);
const OWNER_KEY = "11".repeat(32);
const OWNER = addressFromPrivateKey(OWNER_KEY, "p2wpkh");
const maybe = publisherFrom({ [PUBLISHER_KEY_VAR]: PUBLISHER_KEY });
assert.ok(maybe);
const publisher = maybe;

function delegated(): OcRecords {
  const nonceA = "0123456789abcdef0123456789abcdef";
  const nonceD = "fedcba9876543210fedcba9876543210";
  const issuedAt = "2026-11-21T00:00:00Z";
  const expiresAt = "2027-11-21T00:00:00Z";
  const d = delegationDraft({
    principal: OWNER,
    agent: publisher.address,
    issuedAt,
    expiresAt,
    nonce: nonceD,
  });
  const b = buildAuthorization(
    OcAuthorizeCommand.parse({
      type: "orangecheck.authorize",
      owner: OWNER,
      agent: publisher.address,
      attestation: {
        nonce: nonceA,
        issuedAt,
        sig: signMessage(OWNER, attestationMessage(OWNER, nonceA, issuedAt), OWNER_KEY),
      },
      delegation: { nonce: nonceD, issuedAt, expiresAt, sig: signMessage(OWNER, d.id, OWNER_KEY) },
    }),
    publisher.address,
    EMPTY_RECORDS,
  );
  assert.ok(b.ok && b.attestation && b.delegation);
  return { attestations: [b.attestation], delegations: [b.delegation], revocations: [] };
}

test("the publisher key signs as a P2WPKH address and is read only from the environment", () => {
  assert.match(publisher.address, /^bc1q/);
  assert.ok(verifySignature(publisher.address, "abc", publisher.sign("abc")));
  assert.equal(publisher.sign("abc"), publisher.sign("abc"), "deterministic signatures");
  assert.match(publisher.nostr.pubkey, /^[0-9a-f]{64}$/);
  assert.equal(publisherFrom({}), null);
  assert.throws(() => publisherFrom({ [PUBLISHER_KEY_VAR]: "not hex" }), /64 lowercase hex/);
});

test("keygen writes .env at mode 600, never prints the key, and refuses to replace it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "blocklore-keygen-"));
  const env = path.join(dir, ".env");
  writeFileSync(env, `OWNER_EMAIL=x@example.org\n${PUBLISHER_KEY_VAR}=\n`);
  const printed: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => printed.push(a.join(" "));
  console.error = (...a: unknown[]) => printed.push(a.join(" "));
  const saved = process.env[PUBLISHER_KEY_VAR];
  delete process.env[PUBLISHER_KEY_VAR];
  try {
    assert.equal(keygen(env), 0);
    const text = readFileSync(env, "utf8");
    const key = new RegExp(`^${PUBLISHER_KEY_VAR}=([0-9a-f]{64})$`, "m").exec(text)?.[1];
    assert.ok(key, "the key is in .env");
    assert.ok(text.startsWith("OWNER_EMAIL=x@example.org\n"), "other lines kept");
    assert.equal(
      text.match(new RegExp(PUBLISHER_KEY_VAR, "g"))?.length,
      1,
      "the empty line filled",
    );
    assert.equal(statSync(env).mode & 0o777, 0o600);
    assert.ok(!printed.join("\n").includes(key), "the key is never printed");
    const address = publisherFrom({ [PUBLISHER_KEY_VAR]: key })?.address ?? "";
    assert.ok(printed.join("\n").includes(address), "its address is");
    assert.equal(keygen(env), 1);
    assert.equal(readFileSync(env, "utf8"), text, "a second keygen changes nothing");
  } finally {
    console.log = log;
    console.error = err;
    if (saved !== undefined) process.env[PUBLISHER_KEY_VAR] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a model role's environment never carries the publisher key", () => {
  const saved = process.env[PUBLISHER_KEY_VAR];
  process.env[PUBLISHER_KEY_VAR] = PUBLISHER_KEY;
  try {
    const env = roleEnv(
      roleCredential({ ...process.env, CLAUDE_CODE_OAUTH_TOKEN: "subscription-token" }),
    );
    assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "LANG", "PATH"]);
    assert.ok(!Object.values(env).includes(PUBLISHER_KEY));
  } finally {
    if (saved === undefined) delete process.env[PUBLISHER_KEY_VAR];
    else process.env[PUBLISHER_KEY_VAR] = saved;
  }
});

test("a snapshot stamp covers the file's exact bytes and points at its public copy", () => {
  const text = '{\n  "n": 1\n}\n';
  const env = stampSnapshotText(1, text, publisher, new Date("2026-11-21T12:00:00.250Z"));
  assert.equal(env.signed_at, "2026-11-21T12:00:00Z");
  assert.equal(env.content.hash, textContent(text).hash);
  assert.equal(env.content.ref, "https://blocklore.space/snapshots/1.json");
});

test("stampJson signs alone before the delegation, as an agent action while it is in force", () => {
  const decision = { claim: "taproot.activation-height", decision: "publish", why: "checks pass" };
  const alone = stampJson(decision, {
    publisher,
    records: EMPTY_RECORDS,
    at: new Date("2026-11-21T12:00:00Z"),
  });
  assert.equal(alone.envelope.kind, "stamp");
  assert.equal(alone.authority.state, "alone");
  const records = delegated();
  const r = stampJson(decision, { publisher, records, at: new Date("2026-12-01T00:00:00Z") });
  assert.equal(r.envelope.kind, "agent-action");
  assert.equal(
    r.envelope.kind === "agent-action" && r.envelope.delegation_id,
    records.delegations[0]?.id,
  );
  assert.equal(
    r.content,
    '{"claim":"taproot.activation-height","decision":"publish","why":"checks pass"}',
  );
  const ok = verifyStampedJson({ ...decision }, r.envelope, records);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.kind, "action");
  assert.deepEqual(verifyStampedJson({ ...decision, decision: "hold" }, r.envelope, records), {
    ok: false,
    why: "the envelope covers other content",
  });
  assert.equal(verifyStampedJson(decision, alone.envelope, EMPTY_RECORDS).ok, true);
});

test("after a revocation stampJson signs alone again, and earlier actions still check", () => {
  const records = delegated();
  const d = records.delegations[0];
  assert.ok(d);
  const before = stampJson({ a: 1 }, { publisher, records, at: new Date("2026-12-01T00:00:00Z") });
  const input = {
    signer: OWNER,
    delegationId: d.id,
    reason: "owner veto",
    signedAt: "2027-01-01T00:00:00Z",
  };
  const revoked: OcRecords = {
    ...records,
    revocations: [
      revocationEnvelope(input, signMessage(OWNER, revocationDraft(input).id, OWNER_KEY)),
    ],
  };
  const after = stampJson(
    { a: 1 },
    { publisher, records: revoked, at: new Date("2027-01-02T00:00:00Z") },
  );
  assert.equal(after.envelope.kind, "stamp");
  assert.match(after.authority.state === "alone" ? after.authority.why : "", /revoked/);
  assert.equal(verifyStampedJson({ a: 1 }, before.envelope, revoked).ok, true);
});

test("Nostr events are signed by the derived key and verify under NIP-01", () => {
  const records = delegated();
  const env = stampSnapshotText(1, "{}\n", publisher, new Date("2026-11-21T12:00:00Z"));
  for (const item of [
    { type: "stamp" as const, envelope: env },
    { type: "delegation" as const, envelope: records.delegations[0] as never },
    { type: "attestation" as const, record: records.attestations[0] as never },
  ]) {
    const e = signedEvent(item, publisher.nostr, 1_800_000_000);
    assert.ok(verifyEvent(e), `${item.type} verifies`);
    assert.equal(e.pubkey, publisher.nostr.pubkey);
  }
});

test("Blocklore's relays are the family's defaults", () => {
  assert.deepEqual([...OC_RELAYS].sort(), [...DEFAULT_RELAYS].sort());
});

test("publishing counts a record once two relays serve it back, and never runs from a test by default", async () => {
  await assert.rejects(publishPending([], { publisher }), /from a test/);
  const dir = mkdtempSync(path.join(tmpdir(), "blocklore-nostr-"));
  const log = path.join(dir, "published.json");
  const env = stampSnapshotText(1, "{}\n", publisher, new Date("2026-11-21T12:00:00Z"));
  const items = [{ type: "stamp" as const, envelope: env }];
  const sent: string[] = [];
  const relays = ["ws://relay-a.invalid", "ws://relay-b.invalid", "ws://relay-c.invalid"];
  let serving = 1;
  const deps = {
    publisher,
    relays,
    log,
    now: () => new Date("2026-11-21T13:00:00Z"),
    send: async (e: { id: string }, rs: readonly string[]) => {
      sent.push(e.id);
      return rs.map((relay) => ({ relay, ok: true, attempts: 1 }));
    },
    readBack: async (_p: unknown, rs: readonly string[]) => rs.slice(0, serving),
  };
  const silent = console.log;
  console.log = () => {};
  try {
    const first = await publishPending(items, deps);
    assert.equal(first.waiting.length, 1, "one relay serving it back is not enough");
    serving = 2;
    const second = await publishPending(items, deps);
    assert.deepEqual(second.published, [`oc-stamp:${env.id}`]);
    const third = await publishPending(items, deps);
    assert.equal(third.skipped, 1);
    assert.equal(sent.length, 2, "a record two relays hold is not sent again");
    const stranger = stampSnapshotText(
      1,
      "{}\n",
      publisherFrom({ [PUBLISHER_KEY_VAR]: "33".repeat(32) }) ?? publisher,
      new Date("2026-11-21T12:00:00Z"),
    );
    const other = await publishPending([{ type: "stamp", envelope: stranger }], deps);
    assert.equal(other.skipped, 1, "a stamp by another key is never published under ours");
  } finally {
    console.log = silent;
    rmSync(dir, { recursive: true, force: true });
  }
});
