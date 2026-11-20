import assert from "node:assert/strict";
import { test } from "node:test";
import type { BundleClaim } from "../src/bundle.ts";
import { buildIndex, expandQuery, searchClaims } from "../src/search.ts";
import { claim } from "./fixtures.ts";

const bc = (over: Partial<BundleClaim>): BundleClaim => ({
  ...claim(over),
  hash: "0".repeat(64),
  weakSources: false,
  recheck: over.recheck ?? null,
  shownIn: [],
  ...over,
});

const claims: Record<string, BundleClaim> = Object.fromEntries(
  [
    bc({
      id: "taproot.key-path",
      topics: ["taproot"],
      depth: "builder",
      statement:
        "A Taproot key path spend reveals no script: its witness carries a single Schnorr signature.",
    }),
    bc({
      id: "segwit.weight",
      topics: ["segwit"],
      depth: "user",
      statement:
        "SegWit counts a block's size in weight units, at most 4 million weight units per block.",
    }),
    bc({
      id: "fees.op-return",
      topics: ["fees-and-mempool"],
      depth: "holder",
      statement:
        "Bitcoin Core 30.0 raised its default OP_RETURN relay limit for data carrier outputs.",
    }),
    bc({
      id: "utxo.change",
      topics: ["utxo-model"],
      depth: "user",
      statement: "A change output returns the leftover value of spent coins to the payer.",
    }),
    bc({
      id: "segwit.old-weight",
      topics: ["segwit"],
      depth: "user",
      status: "superseded",
      statement: "An older wording about weight units that a newer claim replaced in the store.",
    }),
  ].map((c) => [c.id, c]),
);

test("search ranks the matching claim first and drops superseded claims", () => {
  const ix = buildIndex(Object.values(claims));
  assert.equal(searchClaims(ix, claims, "taproot key path")[0]?.id, "taproot.key-path");
  assert.deepEqual(
    searchClaims(ix, claims, "weight units").map((h) => h.id),
    ["segwit.weight"],
  );
});

test("an opcode is one term, and prefixes still match", () => {
  const ix = buildIndex(Object.values(claims));
  assert.deepEqual(
    searchClaims(ix, claims, "OP_RETURN").map((h) => h.id),
    ["fees.op-return"],
    "OP_RETURN must not match a claim that only says returns",
  );
  assert.equal(searchClaims(ix, claims, "schnor")[0]?.id, "taproot.key-path");
});

test("a reader's depth caps what search returns, and stopwords alone find nothing", () => {
  const ix = buildIndex(Object.values(claims));
  assert.deepEqual(searchClaims(ix, claims, "taproot key path", { maxDepth: "holder" }), []);
  assert.deepEqual(searchClaims(ix, claims, "what is the"), []);
  assert.equal(searchClaims(ix, claims, "weight segwit taproot", { limit: 1 }).length, 1);
});

test("a reader's word for something the claims name otherwise still finds the claim", () => {
  const sub = bc({
    id: "halvings.current-subsidy",
    topics: ["halvings"],
    kind: "fact",
    statement: "As of block 976,751 the block subsidy is 3.125 BTC per block.",
  });
  const local = { ...claims, [sub.id]: sub };
  const ix = buildIndex(Object.values(local));
  assert.equal(searchClaims(ix, local, "what is the mining reward now")[0]?.id, sub.id);
  assert.equal(expandQuery("plain words"), "plain words");
  assert.match(expandQuery("What's the block reward?"), /subsidy$/);
});

test("a what-is question puts the definition ahead of claims that only mention the term", () => {
  const def = bc({
    id: "utxo.what-it-is",
    topics: ["utxo-model"],
    kind: "definition",
    statement: "A UTXO is an unspent transaction output: an amount locked to a spending condition.",
  });
  const many = [1, 2, 3].map((i) =>
    bc({
      id: `utxo.fact-${i}`,
      topics: ["utxo-model"],
      kind: "fact",
      statement: `The UTXO set held ${i} hundred million UTXO entries at a UTXO snapshot, UTXO count ${i}.`,
    }),
  );
  const local = Object.fromEntries([def, ...many].map((c) => [c.id, c]));
  const ix = buildIndex(Object.values(local));
  assert.equal(searchClaims(ix, local, "What is a UTXO?")[0]?.id, def.id);
});
