import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verifyActionAsOfSignedAt,
  verifyDelegation,
  verifyRevocation,
} from "@orangecheck/agent-core";
import { addressFromPrivateKey, signMessage, verifySignature } from "@orangecheck/bip322";
import { isDnsIdentityVerified } from "@orangecheck/sdk/identity";
import { verify as verifyStampLib } from "@orangecheck/stamp-core";
import {
  type ActionEnvelope,
  actionDraft,
  actionEnvelope,
  attestationMessage,
  attestationRecord,
  authorityAt,
  buildAuthorization,
  buildRevocation,
  checkActionSignature,
  checkDelegation,
  checkRecords,
  checkRevocation,
  checkStamp,
  type DelegationEnvelope,
  delegationDraft,
  delegationEnvelope,
  delegationWindow,
  EMPTY_RECORDS,
  editionSignature,
  jsonContent,
  nostrTemplate,
  OC_IDENTITY,
  OC_SCOPE,
  OcAuthorizeCommand,
  type OcRecords,
  OwnerAddress,
  ocSignatureProblem,
  PastedSignature,
  revocationDraft,
  revocationEnvelope,
  type StampEnvelope,
  stampDraft,
  stampEnvelope,
  textContent,
  wellKnownText,
} from "../src/orangecheck.ts";

// Throwaway keys for tests only. Nothing they sign is ever written to knowledge/ or sent to a relay.
const OWNER_KEY = "11".repeat(32);
const PUBLISHER_KEY = "22".repeat(32);
const STRANGER_KEY = "33".repeat(32);
const OWNER = addressFromPrivateKey(OWNER_KEY, "p2tr");
const PUBLISHER = addressFromPrivateKey(PUBLISHER_KEY, "p2wpkh");
const STRANGER = addressFromPrivateKey(STRANGER_KEY, "p2wpkh");
const sign = (address: string, key: string, message: string) => signMessage(address, message, key);
const bip322 = async (m: string, s: string, a: string) => verifySignature(a, m, s);

// Vectors from oc-stamp-protocol/test-vectors/v12-sig-p2wpkh.json and
// oc-agent-protocol/test-vectors/v71 and v72 (a disclosed burn key), copied verbatim.
const BURN = "bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw";
const V12: StampEnvelope = {
  v: 1,
  kind: "stamp",
  id: "e1ca58382537aaa89d9b1603fd3840ba5b9869448e3c215220f38751d8429b36",
  content: {
    hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    length: 42,
    mime: "text/plain",
    ref: null,
  },
  signer: { address: BURN, alg: "bip322" },
  signed_at: "2026-04-24T18:30:00Z",
  stake: null,
  ots: null,
  sig: {
    alg: "bip322",
    pubkey: BURN,
    value:
      "AkcwRAIgfnLwtvqvs2J4Le/mmklLS61mqIeNuk+yGAWRpaAE828CIAiyMxEmplU/k8df/ugRLHDpGJN43MqX5tYK+gBxFq6AASEDG4TFVnsSZECZXT7VqroFZdceGDRgSBn/nBf16dXdB48=",
  },
};
const V71: DelegationEnvelope = {
  v: 1,
  kind: "agent-delegation",
  id: "be6f88b7d00bf88b60c9279e3df8abd40406c21daedd8a04afa9fca60620c18d",
  principal: { address: BURN, alg: "bip322" },
  agent: { address: BURN, alg: "bip322" },
  scopes: ["lock:seal(recipient=bc1qalice000000000000000000000000000000000)"],
  bond: null,
  issued_at: "2026-04-22T12:00:00Z",
  expires_at: "2026-04-29T12:00:00Z",
  nonce: "0123456789abcdef0123456789abcdef",
  revocation: { holders: ["principal"], ref: null },
  sig: {
    alg: "bip322",
    pubkey: BURN,
    value:
      "AkcwRAIhANxApf00gL86xomQYNHVGdsLLGi4S+FnKDrlPowlj91fAh8+xbdyPcuhbrvZN4XjmmsaZIligQ17qUHaBWuZnw1zASEDG4TFVnsSZECZXT7VqroFZdceGDRgSBn/nBf16dXdB48=",
  },
};
const V72: ActionEnvelope = {
  v: 1,
  kind: "agent-action",
  id: "0586993e91dd9fbc602c485f2c8b43a3ad0103df4f11e5a581fa77ac7af857f9",
  content: {
    hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    length: 1024,
    mime: "application/vnd.oc-lock+json",
    ref: null,
  },
  signer: { address: BURN, alg: "bip322" },
  signed_at: "2026-04-22T12:05:00Z",
  delegation_id: V71.id,
  scope_exercised: "lock:seal(recipient=bc1qalice000000000000000000000000000000000)",
  ots: null,
  sig: {
    alg: "bip322",
    pubkey: BURN,
    value:
      "AkcwRAIgT78h8O+gt3+XMC5YMJJZHc6sr7a2xF8YwAGkVy7JHasCIFQncZSEYBp2fEKgWKPOylegbGSd+jB7TmpYTm7aSkePASEDG4TFVnsSZECZXT7VqroFZdceGDRgSBn/nBf16dXdB48=",
  },
};

