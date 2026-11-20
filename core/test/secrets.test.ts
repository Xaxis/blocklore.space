import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSecrets, isBase58Check, isBech32 } from "../src/secrets.ts";

const kinds = (t: string) =>
  detectSecrets(t)
    .map((f) => f.kind)
    .sort();

test("a 12-word seed phrase is refused, numbered or not", () => {
  const seed =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  assert.deepEqual(kinds(seed), ["seed-phrase"]);
  assert.deepEqual(
    kinds(
      seed
        .split(" ")
        .map((w, i) => `${i + 1}. ${w}`)
        .join("\n"),
    ),
    ["seed-phrase"],
  );
  assert.deepEqual(kinds(`is this right? ${seed} thanks`), ["seed-phrase"]);
});

test("eleven list words in a row are not a seed phrase", () => {
  assert.deepEqual(
    kinds("abandon ability able about above absent absorb abstract absurd abuse access"),
    [],
  );
});

test("ordinary questions pass", () => {
  for (const q of [
    "How does the difficulty adjustment work after a halving?",
    "What is the best way to keep a backup of my wallet safe from fire and water damage over many years?",
    "What changed in Bitcoin Core 30.0 about OP_RETURN outputs, and why did people disagree?",
    "Explain wpkh() descriptors and what a tr() descriptor means for a beginner.",
    "Was block 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f the genesis block?",
    "Why is the supply capped near 21,000,000 BTC, and when does the 2028 halving happen at block 1,050,000?",
  ])
    assert.deepEqual(kinds(q), [], q);
});

test("keys, addresses, invoices and contact details are refused", () => {
  assert.deepEqual(
    kinds(
      "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
    ),
    ["extended-key"],
  );
  assert.deepEqual(kinds("my key 5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ"), [
    "private-key",
  ]);
  assert.deepEqual(kinds("send to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa please"), ["address"]);
  assert.deepEqual(kinds("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), ["address"]);
  assert.deepEqual(
    kinds(
      "wpkh([d34db33f/84h/0h/0h]03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd)",
    ),
    ["descriptor", "lightning"],
  );
  assert.deepEqual(kinds("tx 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b"), [
    "hex-64",
  ]);
  assert.deepEqual(
    kinds("lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq"),
    ["lightning"],
  );
  assert.deepEqual(kinds("write me at someone@example.com"), ["email"]);
  assert.deepEqual(kinds("call +1 555 123 4567"), ["phone"]);
});

test("checksums decide, not shapes", () => {
  assert.ok(isBase58Check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"));
  assert.ok(!isBase58Check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb"));
  assert.ok(isBech32("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"));
  assert.ok(!isBech32("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"));
  assert.deepEqual(kinds("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb"), []);
});
