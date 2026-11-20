// Canonical serialization and hashing (CLAIMS.md, "Hashing"), and the snapshot's Merkle tree.
//
// The tree follows RFC 6962 (Certificate Transparency) so that a proof cannot be confused with a
// leaf and odd counts need no duplication: leaf = SHA-256(0x00 || claim hash), node =
// SHA-256(0x01 || left || right), and a list of n > 1 leaves splits at the largest power of two
// below n.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Claim } from "./schema.ts";

/** JSON with object keys sorted at every level and undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** What a claim says, without when it was last re-checked. */
export function claimHash(claim: Claim): string {
  const { last_verified: _ignored, ...content } = claim;
  return sha256Hex(canonicalJson(content));
}

function leaf(hashHex: string): Uint8Array {
  const b = hexToBytes(hashHex);
  const buf = new Uint8Array(b.length + 1);
  buf[0] = 0;
  buf.set(b, 1);
  return sha256(buf);
}

function node(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + left.length + right.length);
  buf[0] = 1;
  buf.set(left, 1);
  buf.set(right, 1 + left.length);
  return sha256(buf);
}

function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function mth(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array());
  if (leaves.length === 1) return leaves[0] as Uint8Array;
  const k = split(leaves.length);
  return node(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/** The Merkle root over claim hashes, in the order given (the snapshot sorts by id). */
export function merkleRoot(hashes: string[]): string {
  return bytesToHex(mth(hashes.map(leaf)));
}

/** The audit path for the leaf at `index`: sibling hashes from the bottom up. */
export function merkleProof(hashes: string[], index: number): string[] {
  const path: string[] = [];
  const walk = (leaves: Uint8Array[], i: number) => {
    if (leaves.length <= 1) return;
    const k = split(leaves.length);
    if (i < k) {
      walk(leaves.slice(0, k), i);
      path.push(bytesToHex(mth(leaves.slice(k))));
    } else {
      walk(leaves.slice(k), i - k);
      path.push(bytesToHex(mth(leaves.slice(0, k))));
    }
  };
  walk(hashes.map(leaf), index);
  return path;
}

/** Recomputes the root from one claim hash, its index, the leaf count and its proof. */
export function verifyMerkleProof(
  hash: string,
  index: number,
  count: number,
  proof: string[],
  root: string,
): boolean {
  // RFC 9162 section 2.1.3.2, the inclusion proof verification algorithm.
  if (index >= count) return false;
  let fn = index;
  let sn = count - 1;
  let r = leaf(hash);
  for (const p of proof) {
    const sib = hexToBytes(p);
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = node(sib, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = node(r, sib);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && bytesToHex(r) === root;
}
