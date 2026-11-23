import assert from "node:assert/strict";
import { test } from "node:test";
import { Command, signCommand, verifyEnvelope } from "../src/control.ts";
import {
  applyPolicyCommand,
  flagsText,
  type GatePolicy,
  GatePolicyView,
  gatePolicyView,
  isPolicyCommand,
  type PolicyCommand,
  policyCommandProblem,
  termProblem,
} from "../src/gatepolicy.ts";

const policy: GatePolicy = {
  topics: {
    "utxo-model": { contested: false, safety: false },
    "self-custody": { contested: false, safety: true },
    covenants: { contested: true, safety: false },
    "old-topic": { contested: false, safety: false },
  },
  contested_terms: ["OP_RETURN", "ordinals"],
};

const view = gatePolicyView({
  policy,
  agenda: [
    { slug: "utxo-model", title: "The UTXO model" },
    { slug: "covenants", title: "Covenants" },
    { slug: "p2p-network", title: "The peer-to-peer network" },
  ],
  published: [
    { slug: "utxo-model", title: "UTXO model (published title)" },
    { slug: "self-custody", title: "Self-custody" },
  ],
  waiting: new Map([
    ["p2p-network", 5],
    ["covenants", 2],
  ]),
  head: "abc123",
});

test("the view lists the agenda's topics, then published ones, then the file's others, each as the file sets it", () => {
  assert.ok(GatePolicyView.safeParse(view).success);
  assert.deepEqual(
    view.topics.map((t) => t.slug),
    ["utxo-model", "covenants", "p2p-network", "self-custody", "old-topic"],
  );
  const by = new Map(view.topics.map((t) => [t.slug, t]));
  assert.deepEqual(by.get("p2p-network"), {
    slug: "p2p-network",
    title: "The peer-to-peer network",
    agenda: true,
    published: false,
    listed: null,
    waiting: 5,
  });
  assert.equal(by.get("utxo-model")?.title, "The UTXO model", "the agenda's title");
  assert.deepEqual(by.get("self-custody")?.listed, { contested: false, safety: true });
  assert.equal(by.get("self-custody")?.agenda, false);
  assert.equal(by.get("self-custody")?.published, true);
  assert.equal(by.get("old-topic")?.agenda, false);
  assert.equal(by.get("old-topic")?.published, false);
  assert.deepEqual(view.terms, ["OP_RETURN", "ordinals"]);
  assert.equal(view.waiting, 7);
});

