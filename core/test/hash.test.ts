import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  canonicalJson,
  claimHash,
  merkleProof,
  merkleRoot,
  sha256Hex,
  verifyMerkleProof,
} from "../src/hash.ts";
import { claim } from "./fixtures.ts";

test("canonical JSON sorts keys at every level and drops undefined", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } }),
    '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}',
  );
});

test("a claim's hash ignores when it was last verified, and nothing else", () => {
  const a = claim();
  const b = claim({
    last_verified: { ...a.last_verified, time: "2026-12-01T00:00:00Z", height: 978000 },
  });
  assert.equal(claimHash(a), claimHash(b));
  assert.notEqual(claimHash(a), claimHash(claim({ confidence: "medium" })));
});

test("roots follow RFC 6962: empty, one leaf and two leaves", () => {
  const H = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  const a = sha256Hex("a");
  const b = sha256Hex("b");
  const leafA = H(Buffer.from([0]), Buffer.from(a, "hex"));
  const leafB = H(Buffer.from([0]), Buffer.from(b, "hex"));
  assert.equal(merkleRoot([]), H());
  assert.equal(merkleRoot([a]), leafA);
  assert.equal(
    merkleRoot([a, b]),
    H(Buffer.from([1]), Buffer.from(leafA, "hex"), Buffer.from(leafB, "hex")),
  );
});

test("every leaf's proof verifies against the root, for every tree size up to 33", () => {
  for (let n = 1; n <= 33; n++) {
    const leaves = Array.from({ length: n }, (_, i) => sha256Hex(`claim-${i}`));
    const root = merkleRoot(leaves);
    for (let i = 0; i < n; i++) {
      const proof = merkleProof(leaves, i);
      assert.ok(verifyMerkleProof(leaves[i] as string, i, n, proof, root), `n=${n} i=${i}`);
      if (n > 1) assert.ok(!verifyMerkleProof(leaves[(i + 1) % n] as string, i, n, proof, root));
    }
  }
});

test("changing any leaf changes the root", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => sha256Hex(`c${i}`));
  const root = merkleRoot(leaves);
  for (let i = 0; i < 7; i++) {
    const copy = [...leaves];
    copy[i] = sha256Hex("tampered");
    assert.notEqual(merkleRoot(copy), root);
  }
});
