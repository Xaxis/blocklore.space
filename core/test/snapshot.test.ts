import assert from "node:assert/strict";
import { test } from "node:test";
import { claimHash, merkleProof, merkleRoot, sha256Hex, verifyMerkleProof } from "../src/hash.ts";
import { OTS_MAGIC } from "../src/ots.ts";
import { buildSnapshot, snapshotIssues, snapshotText, summarizeProof } from "../src/snapshot.ts";
import { claim } from "./fixtures.ts";

const at = { time: "2026-11-20T12:00:00Z", height: 976900 };
const commit = "a".repeat(40);
const claims = [claim({ id: "taproot.b" }), claim({ id: "fees.a" }), claim({ id: "taproot.a" })];

test("a snapshot lists every claim's hash in id order under their Merkle root", () => {
  const s = buildSnapshot(claims, null, at, commit);
  assert.deepEqual(
    s.claims.map((c) => c.id),
    ["fees.a", "taproot.a", "taproot.b"],
  );
  assert.equal(s.n, 1);
  assert.equal(s.previous, null);
  assert.equal(s.count, 3);
  assert.equal(s.root, merkleRoot(s.claims.map((c) => c.hash)));
  const i = s.claims.findIndex((c) => c.id === "taproot.a");
  const hash = claimHash(claims[2] as (typeof claims)[number]);
  assert.ok(
    verifyMerkleProof(
      hash,
      i,
      s.count,
      merkleProof(
        s.claims.map((c) => c.hash),
        i,
      ),
      s.root,
    ),
  );
});

test("the next snapshot links to the previous root, and the chain checks out", () => {
  const one = buildSnapshot(claims, null, at, commit);
  const two = buildSnapshot([...claims, claim({ id: "fees.b" })], one, at, commit);
  assert.equal(two.n, 2);
  assert.equal(two.previous, one.root);
  assert.deepEqual(snapshotIssues([two, one]), []);
});

test("an edited hash, a broken link or a gap is reported", () => {
  const one = buildSnapshot(claims, null, at, commit);
  const two = buildSnapshot(claims, one, at, commit);
  const edited = {
    ...two,
    claims: two.claims.map((c, i) => (i === 0 ? { ...c, hash: "0".repeat(64) } : c)),
  };
  assert.match(snapshotIssues([one, edited]).join("\n"), /root is not the Merkle root/);
  assert.match(
    snapshotIssues([one, { ...two, previous: "1".repeat(64) }]).join("\n"),
    /previous is not/,
  );
  assert.match(snapshotIssues([two]).join("\n"), /expected number 1/);
});

test("a proof for other bytes is refused", () => {
  const text = snapshotText(buildSnapshot(claims, null, at, commit));
  const proofFor = (digestHex: string) =>
    new Uint8Array([
      ...OTS_MAGIC,
      1,
      0x08,
      ...Buffer.from(digestHex, "hex"),
      0x00,
      ...Buffer.from("0588960d73d71901", "hex"),
      3,
      0xe8,
      0xc9,
      0x3b,
    ]);
  const ok = summarizeProof(text, proofFor(sha256Hex(text)));
  assert.equal(ok.digest, sha256Hex(text));
  assert.deepEqual(ok.pending, []);
  assert.equal(ok.blocks[0]?.height, 976104);
  assert.throws(() => summarizeProof(`${text} `, proofFor(sha256Hex(text))), /does not start from/);
});
