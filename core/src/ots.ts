// OpenTimestamps proofs: reading, writing and walking them, so a snapshot's proof can be made,
// completed and checked here without trusting another program. The format follows the reference
// implementation (python-opentimestamps, opentimestamps/core/{op,timestamp,notary}.py): a tree of
// operations from a digest to attestations, each attestation naming a calendar (pending) or a
// Bitcoin block whose header's merkle root is the message at that point.
import { ripemd160, sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const OTS_MAGIC = hexToBytes(
  "004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294",
);
const MAJOR_VERSION = 1;
const MAX_MSG = 4096;
const MAX_PAYLOAD = 8192;
const MAX_URI = 1000;
const MAX_DEPTH = 256;
const URI_CHARS = /^[A-Za-z0-9\-._/:]+$/;

const TAG_PENDING = "83dfe30d2ef90c8e";
const TAG_BITCOIN = "0588960d73d71901";

export type OtsOp =
  | { op: "append" | "prepend"; arg: Uint8Array }
  | { op: "reverse" | "hexlify" | "sha1" | "ripemd160" | "sha256" | "keccak256" };

export type OtsAttestation =
  | { kind: "pending"; uri: string }
  | { kind: "bitcoin"; height: number }
  | { kind: "unknown"; tag: string; payload: Uint8Array };

export interface OtsTimestamp {
  msg: Uint8Array;
  attestations: OtsAttestation[];
  ops: { op: OtsOp; next: OtsTimestamp }[];
}

/** A detached proof: the digest of a file under a hash operation, and the tree from it. */
export interface OtsProof {
  hashOp: "sha256";
  digest: Uint8Array;
  timestamp: OtsTimestamp;
}

const UNARY: Record<number, OtsOp["op"]> = {
  242: "reverse",
  243: "hexlify",
  2: "sha1",
  3: "ripemd160",
  8: "sha256",
  103: "keccak256",
};
const BINARY: Record<number, OtsOp["op"]> = { 240: "append", 241: "prepend" };
const TAG_OF: Record<OtsOp["op"], number> = {
  append: 0xf0,
  prepend: 0xf1,
  reverse: 0xf2,
  hexlify: 0xf3,
  sha1: 0x02,
  ripemd160: 0x03,
  sha256: 0x08,
  keccak256: 0x67,
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return a.length - b.length;
}

/** Applies one operation to a message, with the reference implementation's length limits. */
export function applyOp(op: OtsOp, msg: Uint8Array): Uint8Array {
  if (msg.length > MAX_MSG) throw new Error(`message longer than ${MAX_MSG} bytes`);
  let out: Uint8Array;
  switch (op.op) {
    case "append":
      out = concat(msg, op.arg);
      break;
    case "prepend":
      out = concat(op.arg, msg);
      break;
    case "reverse":
      if (!msg.length) throw new Error("reverse of an empty message");
      out = msg.slice().reverse();
      break;
    case "hexlify":
      if (!msg.length || msg.length > MAX_MSG / 2) throw new Error("hexlify length out of range");
      out = utf8ToBytes(bytesToHex(msg));
      break;
    case "sha1":
      out = sha1(msg);
      break;
    case "ripemd160":
      out = ripemd160(msg);
      break;
    case "sha256":
      out = sha256(msg);
      break;
    case "keccak256":
      out = keccak_256(msg);
      break;
  }
  if (out.length > MAX_MSG) throw new Error(`result longer than ${MAX_MSG} bytes`);
  return out;
}

class Reader {
  at = 0;
  private readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  byte(): number {
    const b = this.buf[this.at];
    if (b === undefined) throw new Error("proof ends early");
    this.at++;
    return b;
  }
  bytes(n: number): Uint8Array {
    if (this.at + n > this.buf.length) throw new Error("proof ends early");
    const out = this.buf.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }
  varuint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 49) throw new Error("varuint too large");
    }
    return value;
  }
  varbytes(max: number, min = 0): Uint8Array {
    const n = this.varuint();
    if (n > max || n < min) throw new Error(`varbytes length ${n} out of range`);
    return this.bytes(n);
  }
  done(): boolean {
    return this.at === this.buf.length;
  }
}

