import assert from "node:assert/strict";
import { test } from "node:test";
import { Command, Sealed, SUBSCRIPTION_TOKEN } from "../src/control.ts";
import { open, seal } from "../src/node/seal.ts";

const KEY = "k".repeat(40);
const TOKEN = `sk-ant-oat01-${"a1B2_c3-".repeat(12)}`;

test("a sealed token opens with the same CONTROL_KEY and holds no trace of the token", () => {
  const s = seal(KEY, TOKEN);
  assert.ok(Sealed.safeParse(s).success);
  assert.equal(open(KEY, s), TOKEN);
  assert.doesNotMatch(JSON.stringify(s), /sk-ant|a1B2/);
  assert.notDeepEqual(seal(KEY, TOKEN).iv, s.iv, "a fresh IV each time");
  const cmd = Command.safeParse({ type: "subscription.connect", sealed: s });
  assert.ok(cmd.success, "the command carries only the sealed form");
});

test("another key, or one changed byte, does not open", () => {
  const s = seal(KEY, TOKEN);
  assert.throws(() => open("x".repeat(40), s));
  const flipped = Buffer.from(s.data, "base64");
  flipped[0] = (flipped[0] ?? 0) ^ 1;
  assert.throws(() => open(KEY, { ...s, data: flipped.toString("base64") }));
  assert.throws(() => open(KEY, { ...s, tag: "0".repeat(32) }));
  assert.throws(() => seal("short", TOKEN), /at least 32/);
});

test("only a subscription token passes, never an API key", () => {
  assert.match(TOKEN, SUBSCRIPTION_TOKEN);
  assert.doesNotMatch(`sk-ant-api03-${"x".repeat(60)}`, SUBSCRIPTION_TOKEN);
  assert.doesNotMatch("sk-ant-oat01-short", SUBSCRIPTION_TOKEN);
  assert.doesNotMatch(`${TOKEN} extra`, SUBSCRIPTION_TOKEN);
});
