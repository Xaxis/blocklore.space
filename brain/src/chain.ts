// ChainSource (ARCHITECTURE.md, Interfaces). Until the owner provides a node (Q1), two independent
// Esplora explorers must agree on every fact a check relies on; with BITCOIN_RPC_URL set, Bitcoin
// Core answers instead. Every answer says which backend gave it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { get } from "./http.ts";

export interface Header {
  height: number;
  hash: string;
  version: number;
  /** The merkle root as explorers and Bitcoin Core print it (byte-reversed). */
  merkleRoot: string;
  time: number;
  bits: string;
  nonce: number;
}

export interface ChainSource {
  name: string;
  tipHeight(): Promise<number>;
  blockHash(height: number): Promise<string>;
  header(height: number): Promise<Header>;
  /** Sats: coinbase outputs minus the block's fees. */
  subsidy(height: number): Promise<{ sats: number; method: string }>;
  /** Versions of the blocks from `from` to `to` inclusive, for signaling counts. */
  versions(from: number, to: number): Promise<Map<number, number>>;
}

class Disagreement extends Error {}

async function text(url: string, maxAge: number): Promise<string> {
  const r = await get(url, { maxAge });
  if (r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
  return r.body.trim();
}

/** Seconds a chain fact may be cached: deep blocks never change, the tip changes every block. */
function ageFor(height: number, tip: number): number {
  return tip - height > 100 ? 365 * 86400 : 0;
}

export class EsploraPair implements ChainSource {
  name = "esplora pair (mempool.space and blockstream.info, must agree)";
  private readonly a = "https://mempool.space/api";
  private readonly b = "https://blockstream.info/api";
  private tip = 0;

  async tipHeight(): Promise<number> {
    const [x, y] = await Promise.all([
      text(`${this.a}/blocks/tip/height`, 0),
      text(`${this.b}/blocks/tip/height`, 0),
    ]);
    // The two may be a block apart for a moment; the lower one is the tip both have seen.
    this.tip = Math.min(Number(x), Number(y));
    return this.tip;
  }

  private async both(path: string, height: number): Promise<string> {
    if (!this.tip) await this.tipHeight();
    const age = ageFor(height, this.tip);
    const [x, y] = await Promise.all([
      text(`${this.a}${path}`, age),
      text(`${this.b}${path}`, age),
    ]);
    if (x !== y)
      throw new Disagreement(
        `explorers disagree on ${path}: ${x.slice(0, 80)} vs ${y.slice(0, 80)}`,
      );
    return x;
  }

  async blockHash(height: number): Promise<string> {
    return this.both(`/block-height/${height}`, height);
  }

  async header(height: number): Promise<Header> {
    const hash = await this.blockHash(height);
    const raw = await this.both(`/block/${hash}/header`, height);
    // The header must hash to the block hash both explorers gave for this height.
    const sha = (b: Buffer) => createHash("sha256").update(b).digest();
    const own = sha(sha(Buffer.from(raw, "hex")))
      .reverse()
      .toString("hex");
    if (own !== hash) throw new Disagreement(`the header of ${height} does not hash to ${hash}`);
    return { height, hash, ...parseHeader(raw) };
  }

  async subsidy(height: number): Promise<{ sats: number; method: string }> {
    const hash = await this.blockHash(height);
    const age = ageFor(height, this.tip);
    // Both explorers must agree on the coinbase's outputs; only mempool.space reports total fees.
    const coinbaseOut = async (base: string) => {
      const txid = await text(`${base}/block/${hash}/txid/0`, age);
      const tx = JSON.parse(await text(`${base}/tx/${txid}`, age)) as { vout: { value: number }[] };
      return tx.vout.reduce((n, o) => n + o.value, 0);
    };
    const [x, y] = await Promise.all([coinbaseOut(this.a), coinbaseOut(this.b)]);
    if (x !== y) throw new Disagreement(`explorers disagree on the coinbase of ${height}`);
    const blocks = JSON.parse(await text(`https://mempool.space/api/v1/blocks/${height}`, age)) as {
      height: number;
      extras?: { totalFees?: number };
    }[];
    const fees = blocks.find((b) => b.height === height)?.extras?.totalFees;
    if (fees === undefined) throw new Error(`no fee total for block ${height}`);
    return {
      sats: x - fees,
      method: "coinbase outputs agreed by both explorers, minus fees reported by mempool.space",
    };
  }

  async versions(from: number, to: number): Promise<Map<number, number>> {
    if (!this.tip) await this.tipHeight();
    const out = new Map<number, number>();
    // mempool.space lists 15 blocks at a time, newest first, from the given height down.
    for (let h = to; h >= from; h -= 15) {
      const blocks = JSON.parse(await text(`${this.a}/v1/blocks/${h}`, ageFor(h, this.tip))) as {
        height: number;
        version: number;
      }[];
      for (const b of blocks) if (b.height >= from && b.height <= to) out.set(b.height, b.version);
    }
    return out;
  }
}

/** Fields of an 80-byte block header given as hex. */
export function parseHeader(hex: string): Omit<Header, "height" | "hash"> {
  const b = Buffer.from(hex, "hex");
  if (b.length !== 80) throw new Error(`a header is 80 bytes, got ${b.length}`);
  return {
    version: b.readInt32LE(0),
    merkleRoot: Buffer.from(b.subarray(36, 68)).reverse().toString("hex"),
    time: b.readUInt32LE(68),
    bits: b.readUInt32LE(72).toString(16).padStart(8, "0"),
    nonce: b.readUInt32LE(76),
  };
}

/** Bitcoin Core's JSON-RPC, read-only calls only. */
export class CoreRpc implements ChainSource {
  name: string;
  private readonly url: string;
  private readonly auth: string;
  constructor(url: string, auth: string) {
    this.url = url;
    this.auth = auth;
    this.name = `bitcoin core rpc (${new URL(url).host})`;
  }

  static fromEnv(): CoreRpc | null {
    const url = process.env.BITCOIN_RPC_URL;
    if (!url) return null;
    const cookie = process.env.BITCOIN_RPC_COOKIE_FILE;
    const auth = cookie
      ? readFileSync(cookie, "utf8").trim()
      : `${process.env.BITCOIN_RPC_USER}:${process.env.BITCOIN_RPC_PASSWORD}`;
    return new CoreRpc(url, auth);
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(this.auth).toString("base64")}`,
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "blocklore", method, params }),
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json()) as { result: T; error: { message: string } | null };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }

  tipHeight() {
    return this.call<number>("getblockcount");
  }
  blockHash(height: number) {
    return this.call<string>("getblockhash", [height]);
  }
  async header(height: number): Promise<Header> {
    const hash = await this.blockHash(height);
    const h = await this.call<{
      version: number;
      merkleroot: string;
      time: number;
      bits: string;
      nonce: number;
    }>("getblockheader", [hash]);
    return {
      height,
      hash,
      version: h.version,
      merkleRoot: h.merkleroot,
      time: h.time,
      bits: h.bits,
      nonce: h.nonce,
    };
  }
  async subsidy(height: number) {
    const s = await this.call<{ subsidy: number }>("getblockstats", [height, ["subsidy"]]);
    return { sats: s.subsidy, method: "getblockstats subsidy" };
  }
  async versions(from: number, to: number) {
    const out = new Map<number, number>();
    for (let h = from; h <= to; h++) out.set(h, (await this.header(h)).version);
    return out;
  }
}

export function chainSource(): ChainSource {
  return CoreRpc.fromEnv() ?? new EsploraPair();
}

export { Disagreement };