class Writer {
  private parts: Uint8Array[] = [];
  byte(b: number) {
    this.parts.push(Uint8Array.of(b));
  }
  bytes(b: Uint8Array) {
    this.parts.push(b);
  }
  varuint(n: number) {
    const out: number[] = [];
    let v = n;
    do {
      let b = v % 128;
      v = Math.floor(v / 128);
      if (v > 0) b |= 0x80;
      out.push(b);
    } while (v > 0);
    this.parts.push(Uint8Array.from(out));
  }
  varbytes(b: Uint8Array) {
    this.varuint(b.length);
    this.bytes(b);
  }
  result(): Uint8Array {
    return concat(...this.parts);
  }
}

function readAttestation(r: Reader): OtsAttestation {
  const tag = bytesToHex(r.bytes(8));
  const raw = r.varbytes(MAX_PAYLOAD);
  const payload = new Reader(raw);
  let a: OtsAttestation;
  if (tag === TAG_PENDING) {
    const uri = new TextDecoder("utf-8", { fatal: true }).decode(payload.varbytes(MAX_URI));
    if (!URI_CHARS.test(uri))
      throw new Error("pending attestation URI has characters outside the allowed set");
    a = { kind: "pending", uri };
  } else if (tag === TAG_BITCOIN) a = { kind: "bitcoin", height: payload.varuint() };
  else return { kind: "unknown", tag, payload: raw };
  if (!payload.done()) throw new Error("attestation payload has bytes left over");
  return a;
}

function attestationPayload(a: OtsAttestation): { tag: string; payload: Uint8Array } {
  const w = new Writer();
  if (a.kind === "pending") w.varbytes(utf8ToBytes(a.uri));
  else if (a.kind === "bitcoin") w.varuint(a.height);
  else return { tag: a.tag, payload: a.payload };
  return { tag: a.kind === "pending" ? TAG_PENDING : TAG_BITCOIN, payload: w.result() };
}

function compareAttestations(a: OtsAttestation, b: OtsAttestation): number {
  const ta = attestationPayload(a);
  const tb = attestationPayload(b);
  if (ta.tag !== tb.tag) return ta.tag < tb.tag ? -1 : 1;
  if (a.kind === "pending" && b.kind === "pending")
    return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
  if (a.kind === "bitcoin" && b.kind === "bitcoin") return a.height - b.height;
  return compareBytes(ta.payload, tb.payload);
}

function compareOps(a: OtsOp, b: OtsOp): number {
  const d = TAG_OF[a.op] - TAG_OF[b.op];
  if (d) return d;
  return "arg" in a && "arg" in b ? compareBytes(a.arg, b.arg) : 0;
}

const sameOp = (a: OtsOp, b: OtsOp) => compareOps(a, b) === 0;

