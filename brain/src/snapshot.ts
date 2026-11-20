// Snapshots (ARCHITECTURE.md, "Verifying Blocklore itself"): hash every published claim, write the
// manifest, and timestamp its exact bytes on Bitcoin with OpenTimestamps. Deterministic: no model
// reads or writes any of it. `--upgrade` asks the calendars again until a block carries the proof,
// and checks that block's header before keeping the answer.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  bitcoinAttestations,
  buildSnapshot,
  findTimestamp,
  mergeTimestamp,
  merkleRoot,
  type OtsProof,
  type OtsTimestamp,
  parseOts,
  parseTimestamp,
  pendingAttestations,
  proofFile,
  type Store,
  type StoredSnapshot,
  serializeOts,
  snapshotEntries,
  snapshotFile,
  snapshotText,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { type ChainSource, chainSource } from "./chain.ts";
import { ROOT, USER_AGENT } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { nowStamp } from "./store.ts";

const DIR = path.join(ROOT, "knowledge", "snapshots");

/** The reference client's default calendars (opentimestamps-client, otsclient/cmds.py). */
export const CALENDARS = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://a.pool.eternitywall.com",
  "https://ots.btc.catallaxy.com",
];

/**
 * Calendars a proof may send us back to, the reference client's whitelist
 * (python-opentimestamps, calendar.py). A pending attestation is a URI a calendar wrote; any other
 * host is never contacted.
 */
export function calendarAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.origin === uri &&
    /^(?:[a-z0-9-]+\.)+calendar\.(opentimestamps\.org|eternitywall\.com|catallaxy\.com)$/.test(
      u.hostname,
    )
  );
}

const HEADERS = { Accept: "application/vnd.opentimestamps.v1", "User-Agent": USER_AGENT };

/** A calendar request whose failure names the calendar. */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(`${new URL(url).origin}: ${e instanceof Error ? (e.cause ?? e.message) : e}`);
  }
}
const MAX_ANSWER = 64 * 1024;

async function answer(res: Response, what: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_ANSWER) throw new Error(`${what}: answer larger than ${MAX_ANSWER} bytes`);
  return bytes;
}

/** Submits a digest to every calendar; at least two must answer. */
export async function stamp(digest: Uint8Array): Promise<{ proof: OtsProof; answered: string[] }> {
  const timestamp: OtsTimestamp = { msg: digest, attestations: [], ops: [] };
  const answered: string[] = [];
  const results = await Promise.allSettled(
    CALENDARS.map(async (url) => {
      const res = await call(`${url}/digest`, { method: "POST", body: digest });
      if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
      return { url, ts: parseTimestamp(await answer(res, url), digest) };
    }),
  );
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(`  calendar failed: ${String(r.reason)}`);
      continue;
    }
    const bad = pendingAttestations({ hashOp: "sha256", digest, timestamp: r.value.ts }).filter(
      (p) => !calendarAllowed(p.uri),
    );
    if (bad.length) {
      console.error(`  ${r.value.url} sent us to ${bad[0]?.uri}, which is not a known calendar`);
      continue;
    }
    mergeTimestamp(timestamp, r.value.ts);
    answered.push(r.value.url);
  }
  if (answered.length < 2)
    throw new Error(`only ${answered.length} of ${CALENDARS.length} calendars answered`);
  return { proof: { hashOp: "sha256", digest, timestamp }, answered };
}

/** Asks each pending calendar for its completed answer; returns true when the proof changed. */
export async function upgradeProof(proof: OtsProof): Promise<boolean> {
  let changed = false;
  for (const { uri, commitment } of pendingAttestations(proof)) {
    if (!calendarAllowed(uri)) {
      console.error(`  skipping ${uri}: not a known calendar`);
      continue;
    }
    let res: Response;
    try {
      res = await call(`${uri}/timestamp/${commitment}`);
    } catch (e) {
      console.error(`  ${String(e)}`);
      continue;
    }
    if (res.status === 404) {
      console.log(`  ${uri}: not in a block yet`);
      continue;
    }
    if (res.status !== 200) {
      console.error(`  ${uri}: HTTP ${res.status}`);
      continue;
    }
    const msg = Buffer.from(commitment, "hex");
    const node = findTimestamp(proof.timestamp, msg);
    if (!node) continue;
    mergeTimestamp(node, parseTimestamp(await answer(res, uri), msg));
    console.log(`  ${uri}: completed`);
    changed = true;
  }
  return changed;
}

