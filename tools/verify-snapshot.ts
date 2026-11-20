// Checks a Blocklore snapshot from a clone of the repository, trusting nothing Blocklore serves:
//   1. every claim file at the snapshot's commit, hashed (canonical JSON, SHA-256, last_verified
//      left out), gives exactly the snapshot's list of ids and hashes;
//   2. the Merkle root over those hashes (RFC 6962 tree, in id order) is the snapshot's root, and
//      the snapshot links to the previous one's root;
//   3. the OpenTimestamps proof starts from the snapshot file's SHA-256 and reaches the merkle root
//      of a Bitcoin block header, read from your own node (bitcoin-cli) when it answers, otherwise
//      from mempool.space and blockstream.info, which must agree.
//
//   pnpm verify:snapshot [n] [--explorers]     n defaults to the newest snapshot
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  bitcoinAttestations,
  Claim,
  claimHash,
  parseOts,
  pendingAttestations,
  proofFile,
  Snapshot,
  snapshotFile,
  snapshotIssues,
} from "@blocklore/core";
import { parse } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "knowledge", "snapshots");
const args = process.argv.slice(2);
const forceExplorers = args.includes("--explorers");

let failed = false;
const ok = (what: string) => console.log(`  ok    ${what}`);
const bad = (what: string) => {
  failed = true;
  console.log(`  FAIL  ${what}`);
};
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

const git = (a: string[]) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function readSnapshot(n: number): { s: Snapshot; bytes: Buffer } {
  const bytes = readFileSync(path.join(DIR, snapshotFile(n)));
  return { s: Snapshot.parse(JSON.parse(bytes.toString("utf8"))), bytes };
}

const numbers = existsSync(DIR)
  ? readdirSync(DIR)
      .flatMap((f) => (/^(\d+)\.json$/.exec(f)?.[1] ? [Number(f.slice(0, -5))] : []))
      .sort((a, b) => a - b)
  : [];
if (!numbers.length) {
  console.error("No snapshots in knowledge/snapshots yet.");
  process.exit(1);
}
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? numbers[numbers.length - 1]);
if (!numbers.includes(n)) {
  console.error(`There is no snapshot ${n}; there are ${numbers.join(", ")}.`);
  process.exit(1);
}
const { s, bytes } = readSnapshot(n);
console.log(
  `Snapshot ${n}: ${s.count} claims, commit ${s.commit}, block ${s.at.height} (${s.at.time})`,
);

// 1. Recompute every claim's hash from the files at the snapshot's commit.
try {
  git(["cat-file", "-e", `${s.commit}^{commit}`]);
} catch {
  console.error(`Commit ${s.commit} is not in this clone; run git fetch and try again.`);
  process.exit(1);
}
const files = git(["ls-tree", "-r", "--name-only", s.commit, "knowledge/claims"])
  .split("\n")
  .filter((f) => /\.ya?ml$/.test(f));
const computed = files
  .map((f) => {
    const c = Claim.parse(parse(git(["show", `${s.commit}:${f}`]), { uniqueKeys: true }));
    return { id: c.id, hash: claimHash(c) };
  })
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const listed = new Map(s.claims.map((c) => [c.id, c.hash]));
const mismatched = computed.filter((c) => listed.get(c.id) !== c.hash);
const missing = s.claims.filter((c) => !computed.some((x) => x.id === c.id));
if (!mismatched.length && !missing.length && computed.length === s.claims.length)
  ok(`all ${computed.length} claim files at ${s.commit.slice(0, 10)} hash to the listed hashes`);
else {
  for (const c of mismatched.slice(0, 5)) bad(`${c.id} hashes to ${c.hash}, not what is listed`);
  for (const c of missing.slice(0, 5)) bad(`${c.id} is listed but has no file at that commit`);
  if (computed.length !== s.claims.length)
    bad(`${computed.length} claim files at that commit, ${s.claims.length} listed`);
}

// 2. The root and the chain of snapshots.
const chain = numbers.filter((m) => m <= n).map((m) => readSnapshot(m).s);
const issues = snapshotIssues(chain);
if (issues.length) for (const i of issues) bad(i);
else
  ok(
    `the root ${s.root} is the Merkle root of those hashes${s.previous ? `, and links to snapshot ${n - 1}` : ""}`,
  );

// 3. The proof.
const otsPath = path.join(DIR, proofFile(n));
if (!existsSync(otsPath)) {
  bad(`no proof file ${proofFile(n)}`);
  process.exit(1);
}
const proof = parseOts(readFileSync(otsPath));
const digest = sha256(bytes).toString("hex");
if (Buffer.from(proof.digest).toString("hex") === digest)
  ok(`the proof starts from the file's SHA-256, ${digest}`);
else bad("the proof is for different bytes than this snapshot file");

function nodeHeader(height: number): Buffer | null {
  if (forceExplorers) return null;
  try {
    const run = (a: string[]) =>
      execFileSync("bitcoin-cli", a, {
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    return Buffer.from(
      run(["getblockheader", run(["getblockhash", String(height)]), "false"]),
      "hex",
    );
  } catch {
    return null;
  }
}

async function explorerHeader(height: number): Promise<Buffer> {
  const get = async (base: string, p: string) => {
    const r = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${base}${p}: HTTP ${r.status}`);
    return (await r.text()).trim();
  };
  const both = async (p: (base: string) => Promise<string>) => {
    const [a, b] = await Promise.all([
      p("https://mempool.space/api"),
      p("https://blockstream.info/api"),
    ]);
    if (a !== b) throw new Error(`the explorers disagree about block ${height}`);
    return a;
  };
  const hash = await both((base) => get(base, `/block-height/${height}`));
  const raw = Buffer.from(await both((base) => get(base, `/block/${hash}/header`)), "hex");
  if (sha256(sha256(raw)).reverse().toString("hex") !== hash)
    throw new Error(`the header given for block ${height} does not hash to ${hash}`);
  return raw;
}

const blocks = bitcoinAttestations(proof);
for (const b of blocks) {
  const fromNode = nodeHeader(b.height);
  const header = fromNode ?? (await explorerHeader(b.height));
  const root = Buffer.from(header.subarray(36, 68)).reverse().toString("hex");
  const time = new Date(header.readUInt32LE(68) * 1000).toISOString();
  if (root === b.merkleRoot)
    ok(
      `block ${b.height} (${time}) carries the proof's merkle root, read from ${fromNode ? "your node" : "both explorers"}: the file existed before that block`,
    );
  else bad(`block ${b.height}'s merkle root is ${root}; the proof arrives at ${b.merkleRoot}`);
}
if (!blocks.length) {
  const pending = [...new Set(pendingAttestations(proof).map((p) => p.uri))];
  console.log(
    `  wait  the proof is not in a block yet; calendars holding it: ${pending.join(", ")}. Calendars commit about once an hour; the completed proof is committed to the repository when it arrives.`,
  );
}

console.log(failed ? `Snapshot ${n} does NOT check out.` : `Snapshot ${n} checks out.`);
process.exit(failed ? 1 : 0);
