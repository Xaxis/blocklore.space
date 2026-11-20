// Recognizes what a reader must never hand Blocklore: seed phrases, private and extended keys,
// descriptors, addresses and transactions that can tie coins to a person, Lightning invoices and
// node ids, Nostr secret keys, email addresses and phone numbers (SECURITY.md, T5). Everything
// that accepts reader text runs this first and refuses on any finding, before storing or sending.
//
// Findings never echo the matched text: the caller explains the kind and drops the input.
import { sha256 } from "@noble/hashes/sha2.js";
import { BIP39_ENGLISH } from "./bip39-english.ts";

export type SecretKind =
  | "seed-phrase"
  | "extended-key"
  | "descriptor"
  | "private-key"
  | "hex-64"
  | "address"
  | "lightning"
  | "nostr-secret"
  | "email"
  | "phone";

export const SECRET_LABEL: Record<SecretKind, string> = {
  "seed-phrase": "a seed phrase (recovery words)",
  "extended-key": "an extended public or private key (xpub, zpub, xprv and kin)",
  descriptor: "an output descriptor with key material",
  "private-key": "a private key",
  "hex-64": "a 64-character hex string, which may be a private key or a transaction id",
  address: "a Bitcoin address",
  lightning: "a Lightning invoice or node id",
  "nostr-secret": "a Nostr secret key (nsec)",
  email: "an email address",
  phone: "a phone number",
};

const WORDS = new Set(BIP39_ENGLISH);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** True when `s` is valid Base58Check (the last four bytes are the double SHA-256 checksum). */
export function isBase58Check(s: string): boolean {
  const b = base58Decode(s);
  if (!b || b.length < 5) return false;
  const body = b.slice(0, -4);
  const sum = sha256(sha256(body));
  return b.slice(-4).every((v, i) => v === sum[i]);
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number;
  }
  return chk >>> 0;
}

/** True when `s` is a valid bech32 or bech32m string (BIP 173, BIP 350). */
export function isBech32(s: string): boolean {
  const lower = s.toLowerCase();
  if (lower !== s && s.toUpperCase() !== s) return false;
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) return false;
  const hrp = lower.slice(0, pos);
  const data: number[] = [];
  for (const ch of lower.slice(pos + 1)) {
    const v = BECH32.indexOf(ch);
    if (v < 0) return false;
    data.push(v);
  }
  const expanded = [
    ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((c) => c.charCodeAt(0) & 31),
  ];
  const pm = polymod([...expanded, ...data]);
  return pm === 1 || pm === 0x2bc830a3;
}

export interface SecretFinding {
  kind: SecretKind;
}

/** Every kind of secret or identifying material found in `text`, each kind once. */
export function detectSecrets(text: string): SecretFinding[] {
  const found = new Set<SecretKind>();

  // A run of 12 or more BIP 39 words, ignoring numbering and punctuation between them.
  let run = 0;
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!token || /^\d+$/.test(token)) continue;
    if (WORDS.has(token)) {
      run++;
      if (run >= 12) found.add("seed-phrase");
    } else run = 0;
  }

  for (const m of text.matchAll(/\b[xyzuvtXYZUVT](?:pub|prv)[1-9A-HJ-NP-Za-km-z]{100,112}\b/g))
    if (isBase58Check(m[0])) found.add("extended-key");

  if (
    /\b(?:wpkh|wsh|sh|pkh|tr|rawtr|combo|multi|sortedmulti|multi_a|sortedmulti_a)\(\s*\[?[0-9a-fA-F]{8}/.test(
      text,
    )
  )
    found.add("descriptor");

  for (const m of text.matchAll(/\b[59KLc][1-9A-HJ-NP-Za-km-z]{50,51}\b/g))
    if (isBase58Check(m[0])) found.add("private-key");

  for (const m of text.matchAll(/\b[0-9a-fA-F]{64}\b/g))
    if (!/^0{8}/.test(m[0])) found.add("hex-64"); // block hashes start with zeros and are public

  for (const m of text.matchAll(/\b[13mn2][1-9A-HJ-NP-Za-km-z]{24,34}\b/g))
    if (isBase58Check(m[0])) found.add("address");
  for (const m of text.matchAll(/\b(?:bc|tb|bcrt)1[02-9ac-hj-np-z]{8,87}\b/gi))
    if (isBech32(m[0])) found.add("address");

  if (/\bln(?:bc|tb|bcrt|tbs)[0-9a-z]{20,}\b/i.test(text) || /\b0[23][0-9a-fA-F]{64}\b/.test(text))
    found.add("lightning");
  if (/\bnsec1[02-9ac-hj-np-z]{58}\b/.test(text)) found.add("nostr-secret");
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) found.add("email");
  if (/(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(text)) found.add("phone");

  return [...found].map((kind) => ({ kind }));
}
