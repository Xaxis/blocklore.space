import "server-only";
import { z } from "zod";

// The chain as two independent explorers report it, read on the server and cached for a minute, so
// a reader's browser never talks to an explorer. Heights must agree (or be one block apart while a
// block propagates); anything only one explorer offers is labeled as that explorer's.

const UA = "Blocklore/1.0 (+https://blocklore.space/about#bot)";
const REFRESH = 60;

async function read(url: string, json: true): Promise<unknown>;
async function read(url: string, json: false): Promise<string>;
async function read(url: string, json: boolean) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: REFRESH },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return json ? r.json() : (await r.text()).trim();
}

export interface ChainNow {
  read: string;
  heights: { mempool: number | null; blockstream: number | null };
  /** The lower height when the explorers agree to within a block; null when they do not. */
  tip: number | null;
  agreement: "same" | "one block apart" | "disagree" | "one explorer";
  tipHash: string | null;
  tipTime: number | null;
  difficulty: {
    progressPercent: number;
    estimatedChangePercent: number;
    remainingBlocks: number;
    estimatedRetarget: number;
  } | null;
  fees: { fastest: number; halfHour: number; hour: number; minimum: number } | null;
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

// What we take from mempool.space, parsed at the edge; anything else is ignored.
const Difficulty = z.object({
  progressPercent: z.number(),
  difficultyChange: z.number(),
  remainingBlocks: z.number().int().nonnegative(),
  estimatedRetargetDate: z.number(),
});
const Fees = z.object({
  fastestFee: z.number().nonnegative(),
  halfHourFee: z.number().nonnegative(),
  hourFee: z.number().nonnegative(),
  minimumFee: z.number().nonnegative(),
});
const Block = z.object({ timestamp: z.number().int() });

export async function chainNow(): Promise<ChainNow> {
  const [m, b, hash, diff, fees] = await Promise.all([
    settle(read("https://mempool.space/api/blocks/tip/height", false).then(Number)),
    settle(read("https://blockstream.info/api/blocks/tip/height", false).then(Number)),
    settle(read("https://mempool.space/api/blocks/tip/hash", false)),
    settle(read("https://mempool.space/api/v1/difficulty-adjustment", true)),
    settle(read("https://mempool.space/api/v1/fees/recommended", true)),
  ]);
  const ok = (n: number | null) => (n !== null && Number.isInteger(n) && n > 0 ? n : null);
  const hm = ok(m);
  const hb = ok(b);
  let tip: number | null = null;
  let agreement: ChainNow["agreement"] = "disagree";
  if (hm !== null && hb !== null) {
    const gap = Math.abs(hm - hb);
    agreement = gap === 0 ? "same" : gap === 1 ? "one block apart" : "disagree";
    if (gap <= 1) tip = Math.min(hm, hb);
  } else if (hm !== null || hb !== null) {
    agreement = "one explorer";
  }
  const tipHash = typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  let tipTime: number | null = null;
  if (tipHash) {
    const blk = Block.safeParse(
      await settle(read(`https://mempool.space/api/block/${tipHash}`, true)),
    );
    tipTime = blk.success ? blk.data.timestamp : null;
  }
  const d = Difficulty.safeParse(diff);
  const f = Fees.safeParse(fees);
  return {
    read: new Date().toISOString(),
    heights: { mempool: hm, blockstream: hb },
    tip,
    agreement,
    tipHash,
    tipTime,
    difficulty: d.success
      ? {
          progressPercent: d.data.progressPercent,
          estimatedChangePercent: d.data.difficultyChange,
          remainingBlocks: d.data.remainingBlocks,
          estimatedRetarget: d.data.estimatedRetargetDate,
        }
      : null,
    fees: f.success
      ? {
          fastest: f.data.fastestFee,
          halfHour: f.data.halfHourFee,
          hour: f.data.hourFee,
          minimum: f.data.minimumFee,
        }
      : null,
  };
}
