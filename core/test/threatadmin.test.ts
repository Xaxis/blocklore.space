import assert from "node:assert/strict";
import { test } from "node:test";
import { Command } from "../src/control.ts";
import type { Threat } from "../src/security.ts";
import {
  applyThreatCommand,
  isThreatCommand,
  namesPhrase,
  researchLinks,
  SUGGEST_MAX,
  ThreatAdminView,
  type ThreatClaim,
  type ThreatCommand,
  threatAdminView,
  threatCommandMessage,
  threatCommandProblem,
  threatPhrases,
  threatSuggestions,
} from "../src/threatadmin.ts";

const threat = (over: Partial<Threat> = {}): Threat => ({
  id: "duplicate-transactions",
  title: "Duplicate transactions",
  layer: "consensus",
  status: "defended",
  topic: "consensus-security",
  claims: [],
  mitigations: [],
  history: [],
  watches: [],
  lab: [],
  terms: ["BIP 30", "duplicate txid"],
  ...over,
});

const claim = (id: string, statement: string, topics = [id.split(".")[0] ?? ""]): ThreatClaim => ({
  id,
  statement,
  topics,
});

test("a phrase is named as whole words in order, whatever the case, spacing, hyphen or plural", () => {
  assert.ok(namesPhrase("BIP 30 forbids a new transaction...", "BIP 30"));
  assert.ok(namesPhrase("as bip-30 says", "BIP 30"));
  assert.ok(namesPhrase("under BIP\n30", "BIP 30"));
  assert.ok(!namesPhrase("BIP 300 proposes drivechains", "BIP 30"), "not a longer number");
  assert.ok(!namesPhrase("BIP30", "BIP 30"), "the words stay apart");
  assert.ok(namesPhrase("Eclipse attacks isolate a node", "eclipse attack"));
  assert.ok(namesPhrase("pinning.", "pinning"));
  assert.ok(!namesPhrase("unpinning a channel", "pinning"), "not inside a word");
  assert.ok(namesPhrase("pinnings", "pinning"), "a plural s counts");
  assert.ok(!namesPhrase("a quantum.computer", "quantum computer"), "a dot is not a space");
  assert.ok(namesPhrase("price (x+y) rose", "x+y"), "regex characters are taken literally");
  assert.ok(!namesPhrase("anything", "   "), "an empty phrase names nothing");
});

test("a threat's phrases are its terms, then its id's words, each once", () => {
  assert.deepEqual(threatPhrases(threat()), ["BIP 30", "duplicate txid", "duplicate transactions"]);
  assert.deepEqual(
    threatPhrases(threat({ id: "pinning", terms: ["Pinning", "transaction  pinning"] })),
    ["Pinning", "transaction pinning"],
  );
});

test("suggestions: claims that name the threat and it does not list, on its topic first, capped", () => {
  const t = threat({ claims: ["utxo-model.bip30"], mitigations: ["utxo-model.bip34"] });
  const got = threatSuggestions(t, [
    claim("utxo-model.bip30", "BIP 30 forbids it."), // listed as what it is
    claim("utxo-model.bip34", "BIP 34 made BIP 30 checks redundant."), // listed as a defense
    claim("utxo-model.bip30-exceptions", "Two blocks are exempt from BIP 30."),
    claim("consensus-security.dup", "Duplicate transactions overwrote two coinbases."),
    claim("taproot.unrelated", "Taproot adds Schnorr signatures."),
    claim("halvings-and-supply.lost", "BIP-30 cost 100 BTC.", ["halvings-and-supply"]),
  ]);
  assert.deepEqual(
    got.map((s) => [s.id, s.match, s.onTopic]),
    [
      ["consensus-security.dup", "duplicate transactions", true],
      ["halvings-and-supply.lost", "BIP 30", false],
      ["utxo-model.bip30-exceptions", "BIP 30", false],
    ],
  );
  const many = Array.from({ length: SUGGEST_MAX + 5 }, (_, i) =>
    claim(`utxo-model.c${String(i).padStart(2, "0")}`, `BIP 30 fact ${i}.`),
  );
  assert.equal(threatSuggestions(threat(), many).length, SUGGEST_MAX);
});

