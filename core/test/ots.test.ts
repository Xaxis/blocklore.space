import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  bitcoinAttestations,
  findTimestamp,
  mergeTimestamp,
  OTS_MAGIC,
  type OtsProof,
  parseOts,
  parseTimestamp,
  pendingAttestations,
  serializeOts,
} from "../src/ots.ts";

// The proof opentimestamps-client ships for its examples/hello-world.txt ("Hello World!\n"),
// complete since 2015. Block 358391's merkle root, as mempool.space and blockstream.info both
// reported it on 2026-11-20 (header time 1432827678):
const FIXTURE = readFileSync(new URL("./data/hello-world.txt.ots", import.meta.url));
const BLOCK = 358391;
const MERKLE_ROOT = "8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00";

test("a real proof parses to its file's digest and writes back byte for byte", () => {
  const proof = parseOts(FIXTURE);
  assert.equal(bytesToHex(proof.digest), bytesToHex(sha256(utf8ToBytes("Hello World!\n"))));
  assert.equal(bytesToHex(serializeOts(proof)), bytesToHex(FIXTURE));
});

test("walking the proof reaches the merkle root of the block it names", () => {
  assert.deepEqual(bitcoinAttestations(parseOts(FIXTURE)), [
    { height: BLOCK, merkleRoot: MERKLE_ROOT },
  ]);
});

test("changing one byte of the proof no longer reaches that merkle root", () => {
  const tampered = Uint8Array.from(FIXTURE);
  // A byte inside the transaction the proof prepends, well past the header and digest.
  tampered[0x80] = (tampered[0x80] as number) ^ 1;
  const roots = bitcoinAttestations(parseOts(tampered)).map((a) => a.merkleRoot);
  assert.equal(roots.length, 1);
  assert.notEqual(roots[0], MERKLE_ROOT);
});

test("malformed proofs are refused", () => {
  assert.throws(() => parseOts(FIXTURE.subarray(1)), /not an OpenTimestamps proof/);
  assert.throws(() => parseOts(Buffer.concat([FIXTURE, Buffer.from([0])])), /left over/);
  assert.throws(() => parseOts(FIXTURE.subarray(0, 100)), /ends early/);
  const badOp = Buffer.concat([
    OTS_MAGIC,
    Buffer.from([1, 0x08]),
    Buffer.alloc(32),
    Buffer.from([0x55]),
  ]);
  assert.throws(() => parseOts(badOp), /unknown operation tag 0x55/);
});

test("a calendar's pending answer merges, and its completed answer turns it into a block", () => {
  const digest = sha256(utf8ToBytes("snapshot 1"));
  const nonce = hexToBytes("00112233445566778899aabbccddeeff");
  const uri = "https://alice.btc.calendar.opentimestamps.org";
  // What a calendar answers to POST /digest: append its nonce, hash, and promise a block later.
  const pendingAnswer = Buffer.concat([
    Buffer.from([0xf0, 16]),
    nonce,
    Buffer.from([0x08, 0x00]),
    hexToBytes("83dfe30d2ef90c8e"),
    Buffer.from([uri.length + 1, uri.length]),
    Buffer.from(uri),
  ]);
  const proof: OtsProof = {
    hashOp: "sha256",
    digest,
    timestamp: { msg: digest, attestations: [], ops: [] },
  };
  mergeTimestamp(proof.timestamp, parseTimestamp(pendingAnswer, digest));
  const reread = parseOts(serializeOts(proof));
  const [pending] = pendingAttestations(reread);
  const commitment = sha256(Buffer.concat([digest, nonce]));
  assert.deepEqual(pending, { uri, commitment: bytesToHex(commitment) });

  // GET /timestamp/<commitment> later: one more hash, then the block.
  const completed = Buffer.concat([
    Buffer.from([0x08, 0x00]),
    hexToBytes("0588960d73d71901"),
    Buffer.from([3, 0xe8, 0xc9, 0x3b]),
  ]);
  const at = findTimestamp(reread.timestamp, commitment);
  assert.ok(at);
  mergeTimestamp(at, parseTimestamp(completed, commitment));
  const [block] = bitcoinAttestations(parseOts(serializeOts(reread)));
  assert.equal(block?.height, 976104);
  assert.equal(block?.merkleRoot, bytesToHex(sha256(commitment).reverse()));
});

test("a pending attestation with a URI outside the allowed characters is refused", () => {
  const digest = new Uint8Array(32);
  const uri = "https://evil.example/<script>";
  const answer = Buffer.concat([
    Buffer.from([0x00]),
    hexToBytes("83dfe30d2ef90c8e"),
    Buffer.from([uri.length + 1, uri.length]),
    Buffer.from(uri),
  ]);
  assert.throws(() => parseTimestamp(answer, digest), /allowed set/);
});