test("the spec's signed vectors check, and a flipped byte does not", () => {
  assert.deepEqual(checkStamp(V12), { ok: true });
  assert.deepEqual(checkDelegation(V71), { ok: true });
  assert.deepEqual(checkActionSignature(V72), { ok: true });
  const flipped = { ...V71, sig: { ...V71.sig, value: `B${V71.sig.value.slice(1)}` } };
  assert.equal(checkDelegation(flipped).ok, false);
  const moved = { ...V12, signed_at: "2026-04-24T18:30:01Z" };
  assert.deepEqual(checkStamp(moved), {
    ok: false,
    why: "the id does not match the signed fields",
  });
});

function publisherStamp(text: string, signedAt: string): StampEnvelope {
  const input = {
    address: PUBLISHER,
    content: textContent(text),
    mime: "application/json",
    signedAt,
  };
  return stampEnvelope(input, sign(PUBLISHER, PUBLISHER_KEY, stampDraft(input).id), null);
}

test("a stamp made from a signature over its id checks here and in stamp-core", async () => {
  const text = '{"n":1}\n';
  const env = publisherStamp(text, "2026-11-21T10:00:00Z");
  assert.equal(env.content.hash, textContent(text).hash);
  assert.deepEqual(checkStamp(env, textContent(text)), { ok: true });
  const lib = await verifyStampLib({
    envelope: env,
    content: new TextEncoder().encode(text),
    verifyBip322: bip322,
  });
  assert.equal(lib.ok, true);
  assert.deepEqual(checkStamp(env, textContent("other")), {
    ok: false,
    why: "the stamp covers other content",
  });
  const input = {
    address: PUBLISHER,
    content: textContent(text),
    mime: "application/json",
    signedAt: "2026-11-21T10:00:00Z",
  };
  assert.throws(
    () => stampEnvelope(input, sign(STRANGER, STRANGER_KEY, stampDraft(input).id), null),
    /does not verify/,
  );
});

test("JSON content is RFC 8785 text whatever the key order", () => {
  const a = jsonContent({ b: [2, 1], a: "x", c: { z: 1, y: true } });
  const b = jsonContent({ c: { y: true, z: 1 }, a: "x", b: [2, 1] });
  assert.equal(a.text, '{"a":"x","b":[2,1],"c":{"y":true,"z":1}}');
  assert.equal(a.hash, b.hash);
  assert.equal(a.length, a.text.length);
});

// --- the owner's side -----------------------------------------------------------------------------

const NONCE_A = "0123456789abcdef0123456789abcdef";
const NONCE_D = "fedcba9876543210fedcba9876543210";
const ISSUED = "2026-11-21T09:00:00Z";
const EXPIRES = "2027-11-21T09:00:00Z";

function ownerCommand(
  overrides: { attestKey?: string; delegateKey?: string; agent?: string } = {},
) {
  const message = attestationMessage(OWNER, NONCE_A, ISSUED);
  const draft = delegationDraft({
    principal: OWNER,
    agent: overrides.agent ?? PUBLISHER,
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    nonce: NONCE_D,
  });
  return OcAuthorizeCommand.parse({
    type: "orangecheck.authorize",
    owner: OWNER,
    agent: overrides.agent ?? PUBLISHER,
    attestation: {
      nonce: NONCE_A,
      issuedAt: ISSUED,
      sig: overrides.attestKey
        ? signMessage(STRANGER, message, overrides.attestKey)
        : signMessage(OWNER, message, OWNER_KEY),
    },
    delegation: {
      nonce: NONCE_D,
      issuedAt: ISSUED,
      expiresAt: EXPIRES,
      sig: overrides.delegateKey
        ? signMessage(STRANGER, draft.id, overrides.delegateKey)
        : signMessage(OWNER, draft.id, OWNER_KEY),
    },
  });
}