const store = {
  threats: [
    threat({ id: "phishing", layer: "people", topic: "self-custody", terms: ["phishing"] }),
    threat({
      id: "covered",
      layer: "consensus",
      terms: ["covered thing"],
      claims: ["utxo-model.a"],
      mitigations: ["utxo-model.gone"],
    }),
    threat(),
    threat({
      id: "a-defended",
      terms: ["defended thing"],
      claims: ["utxo-model.a"],
      mitigations: ["utxo-model.bip30"],
    }),
  ],
  claims: [
    claim("utxo-model.a", "A covered thing."),
    claim("utxo-model.bip30", "BIP 30 forbids duplicate transaction ids."),
    claim("self-custody.phish", "Phishing sites ask for a seed phrase.", ["self-custody"]),
  ],
};
const view = threatAdminView({
  threats: store.threats,
  claims: store.claims,
  all: [...store.claims, { id: "utxo-model.gone", statement: "A withdrawn defense." }],
  head: "abc",
});

test("the view: layers in the map's order, gaps first in each, a withdrawn link marked, counts", () => {
  assert.ok(ThreatAdminView.safeParse(view).success);
  assert.deepEqual(
    view.threats.map((t) => [t.id, t.layer, t.missing]),
    [
      // Its defense was withdrawn, so it is a gap again.
      ["covered", "consensus", ["mitigations"]],
      ["duplicate-transactions", "consensus", ["claims", "mitigations"]],
      // Explained, so after the gaps of its layer although its id comes first.
      ["a-defended", "consensus", []],
      ["phishing", "people", ["claims", "mitigations"]],
    ],
  );
  const covered = view.threats.find((t) => t.id === "covered");
  assert.deepEqual(covered?.mitigations, [
    { id: "utxo-model.gone", statement: "A withdrawn defense.", published: false },
  ]);
  assert.deepEqual(covered?.claims, [
    { id: "utxo-model.a", statement: "A covered thing.", published: true },
  ]);
  assert.deepEqual(
    view.threats.find((t) => t.id === "phishing")?.suggestions.map((s) => [s.id, s.onTopic]),
    [["self-custody.phish", true]],
  );
  assert.deepEqual(view.published, ["self-custody.phish", "utxo-model.a", "utxo-model.bip30"]);
  assert.deepEqual(view.counts, { threats: 4, gaps: 3, suggestions: 2 });
});

test("a command is refused unless it fits the map the owner was shown", () => {
  const link = (threat: string, claim: string, part: "claims" | "mitigations" = "claims") =>
    threatCommandProblem({ type: "threat.link", threat, part, claim }, view);
  const unlink = (threat: string, claim: string, part: "claims" | "mitigations" = "claims") =>
    threatCommandProblem({ type: "threat.unlink", threat, part, claim }, view);
  assert.equal(link("phishing", "self-custody.phish"), null);
  assert.equal(link("phishing", "self-custody.phish", "mitigations"), null);
  assert.match(link("no-such-threat", "utxo-model.a") ?? "", /no threat no-such-threat/);
  assert.match(link("phishing", "self-custody.made-up") ?? "", /not a published claim/);
  assert.match(link("covered", "utxo-model.a") ?? "", /already lists utxo-model.a as what it is/);
  assert.match(
    link("covered", "utxo-model.a", "mitigations") ?? "",
    /as what it is; unlink it there first/,
  );
  assert.equal(unlink("covered", "utxo-model.a"), null);
  // A withdrawn claim can be unlinked, never linked again.
  assert.equal(unlink("covered", "utxo-model.gone", "mitigations"), null);
  assert.match(
    link("phishing", "utxo-model.gone") ?? "",
    /not a published claim/,
    "the view lists only published claims",
  );
  assert.match(unlink("covered", "utxo-model.a", "mitigations") ?? "", /does not list/);
});