function readTimestamp(r: Reader, msg: Uint8Array, depth: number): OtsTimestamp {
  if (depth > MAX_DEPTH) throw new Error("proof nests too deeply");
  const ts: OtsTimestamp = { msg, attestations: [], ops: [] };
  const one = (tag: number) => {
    if (tag === 0x00) {
      ts.attestations.push(readAttestation(r));
      return;
    }
    let op: OtsOp;
    const unary = UNARY[tag];
    const binary = BINARY[tag];
    if (unary) op = { op: unary } as OtsOp;
    else if (binary) op = { op: binary as "append" | "prepend", arg: r.varbytes(MAX_MSG, 1) };
    else throw new Error(`unknown operation tag 0x${tag.toString(16)}`);
    if (ts.ops.some((o) => sameOp(o.op, op))) throw new Error("operation repeated at one point");
    ts.ops.push({ op, next: readTimestamp(r, applyOp(op, msg), depth + 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) {
    one(r.byte());
    tag = r.byte();
  }
  one(tag);
  return ts;
}

function writeTimestamp(w: Writer, ts: OtsTimestamp): void {
  if (!ts.attestations.length && !ts.ops.length)
    throw new Error("an empty timestamp cannot be written");
  const atts = [...ts.attestations].sort(compareAttestations);
  const ops = [...ts.ops].sort((a, b) => compareOps(a.op, b.op));
  const att = (a: OtsAttestation) => {
    const { tag, payload } = attestationPayload(a);
    w.bytes(hexToBytes(tag));
    w.varbytes(payload);
  };
  for (const a of atts.slice(0, -1)) {
    w.bytes(Uint8Array.of(0xff, 0x00));
    att(a);
  }
  const last = atts[atts.length - 1];
  if (!ops.length) {
    w.byte(0x00);
    if (last) att(last);
    return;
  }
  if (last) {
    w.bytes(Uint8Array.of(0xff, 0x00));
    att(last);
  }
  ops.forEach(({ op, next }, i) => {
    if (i < ops.length - 1) w.byte(0xff);
    w.byte(TAG_OF[op.op]);
    if ("arg" in op) w.varbytes(op.arg);
    writeTimestamp(w, next);
  });
}

/** Reads a detached .ots proof. Only SHA-256 file digests are taken. */
export function parseOts(bytes: Uint8Array): OtsProof {
  const r = new Reader(bytes);
  if (!equal(r.bytes(OTS_MAGIC.length), OTS_MAGIC)) throw new Error("not an OpenTimestamps proof");
  const major = r.byte();
  if (major !== MAJOR_VERSION) throw new Error(`proof version ${major} is not supported`);
  if (r.byte() !== TAG_OF.sha256) throw new Error("only SHA-256 file digests are supported");
  const digest = r.bytes(32);
  const timestamp = readTimestamp(r, digest, 0);
  if (!r.done()) throw new Error("bytes left over after the proof");
  return { hashOp: "sha256", digest, timestamp };
}

export function serializeOts(proof: OtsProof): Uint8Array {
  const w = new Writer();
  w.bytes(OTS_MAGIC);
  w.byte(MAJOR_VERSION);
  w.byte(TAG_OF.sha256);
  w.bytes(proof.digest);
  writeTimestamp(w, proof.timestamp);
  return w.result();
}

/** Reads a bare timestamp, as a calendar answers, for the message it commits to. */
export function parseTimestamp(bytes: Uint8Array, msg: Uint8Array): OtsTimestamp {
  const r = new Reader(bytes);
  const ts = readTimestamp(r, msg, 0);
  if (!r.done()) throw new Error("bytes left over after the timestamp");
  return ts;
}

/** Adds everything in `from` to `into` (both for the same message), as the reference merge does. */
export function mergeTimestamp(into: OtsTimestamp, from: OtsTimestamp): void {
  if (!equal(into.msg, from.msg)) throw new Error("timestamps for different messages cannot merge");
  for (const a of from.attestations)
    if (!into.attestations.some((b) => compareAttestations(a, b) === 0)) into.attestations.push(a);
  for (const o of from.ops) {
    const mine = into.ops.find((x) => sameOp(x.op, o.op));
    if (mine) mergeTimestamp(mine.next, o.next);
    else into.ops.push(o);
  }
}

/** Every attestation in the tree with the message it attests, depth first. */
export function otsAttestations(
  ts: OtsTimestamp,
): { msg: Uint8Array; attestation: OtsAttestation }[] {
  return [
    ...ts.attestations.map((attestation) => ({ msg: ts.msg, attestation })),
    ...ts.ops.flatMap((o) => otsAttestations(o.next)),
  ];
}

/** The Bitcoin attestations: each block height with the merkle root it requires, as explorers print it. */
export function bitcoinAttestations(proof: OtsProof): { height: number; merkleRoot: string }[] {
  return otsAttestations(proof.timestamp).flatMap(({ msg, attestation }) =>
    attestation.kind === "bitcoin" && msg.length === 32
      ? [{ height: attestation.height, merkleRoot: bytesToHex(msg.slice().reverse()) }]
      : [],
  );
}

/** The calendars still to be asked, with the commitment each one holds. */
export function pendingAttestations(proof: OtsProof): { uri: string; commitment: string }[] {
  return otsAttestations(proof.timestamp).flatMap(({ msg, attestation }) =>
    attestation.kind === "pending" ? [{ uri: attestation.uri, commitment: bytesToHex(msg) }] : [],
  );
}

/** Finds the node for `msg` in the tree, so a calendar's completed answer can be merged there. */
export function findTimestamp(ts: OtsTimestamp, msg: Uint8Array): OtsTimestamp | null {
  if (equal(ts.msg, msg)) return ts;
  for (const o of ts.ops) {
    const found = findTimestamp(o.next, msg);
    if (found) return found;
  }
  return null;
}