function authorized(): OcRecords {
  const b = buildAuthorization(ownerCommand(), PUBLISHER, EMPTY_RECORDS);
  assert.ok(b.ok, b.ok ? "" : b.error);
  return {
    attestations: b.attestation ? [b.attestation] : [],
    delegations: b.delegation ? [b.delegation] : [],
    revocations: [],
  };
}

test("the attestation is OrangeCheck's canonical message binding dns:blocklore.space", () => {
  const m = attestationMessage(OWNER, NONCE_A, ISSUED);
  assert.equal(
    m,
    `orangecheck\nidentities: ${OC_IDENTITY}\naddress: ${OWNER}\npurpose: portable reputation attestation (non-custodial)\nnonce: ${NONCE_A}\nissued_at: ${ISSUED}\nack: I attest control of this address and bind it to my identities.\n`,
  );
});

test("an authorize command with the owner's two signatures makes records that check", async () => {
  const r = authorized();
  assert.equal(r.attestations[0]?.address, OWNER);
  assert.deepEqual(r.delegations[0]?.scopes, [OC_SCOPE]);
  assert.deepEqual(checkRecords(r).problems, []);
  // The family's own verifier agrees, signature and all.
  const lib = await verifyDelegation({
    envelope: r.delegations[0] as DelegationEnvelope,
    verifyBip322: bip322,
    skipTemporalCheck: true,
    revocations: [],
  });
  assert.equal(lib.ok, true);
});

