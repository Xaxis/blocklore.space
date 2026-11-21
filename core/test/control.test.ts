import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPatch,
  COMMAND_TTL_MS,
  candidateHash,
  DEFAULT_SETTINGS,
  type Envelope,
  signCommand,
  verifyEnvelope,
} from "../src/control.ts";

const KEY = "k".repeat(48);
const NOW = new Date("2026-11-21T12:00:00Z");
const body = {
  id: "0f6c1e7a-1111-4a2b-9c3d-123456789abc",
  at: "2026-11-21T11:59:00.000Z",
  by: "owner@example.com",
  cmd: { type: "ping" as const },
};
const never = () => false;

test("a signed command verifies, and any change to it does not", () => {
  const e = signCommand(KEY, body);
  assert.equal(verifyEnvelope(KEY, e, NOW, never).ok, true);
  const tampered: Envelope = {
    ...e,
    cmd: { type: "tick", tick: "daily" },
  };
  assert.deepEqual(verifyEnvelope(KEY, tampered, NOW, never), {
    ok: false,
    why: "bad signature",
    id: body.id,
  });
  assert.equal(verifyEnvelope("x".repeat(48), e, NOW, never).ok, false);
  assert.equal(verifyEnvelope(KEY, { ...e, by: "someone@example.com" }, NOW, never).ok, false);
});

test("a command expires, is applied once, and must be well formed", () => {
  const e = signCommand(KEY, body);
  const late = new Date(Date.parse(body.at) + COMMAND_TTL_MS + 1000);
  assert.equal((verifyEnvelope(KEY, e, late, never) as { why: string }).why, "expired");
  assert.equal(
    (verifyEnvelope(KEY, e, NOW, (id) => id === body.id) as { why: string }).why,
    "already applied",
  );
  const bogus = signCommand(KEY, { ...body, cmd: { type: "ping" } });
  assert.equal(
    (
      verifyEnvelope(KEY, { ...bogus, cmd: { type: "shell", run: "rm -rf /" } }, NOW, never) as {
        why: string;
      }
    ).why,
    "malformed command",
  );
  assert.throws(() => signCommand("short", body));
  assert.equal(
    (verifyEnvelope("short", e, NOW, never) as { why: string }).why,
    "no control key on the devbox",
  );
});

test("approvals name each claim with the hash of what the owner saw", () => {
  const approve = signCommand(KEY, {
    ...body,
    cmd: { type: "review.approve", items: [{ id: "covenants.ctv-bip119", hash: "a".repeat(64) }] },
  });
  assert.equal(verifyEnvelope(KEY, approve, NOW, never).ok, true);
  const noHash = { ...approve, cmd: { type: "review.approve", items: [{ id: "x" }] } };
  assert.equal(verifyEnvelope(KEY, noHash, NOW, never).ok, false);
  assert.equal(candidateHash({ b: 1, a: 2 }), candidateHash({ a: 2, b: 1 }));
  assert.notEqual(candidateHash({ a: 1 }), candidateHash({ a: 2 }));
});

test("a settings patch changes only what it names and stays within bounds", () => {
  const s = applyPatch(DEFAULT_SETTINGS, {
    research: { mode: "continuous" },
    budget: { dailyUsd: 40 },
  });
  assert.equal(s.research.mode, "continuous");
  assert.equal(s.research.model, DEFAULT_SETTINGS.research.model);
  assert.equal(s.budget.dailyUsd, 40);
  assert.equal(s.budget.perRunUsd, DEFAULT_SETTINGS.budget.perRunUsd);
  assert.throws(() => applyPatch(DEFAULT_SETTINGS, { budget: { dailyUsd: -1 } }));
  assert.equal(applyPatch(DEFAULT_SETTINGS, { focus: "  segwit  " }).focus, "segwit");
  assert.throws(() => applyPatch(DEFAULT_SETTINGS, { focus: `bell${String.fromCharCode(7)}` }));
});

test("a sign-in link request verifies only with the key, and only for five minutes", async () => {
  const { signLinkRequest, verifyLinkRequest } = await import("../src/control.ts");
  const r = signLinkRequest(KEY, "2026-11-21T11:58:00.000Z", "a".repeat(32));
  assert.equal(verifyLinkRequest(KEY, r, NOW), true);
  assert.equal(verifyLinkRequest("z".repeat(48), r, NOW), false);
  assert.equal(verifyLinkRequest(KEY, { ...r, nonce: "b".repeat(32) }, NOW), false);
  assert.equal(verifyLinkRequest(KEY, r, new Date("2026-11-21T12:04:00Z")), false);
});