test("the two commands are signed commands of the control plane, and malformed ones are not", () => {
  const ok = [
    { type: "policy.topic", slug: "p2p-network", contested: false, safety: false },
    { type: "policy.topic", slug: "self-custody", contested: true, safety: true },
    { type: "policy.term", term: "BIP 444", add: true },
    { type: "policy.term", term: "OP_RETURN", add: false },
    { type: "policy.term", term: "x".repeat(40), add: true },
  ];
  for (const cmd of ok) {
    const p = Command.safeParse(cmd);
    assert.ok(p.success, JSON.stringify(cmd));
    assert.ok(isPolicyCommand(p.data));
  }
  const trimmed = Command.parse({ type: "policy.term", term: "  BIP 444 ", add: true });
  assert.deepEqual(trimmed, { type: "policy.term", term: "BIP 444", add: true });

  const dash = String.fromCharCode(0x2014);
  const bad = [
    // a slug that is not one, flags missing or not booleans, a key the command does not have
    { type: "policy.topic", slug: "P2P Network", contested: false, safety: false },
    { type: "policy.topic", slug: "p2p-network/../x", contested: false, safety: false },
    { type: "policy.topic", slug: "p2p-network", contested: false },
    { type: "policy.topic", slug: "p2p-network", contested: "no", safety: false },
    { type: "policy.topic", slug: "p2p-network", contested: false, safety: false, file: "x" },
    // a term that is empty, too long, more than one line, punctuation only, a dash, or a secret
    { type: "policy.term", term: "", add: true },
    { type: "policy.term", term: "   ", add: true },
    { type: "policy.term", term: "x".repeat(41), add: true },
    { type: "policy.term", term: "two\nlines", add: true },
    { type: "policy.term", term: "tab\there", add: true },
    { type: "policy.term", term: `line${String.fromCharCode(0x2028)}separator`, add: true },
    { type: "policy.term", term: "!!!", add: true },
    { type: "policy.term", term: `soft fork ${dash} activation`, add: true },
    { type: "policy.term", term: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", add: true },
    { type: "policy.term", term: "owner@example.com", add: true },
    { type: "policy.term", term: "OP_CAT" },
  ];
  for (const cmd of bad) assert.equal(Command.safeParse(cmd).success, false, JSON.stringify(cmd));

  const KEY = "k".repeat(48);
  const e = signCommand(KEY, {
    id: "0f6c1e7a-2222-4a2b-9c3d-123456789abc",
    at: "2026-11-23T11:59:00.000Z",
    by: "owner@example.com",
    cmd: { type: "policy.topic", slug: "p2p-network", contested: false, safety: false },
  });
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(verifyEnvelope(KEY, e, now, () => false).ok, true);
  const other = { ...e, cmd: { ...e.cmd, contested: true } };
  assert.equal(verifyEnvelope(KEY, other, now, () => false).ok, false, "a changed flag");
});

test("a term's problem is said in words the page can show", () => {
  assert.equal(termProblem("quantum"), null);
  assert.match(termProblem("") ?? "", /Write the term/);
  assert.match(termProblem("x".repeat(41)) ?? "", /at most 40 characters/);
  assert.match(termProblem("a\nb") ?? "", /one line/);
  assert.match(termProblem("...") ?? "", /a letter or a digit/);
  assert.match(termProblem(`a ${String.fromCharCode(0x2013)} b`) ?? "", /style check/);
  assert.match(
    termProblem("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4") ?? "",
    /a Bitcoin address/,
  );
});

test("a command must fit the policy as the owner was shown it", () => {
  const problem = (cmd: PolicyCommand) => policyCommandProblem(cmd, view);
  assert.equal(
    problem({ type: "policy.topic", slug: "p2p-network", contested: false, safety: false }),
    null,
    "an unlisted agenda topic can be listed",
  );
  assert.equal(
    problem({ type: "policy.topic", slug: "self-custody", contested: false, safety: false }),
    null,
    "a published topic's flags can change",
  );
  assert.match(
    problem({ type: "policy.topic", slug: "no-such-topic", contested: true, safety: false }) ?? "",
    /neither on the agenda nor published/,
  );
  assert.match(
    problem({ type: "policy.topic", slug: "old-topic", contested: true, safety: false }) ?? "",
    /neither on the agenda nor published/,
    "the file's own topic that left the agenda is shown, not changed",
  );
  assert.match(
    problem({ type: "policy.topic", slug: "covenants", contested: true, safety: false }) ?? "",
    /already sets covenants as contested/,
  );
  assert.equal(problem({ type: "policy.term", term: "CTV", add: true }), null);
  assert.match(
    problem({ type: "policy.term", term: "Ordinals", add: true }) ?? "",
    /Ordinals \(as ordinals\) is already a contested term/,
  );
  assert.equal(problem({ type: "policy.term", term: "ordinals", add: false }), null);
  assert.match(
    problem({ type: "policy.term", term: "Ordinals", add: false }) ?? "",
    /not a contested term/,
    "a removal names the term as the page showed it",
  );
});

test("a command applied to the policy changes what it names and nothing else", () => {
  const listed = applyPolicyCommand(policy, {
    type: "policy.topic",
    slug: "p2p-network",
    contested: false,
    safety: true,
  });
  assert.deepEqual(Object.keys(listed.topics), [...Object.keys(policy.topics), "p2p-network"]);
  assert.deepEqual(listed.topics["p2p-network"], { contested: false, safety: true });
  assert.deepEqual(listed.contested_terms, policy.contested_terms);
  const flipped = applyPolicyCommand(policy, {
    type: "policy.topic",
    slug: "covenants",
    contested: false,
    safety: false,
  });
  assert.deepEqual(Object.keys(flipped.topics), Object.keys(policy.topics), "in its place");
  assert.deepEqual(
    applyPolicyCommand(policy, { type: "policy.term", term: "CTV", add: true }).contested_terms,
    ["OP_RETURN", "ordinals", "CTV"],
  );
  assert.deepEqual(
    applyPolicyCommand(policy, { type: "policy.term", term: "OP_RETURN", add: false })
      .contested_terms,
    ["ordinals"],
  );
  assert.equal(flagsText({ contested: true, safety: true }), "contested and safety advice");
  assert.equal(
    flagsText({ contested: false, safety: false }),
    "neither contested nor safety advice",
  );
});