test("a wrong signature, a wrong agent or a missing attestation are refused in plain words", () => {
  const badA = buildAuthorization(
    ownerCommand({ attestKey: STRANGER_KEY }),
    PUBLISHER,
    EMPTY_RECORDS,
  );
  assert.equal(badA.ok, false);
  assert.match(badA.ok ? "" : badA.error, /attestation signature does not verify/);
  const badD = buildAuthorization(
    ownerCommand({ delegateKey: STRANGER_KEY }),
    PUBLISHER,
    EMPTY_RECORDS,
  );
  assert.match(badD.ok ? "" : badD.error, /Sign the delegation's id/);
  const other = buildAuthorization(ownerCommand({ agent: STRANGER }), PUBLISHER, EMPTY_RECORDS);
  assert.match(other.ok ? "" : other.error, /devbox's publisher key is/);
  const noKey = buildAuthorization(ownerCommand(), null, EMPTY_RECORDS);
  assert.match(noKey.ok ? "" : noKey.error, /no publisher key/);
  const onlyD = buildAuthorization(
    { ...ownerCommand(), attestation: null },
    PUBLISHER,
    EMPTY_RECORDS,
  );
  assert.match(onlyD.ok ? "" : onlyD.error, /no attestation/);
  // With the attestation already on record, a delegation alone is enough (a renewal).
  const renewal = buildAuthorization(
    { ...ownerCommand(), attestation: null },
    PUBLISHER,
    authorized(),
  );
  assert.equal(renewal.ok, true);
});

test("the site's quick check names the failing signature, and a dropped final line break", () => {
  assert.equal(ocSignatureProblem(ownerCommand()), null);
  assert.match(
    ocSignatureProblem(ownerCommand({ delegateKey: STRANGER_KEY })) ?? "",
    /delegation signature/,
  );
  assert.match(
    ocSignatureProblem(ownerCommand({ attestKey: STRANGER_KEY })) ?? "",
    /attestation signature/,
  );
  const message = attestationMessage(OWNER, NONCE_A, ISSUED);
  const trimmed = {
    ...ownerCommand(),
    attestation: {
      nonce: NONCE_A,
      issuedAt: ISSUED,
      sig: signMessage(OWNER, message.trimEnd(), OWNER_KEY),
    },
  };
  assert.match(ocSignatureProblem(trimmed) ?? "", /without its final line break/);
});

test("owner addresses are mainnet single-key addresses; pasted signatures lose their whitespace", () => {
  assert.equal(OwnerAddress.safeParse(OWNER.toUpperCase()).data, OWNER);
  assert.equal(OwnerAddress.safeParse("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").success, false);
  assert.equal(OwnerAddress.safeParse("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy").success, false);
  const s = signMessage(OWNER, "x", OWNER_KEY);
  assert.equal(PastedSignature.parse(` ${s.slice(0, 20)}\n${s.slice(20)} `), s);
});

// --- authority ----------------------------------------------------------------------------------

test("a stamp is the owner's only while a delegation to its key is in force", () => {
  const r = authorized();
  const valid = checkRecords(r).valid;
  const at = (t: string) => authorityAt(valid, PUBLISHER, t, "application/json");
  assert.deepEqual(authorityAt(EMPTY_RECORDS, PUBLISHER, ISSUED, "application/json"), {
    state: "alone",
    why: "The owner has not delegated this key yet.",
  });
  const inside = at("2026-12-01T00:00:00Z");
  assert.equal(inside.state, "delegated");
  assert.equal(inside.state === "delegated" && inside.owner, OWNER);
  assert.match(
    (at("2026-11-21T08:59:59Z") as { why: string }).why,
    /before the owner's delegation/,
  );
  assert.match((at(EXPIRES) as { why: string }).why, /after the owner's delegation ended/);
  assert.equal(
    authorityAt(valid, STRANGER, "2026-12-01T00:00:00Z", "application/json").state,
    "alone",
  );
  assert.match(
    (authorityAt(valid, PUBLISHER, "2026-12-01T00:00:00Z", "text/plain") as { why: string }).why,
    /does not cover text\/plain/,
  );
});

test("a revocation by the owner or by the publisher key ends the delegation from its time on", async () => {
  const r = authorized();
  const d = r.delegations[0] as DelegationEnvelope;
  for (const [who, key] of [
    [OWNER, OWNER_KEY],
    [PUBLISHER, PUBLISHER_KEY],
  ] as const) {
    const input = {
      signer: who,
      delegationId: d.id,
      reason: "rotate",
      signedAt: "2027-01-01T00:00:00Z",
    };
    const cmd = {
      type: "orangecheck.revoke" as const,
      delegationId: d.id,
      signer: who,
      reason: "rotate",
      signedAt: input.signedAt,
      sig: signMessage(who, revocationDraft(input).id, key),
    };
    const b = buildRevocation(cmd, checkRecords(r).valid);
    assert.ok(b.ok, b.ok ? "" : b.error);
    const lib = await verifyRevocation({
      envelope: b.revocation,
      delegation: d,
      verifyBip322: bip322,
    });
    assert.equal(lib.ok, true);
    const valid = checkRecords({ ...r, revocations: [b.revocation] }).valid;
    assert.equal(
      authorityAt(valid, PUBLISHER, "2026-12-31T23:59:59Z", "application/json").state,
      "delegated",
    );
    assert.match(
      (authorityAt(valid, PUBLISHER, "2027-01-01T00:00:00Z", "application/json") as { why: string })
        .why,
      /revoked/,
    );
    const again = buildRevocation({ ...cmd, signedAt: "2027-02-01T00:00:00Z" }, valid);
    assert.match(again.ok ? "" : again.error, /already revoked at 2027-01-01T00:00:00Z/);
  }
  const input = {
    signer: STRANGER,
    delegationId: d.id,
    reason: "",
    signedAt: "2027-01-01T00:00:00Z",
  };
  const stranger = revocationEnvelope(
    input,
    signMessage(STRANGER, revocationDraft(input).id, STRANGER_KEY),
  );
  assert.deepEqual(checkRevocation(stranger, d), {
    ok: false,
    why: "only the delegation's principal or agent may revoke it",
  });
  assert.equal(checkRecords({ ...r, revocations: [stranger] }).problems.length, 1);
});

test("an edition's signature says whether it was signed later and who stands behind it", () => {
  const text = '{"n":1}\n';
  const env = publisherStamp(text, "2026-12-01T00:00:00Z");
  const valid = checkRecords(authorized()).valid;
  const later = editionSignature(env, "1.json.stamp", text, "2026-11-20T18:50:11Z", valid);
  assert.equal(later.ok, true);
  assert.equal(later.backSigned, true);
  assert.equal(later.authority.state, "delegated");
  const fresh = editionSignature(env, "1.json.stamp", text, "2026-11-30T23:59:00Z", EMPTY_RECORDS);
  assert.equal(fresh.backSigned, false);
  assert.equal(fresh.authority.state, "alone");
  const wrong = editionSignature(env, "1.json.stamp", "{}\n", "2026-12-01T00:00:00Z", valid);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.problem, "the stamp covers other content");
});

test("an action under the delegation checks here and in agent-core's audit", async () => {
  const valid = checkRecords(authorized()).valid;
  const d = valid.delegations[0] as DelegationEnvelope;
  const c = jsonContent({ claim: "x.y", decision: "publish" });
  const input = {
    address: PUBLISHER,
    content: c,
    mime: "application/json",
    signedAt: "2026-12-01T00:00:00Z",
    delegationId: d.id,
    scope: OC_SCOPE,
  };
  const a = actionEnvelope(
    input,
    signMessage(PUBLISHER, actionDraft(input).id, PUBLISHER_KEY),
    null,
  );
  assert.deepEqual(checkActionSignature(a), { ok: true });
  const lib = await verifyActionAsOfSignedAt({
    action: a,
    delegation: d,
    verifyBip322: bip322,
    revocations: [],
    content: new TextEncoder().encode(c.text),
  });
  assert.equal(lib.ok, true, lib.ok ? "" : lib.message);
});

test("the well-known file names the attestation the way OrangeCheck's SDK reads it", () => {
  assert.equal(wellKnownText(EMPTY_RECORDS, "https://blocklore.space"), null);
  const valid = checkRecords(authorized()).valid;
  const text = wellKnownText(valid, "https://blocklore.space") ?? "";
  const id = valid.attestations[0]?.attestation_id ?? "";
  assert.ok(text.includes(`Attestation ID: ${id}`));
  assert.equal(isDnsIdentityVerified(id, "blocklore.space", text), true);
  assert.equal(isDnsIdentityVerified(id, "example.com", text), false);
  assert.ok(text.includes(`to ${PUBLISHER}, scope ${OC_SCOPE}`));
});

test("Nostr events carry the kinds and tags each spec assigns", () => {
  const r = authorized();
  const a = r.attestations[0];
  const d = r.delegations[0];
  assert.ok(a && d);
  const env = publisherStamp("{}", ISSUED);
  const s = nostrTemplate({ type: "stamp", envelope: env });
  assert.equal(s.kind, 30083);
  assert.deepEqual(s.tags[0], ["d", `oc-stamp:${env.id}`]);
  assert.deepEqual(JSON.parse(s.content), env);
  const de = nostrTemplate({ type: "delegation", envelope: d });
  assert.equal(de.kind, 30083);
  assert.deepEqual(de.tags.slice(0, 3), [
    ["d", `oc-agent-del:${d.id}`],
    ["t", OWNER],
    ["t", PUBLISHER],
  ]);
  const at = nostrTemplate({ type: "attestation", record: a });
  assert.equal(at.kind, 30078);
  assert.deepEqual(at.tags[0], ["d", a.attestation_id]);
  assert.ok(at.tags.some((t) => t[0] === "i" && t[1] === OC_IDENTITY));
  const input = { signer: OWNER, delegationId: d.id, reason: "", signedAt: "2027-01-01T00:00:00Z" };
  const rev = revocationEnvelope(input, signMessage(OWNER, revocationDraft(input).id, OWNER_KEY));
  const re = nostrTemplate({ type: "revocation", envelope: rev });
  assert.equal(re.kind, 30085);
  assert.deepEqual(re.tags[1], ["t", d.id]);
});

test("the delegation window starts at the key's first signature when that is recent", () => {
  const now = new Date("2026-11-25T12:00:00.500Z");
  assert.deepEqual(delegationWindow(now, null), {
    issuedAt: "2026-11-25T12:00:00Z",
    expiresAt: "2026-11-25T12:00:00Z".replace("2026", "2027"),
  });
  assert.equal(delegationWindow(now, "2026-11-21T10:00:00Z").issuedAt, "2026-11-21T10:00:00Z");
  assert.equal(delegationWindow(now, "2025-11-21T10:00:00Z").issuedAt, "2026-11-25T12:00:00Z");
  assert.equal(delegationWindow(now, "2026-12-21T10:00:00Z").issuedAt, "2026-11-25T12:00:00Z");
  const d = delegationEnvelope(
    { principal: OWNER, agent: PUBLISHER, nonce: NONCE_D, ...delegationWindow(now, null) },
    "x",
  );
  assert.equal(checkDelegation(d).ok, false);
  assert.equal(
    (checkDelegation(d) as { why: string }).why,
    "the BIP-322 signature does not verify",
  );
});

test("records from a file shape check before their signatures do", () => {
  const rec = attestationRecord(attestationMessage(OWNER, NONCE_A, ISSUED), "AAAA");
  const { problems } = checkRecords({ ...EMPTY_RECORDS, attestations: [rec] });
  assert.match(problems[0] ?? "", /does not verify/);
});
