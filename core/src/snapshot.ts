// Snapshots (CLAIMS.md, "Hashing"; ARCHITECTURE.md, "Verifying Blocklore itself"): every claim's
// canonical hash in id order, the Merkle root over them, and the chain to the previous snapshot.
// Pure: the claims, the moment and the commit come in as arguments.

import { bytesToHex } from "@noble/hashes/utils.js";
import { claimHash, merkleRoot, sha256Hex } from "./hash.ts";
import { bitcoinAttestations, parseOts, pendingAttestations } from "./ots.ts";
import type { Claim, Snapshot, Stamp } from "./schema.ts";

export const snapshotFile = (n: number) => `${n}.json`;
export const proofFile = (n: number) => `${n}.json.ots`;

/** Every claim's id and hash, in id order (code-unit order, as JavaScript sorts strings). */
export function snapshotEntries(claims: Claim[]): Snapshot["claims"] {
  return claims
    .map((c) => ({ id: c.id, hash: claimHash(c) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function buildSnapshot(
  claims: Claim[],
  previous: Snapshot | null,
  at: Stamp,
  commit: string,
): Snapshot {
  const entries = snapshotEntries(claims);
  return {
    n: (previous?.n ?? 0) + 1,
    at,
    commit,
    count: entries.length,
    root: merkleRoot(entries.map((e) => e.hash)),
    previous: previous?.root ?? null,
    claims: entries,
  };
}

/** The exact text written to `<n>.json`: the bytes the proof commits to. */
export function snapshotText(s: Snapshot): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}

/** What a snapshot's proof says, read from the proof alone. */
export interface ProofSummary {
  /** SHA-256 of the snapshot file, which the proof must start from. */
  digest: string;
  /** Blocks the proof reaches, each with the merkle root that block's header must carry. */
  blocks: { height: number; merkleRoot: string }[];
  /** Calendars that promised a block and have not been asked again yet. */
  pending: string[];
}

export function summarizeProof(text: string, proof: Uint8Array): ProofSummary {
  const p = parseOts(proof);
  const digest = bytesToHex(p.digest);
  if (digest !== sha256Hex(text))
    throw new Error("the proof does not start from this snapshot file's SHA-256");
  return {
    digest,
    blocks: bitcoinAttestations(p).sort((a, b) => a.height - b.height),
    pending: [...new Set(pendingAttestations(p).map((a) => a.uri))].sort(),
  };
}

/** Problems with a run of snapshots: gaps, broken links, roots or counts that do not add up. */
export function snapshotIssues(snapshots: Snapshot[]): string[] {
  const issues: string[] = [];
  const sorted = [...snapshots].sort((a, b) => a.n - b.n);
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1];
    if (s.n !== i + 1) issues.push(`snapshot ${s.n}: expected number ${i + 1}`);
    if (s.previous !== (prev?.root ?? null))
      issues.push(`snapshot ${s.n}: previous is not snapshot ${prev?.n ?? "none"}'s root`);
    if (s.count !== s.claims.length)
      issues.push(`snapshot ${s.n}: count is not the number of claims`);
    const ids = s.claims.map((c) => c.id);
    if (ids.some((id, j) => j > 0 && (ids[j - 1] as string) >= id))
      issues.push(`snapshot ${s.n}: claims are not in strict id order`);
    if (merkleRoot(s.claims.map((c) => c.hash)) !== s.root)
      issues.push(`snapshot ${s.n}: root is not the Merkle root of its claim hashes`);
  });
  return issues;
}