/** Every block the proof names must carry the merkle root the proof arrives at. */
export async function confirmBlocks(proof: OtsProof, chain: ChainSource) {
  const out: { height: number; time: number }[] = [];
  for (const b of bitcoinAttestations(proof)) {
    const header = await chain.header(b.height);
    if (header.merkleRoot !== b.merkleRoot)
      throw new Error(
        `block ${b.height}'s merkle root is ${header.merkleRoot}, the proof needs ${b.merkleRoot}`,
      );
    out.push({ height: b.height, time: header.time });
  }
  return out;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export async function snapshot(opts: {
  commit: boolean;
  push: boolean;
  upgrade: boolean;
  chain?: ChainSource;
}): Promise<number> {
  const chain = opts.chain ?? chainSource();
  const { store, issues } = loadStore();
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) {
    for (const e of errors) console.error(`error  ${e.file}  ${e.where}: ${e.message}`);
    return 1;
  }
  return opts.upgrade ? upgradeAll(store.snapshots, chain, opts) : create(store, chain, opts);
}

async function create(
  store: Store,
  chain: ChainSource,
  opts: { commit: boolean; push: boolean },
): Promise<number> {
  const newest = [...store.snapshots].sort((a, b) => b.manifest.n - a.manifest.n)[0];
  const root = merkleRoot(snapshotEntries(store.claims).map((e) => e.hash));
  if (newest && newest.manifest.root === root) {
    console.log(`snapshot: the claims are as snapshot ${newest.manifest.n} recorded them`);
    return 0;
  }
  // The hashes must describe a commit anyone can check out, so the claims must be committed.
  if (git(["status", "--porcelain", "--", "knowledge/claims"])) {
    console.error("snapshot: knowledge/claims has uncommitted changes; commit them first");
    return 1;
  }
  const commit = git(["rev-parse", "HEAD"]);
  const s = buildSnapshot(store.claims, newest?.manifest ?? null, await nowStamp(chain), commit);
  const text = snapshotText(s);
  const digest = createHash("sha256").update(text, "utf8").digest();
  const { proof, answered } = await stamp(new Uint8Array(digest));
  const file = path.join(DIR, snapshotFile(s.n));
  const ots = path.join(DIR, proofFile(s.n));
  writeFileSync(file, text);
  writeFileSync(ots, serializeOts(proof));
  console.log(
    `snapshot ${s.n}: ${s.count} claims at block ${s.at.height}, root ${s.root}, stamped at ${answered.length} calendars`,
  );
  if (opts.commit)
    commitAsOwner(
      [path.relative(ROOT, file), path.relative(ROOT, ots)],
      `Snapshot ${s.n}: ${s.count} claims under one root at block ${s.at.height}, timestamped so anyone can later prove what the store said then.`,
      opts.push,
    );
  return 0;
}

async function upgradeAll(
  snapshots: StoredSnapshot[],
  chain: ChainSource,
  opts: { commit: boolean; push: boolean },
): Promise<number> {
  const changed: string[] = [];
  const done: string[] = [];
  for (const s of [...snapshots].sort((a, b) => a.manifest.n - b.manifest.n)) {
    if (!s.proof) continue;
    const proof = parseOts(s.proof);
    if (bitcoinAttestations(proof).length) continue;
    console.log(`snapshot ${s.manifest.n}: asking the calendars`);
    if (!(await upgradeProof(proof))) continue;
    const blocks = await confirmBlocks(proof, chain);
    if (!blocks.length) continue;
    const ots = path.join(DIR, proofFile(s.manifest.n));
    // The completed proof must still start from the same file.
    if (Buffer.compare(Buffer.from(parseOts(readFileSync(ots)).digest), Buffer.from(proof.digest)))
      throw new Error(`${ots} changed while it was being upgraded`);
    writeFileSync(ots, serializeOts(proof));
    changed.push(path.relative(ROOT, ots));
    done.push(`snapshot ${s.manifest.n} in block ${blocks[0]?.height}`);
    console.log(`snapshot ${s.manifest.n}: in block ${blocks.map((b) => b.height).join(", ")}`);
  }
  if (!changed.length) {
    console.log("snapshot: no proof completed this time");
    return 0;
  }
  if (opts.commit)
    commitAsOwner(
      changed,
      `Complete the proofs of ${done.join(" and ")}, so each timestamp rests on a block header and no calendar.`,
      opts.push,
    );
  return 0;
}