test("applying a command appends or removes the one id; the message says which list", () => {
  const t = threat({ claims: ["a.b", "c.d"] });
  const link: ThreatCommand = { type: "threat.link", threat: t.id, part: "claims", claim: "e.f" };
  assert.deepEqual(applyThreatCommand(t, link).claims, ["a.b", "c.d", "e.f"]);
  assert.deepEqual(applyThreatCommand(t, link).mitigations, []);
  const unlink: ThreatCommand = { ...link, type: "threat.unlink", claim: "a.b" };
  assert.deepEqual(applyThreatCommand(t, unlink).claims, ["c.d"]);
  assert.match(
    threatCommandMessage(link),
    /^Link e\.f to the threat duplicate-transactions as what it is/,
  );
  assert.match(
    threatCommandMessage({ ...unlink, part: "mitigations" }),
    /^Unlink a\.b from the threat duplicate-transactions as what defends against it/,
  );
});

test("the commands are the brain's Command, strictly shaped", () => {
  const ok = Command.safeParse({
    type: "threat.link",
    threat: "phishing",
    part: "mitigations",
    claim: "self-custody.phish",
  });
  assert.ok(ok.success && isThreatCommand(ok.data));
  for (const bad of [
    { type: "threat.link", threat: "phishing", part: "both", claim: "self-custody.phish" },
    { type: "threat.unlink", threat: "Phishing", part: "claims", claim: "self-custody.phish" },
    { type: "threat.link", threat: "phishing", part: "claims", claim: "not-an-id" },
    { type: "threat.link", threat: "phishing", part: "claims", claim: "a.b", extra: 1 },
  ])
    assert.ok(!Command.safeParse(bad).success, JSON.stringify(bad));
  assert.ok(!isThreatCommand({ type: "policy.term" }));
});

test("a link research named is made only for a published claim that names the threat", () => {
  const t = threat({ claims: ["consensus-security.listed"] });
  const n = (claim: string, over: object = {}) => ({
    threat: t.id,
    part: "claims" as const,
    claim,
    run: "2026-11-26-daily-consensus-security",
    ...over,
  });
  const r = researchLinks(
    [
      n("consensus-security.bip30"),
      n("consensus-security.bip30"),
      n("consensus-security.waiting"),
      n("consensus-security.vague"),
      n("consensus-security.rejected"),
      n("consensus-security.listed"),
      n("consensus-security.bip30", { threat: "no-such-threat" }),
      n("utxo-model.duplicate-txid", { part: "mitigations" }),
    ],
    [t],
    [
      claim(
        "consensus-security.bip30",
        "BIP 30 forbids a transaction whose txid is already unspent.",
      ),
      claim("consensus-security.vague", "Old rules once allowed a rare problem with transactions."),
      claim("consensus-security.listed", "BIP 30 is enforced from block 1."),
      claim("utxo-model.duplicate-txid", "Two coinbases with a duplicate txid exist in the chain."),
    ],
    new Set(["consensus-security.waiting"]),
  );
  assert.deepEqual(
    r.link.map((l) => [l.claim, l.part, l.match]),
    [
      ["consensus-security.bip30", "claims", "BIP 30"],
      // a claim filed under another topic links too, as code's suggestions allow
      ["utxo-model.duplicate-txid", "mitigations", "duplicate txid"],
    ],
  );
  assert.deepEqual(
    r.wait.map((l) => l.claim),
    ["consensus-security.waiting"],
  );
  assert.deepEqual(
    r.drop.map((d) => [d.claim, d.why]),
    [
      ["consensus-security.bip30", "named twice"],
      ["consensus-security.vague", "its statement does not name the threat"],
      ["consensus-security.rejected", "the claim was not published"],
      ["consensus-security.listed", "the threat already lists the claim"],
      ["consensus-security.bip30", "there is no such threat on the map"],
    ],
  );
});
