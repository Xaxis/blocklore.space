// The security watches (ARCHITECTURE.md, "The security watch"): deterministic readings of public
// data, each with a status from documented thresholds. The brain fetches (brain/src/security/
// watches.ts); this file only computes, so every threshold is tested and the same data always gives
// the same reading.
//
// Pure: time comes in as an argument.
import { WATCH_HISTORY, type WatchId, type WatchLevel, type WatchState } from "./security.ts";

export interface WatchSpec {
  id: WatchId;
  /** Plain words for the page and the scene. */
  title: string;
  /** What the headline number is. */
  measures: string;
  unit: "%" | "minutes" | "blocks" | "advisories";
  /** When it is elevated and when it alerts, and why those lines. */
  thresholds: string;
  /** Where the data comes from. */
  source: string;
  /** Minutes between readings. */
  every: number;
}

export const HASHRATE = { elevated: 30, alert: 40 } as const;
export const GAP = { elevated: 90, alert: 180, window: 144 } as const;
export const STEP = { elevated: 60, boundary: 10, alert: 120 } as const;
export const RETARGET = { elevated: 15, alert: 25, settle: 504 } as const;
export const REORG = { elevated: 2, alert: 3, days: 30 } as const;
export const ADVISORY = { days: 30 } as const;
export const EOL = { elevated: 20, alert: 50, maintained: 3 } as const;

export const WATCHES: WatchSpec[] = [
  {
    id: "hashrate",
    title: "Mining pool concentration",
    measures: "The largest mining pool's share of the blocks found over the last week",
    unit: "%",
    thresholds: `Elevated at ${HASHRATE.elevated}%, close to the one third at which selfish mining pays whatever a miner's place in the network (Eyal and Sirer, 2013). Alert at ${HASHRATE.alert}%, within ten points of a majority.`,
    source: "mempool.space mining pool statistics, which attribute blocks by their coinbase tags",
    every: 60,
  },
  {
    id: "block-gaps",
    title: "Long gaps between blocks",
    measures: `The longest interval between consecutive block timestamps in the last ${GAP.window} blocks`,
    unit: "minutes",
    thresholds: `Elevated at ${GAP.elevated} minutes, which at a steady hashrate happens about once in 8,100 blocks. Alert at ${GAP.alert} minutes, which luck alone almost never produces. Miners set timestamps, so a single long gap can also be a clock that was off.`,
    source: "Block headers from mempool.space and blockstream.info, which must agree",
    every: 60,
  },
  {
    id: "timestamps",
    title: "Odd block timestamps",
    measures: `The largest step backward in time from one block to the next, in the last ${GAP.window} blocks`,
    unit: "minutes",
    thresholds: `Elevated at a ${STEP.elevated} minute step back anywhere, or a ${STEP.boundary} minute step back at the first block of a difficulty period (the limit BIP 94 set for testnet4). Alert at a ${STEP.alert} minute step back there, which BIP 54 would make invalid: the signature of a time warp attack.`,
    source: "Block headers from mempool.space and blockstream.info, which must agree",
    every: 60,
  },
  {
    id: "difficulty",
    title: "Difficulty adjustments",
    measures: "The last difficulty adjustment, and the one the current period is on course for",
    unit: "%",
    thresholds: `Elevated when either moves ${RETARGET.elevated}% or more, alert at ${RETARGET.alert}% or more: swings that size mean a large share of hashrate arrived or left. The projection counts only after ${RETARGET.settle} blocks of the period.`,
    source: "Block headers from mempool.space and blockstream.info, which must agree",
    every: 60,
  },
  {
    id: "reorgs",
    title: "Chain reorganizations",
    measures: `The deepest reorganization the brain observed in the last ${REORG.days} days`,
    unit: "blocks",
    thresholds: `One block is normal: two miners sometimes find a block at nearly the same time. Elevated at ${REORG.elevated} blocks, which is rare. Alert at ${REORG.alert} or more.`,
    source:
      "The block hashes the brain has seen at each height, from two explorers that must agree",
    every: 60,
  },
  {
    id: "advisories",
    title: "New security advisories",
    measures: `Security advisories published in the last ${ADVISORY.days} days by Bitcoin Core and the Lightning implementations`,
    unit: "advisories",
    thresholds: `Elevated while any advisory is under ${ADVISORY.days} days old: a fixed vulnerability is public and nodes that have not updated are exposed. Alert when one of them is rated high or critical.`,
    source:
      "bitcoincore.org's advisories and the GitHub security advisories of bitcoin/bitcoin, lnd, Core Lightning, Eclair and LDK",
    every: 6 * 60,
  },
  {
    id: "node-versions",
    title: "Nodes on unmaintained versions",
    measures:
      "The share of reachable Bitcoin Core nodes on a major version past end of life, whose medium and high severity fixes Bitcoin Core's policy has made public",
    unit: "%",
    thresholds: `Bitcoin Core maintains its newest ${EOL.maintained} major versions. Elevated at ${EOL.elevated}%, alert at ${EOL.alert}%.`,
    source: "The Bitnodes crawl of reachable nodes (btcnodes.io), once a day",
    every: 24 * 60,
  },
];

export const watchSpec = (id: WatchId): WatchSpec => WATCHES.find((w) => w.id === id) as WatchSpec;

/** A reading before it is stamped and added to its history. */
export type Reading<Id extends WatchId = WatchId> = Omit<
  Extract<WatchState, { id: Id }>,
  "at" | "height" | "history" | "error"
>;

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const level = (value: number, t: { elevated: number; alert: number }): WatchLevel =>
  value >= t.alert ? "alert" : value >= t.elevated ? "elevated" : "ok";

export function hashrateReading(pools: { name: string; blocks: number }[]): Reading<"hashrate"> {
  const blocks = pools.reduce((n, p) => n + p.blocks, 0);
  if (blocks === 0) return { id: "hashrate", status: "unknown", value: null, data: null };
  const top = [...pools].sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name));
  const share = round((100 * (top[0]?.blocks ?? 0)) / blocks);
  return {
    id: "hashrate",
    status: level(share, HASHRATE),
    value: share,
    data: {
      blocks,
      pools: top.slice(0, 8).map((p) => ({ name: p.name.slice(0, 60), blocks: p.blocks })),
    },
  };
}

export interface BlockTime {
  height: number;
  time: number;
}

/** Consecutive blocks only: a hole in the heights splits the run. */
function steps(blocks: BlockTime[]): { height: number; minutes: number }[] {
  const sorted = [...blocks].sort((a, b) => a.height - b.height);
  const out: { height: number; minutes: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as BlockTime;
    const b = sorted[i] as BlockTime;
    if (b.height === a.height + 1)
      out.push({ height: b.height, minutes: round((b.time - a.time) / 60) });
  }
  return out;
}

export function gapReading(blocks: BlockTime[]): Reading<"block-gaps"> {
  const s = steps(blocks.slice(-GAP.window - 1));
  if (!s.length) return { id: "block-gaps", status: "unknown", value: null, data: null };
  const longest = s.reduce((m, x) => (x.minutes > m.minutes ? x : m), s[0] as (typeof s)[number]);
  const sortedMin = s.map((x) => x.minutes).sort((a, b) => a - b);
  const mid = sortedMin.length >> 1;
  const median =
    sortedMin.length % 2
      ? (sortedMin[mid] as number)
      : ((sortedMin[mid - 1] as number) + (sortedMin[mid] as number)) / 2;
  return {
    id: "block-gaps",
    status: level(longest.minutes, GAP),
    value: longest.minutes,
    data: {
      from: (s[0]?.height ?? 1) - 1,
      to: s.at(-1)?.height ?? 0,
      longest,
      median: round(median),
    },
  };
}

export const PERIOD = 2016;

export function timestampReading(blocks: BlockTime[]): Reading<"timestamps"> {
  const s = steps(blocks.slice(-GAP.window - 1));
  if (!s.length) return { id: "timestamps", status: "unknown", value: null, data: null };
  const back = s
    .filter((x) => x.minutes < 0)
    .map((x) => ({ height: x.height, minutes: -x.minutes }));
  const boundary = back.filter((x) => x.height % PERIOD === 0);
  const worst = back.reduce((m, x) => Math.max(m, x.minutes), 0);
  const worstBoundary = boundary.reduce((m, x) => Math.max(m, x.minutes), 0);
  const status: WatchLevel =
    worstBoundary > STEP.alert
      ? "alert"
      : worst >= STEP.elevated || worstBoundary > STEP.boundary
        ? "elevated"
        : "ok";
  const byDepth = (a: { minutes: number }, b: { minutes: number }) => b.minutes - a.minutes;
  return {
    id: "timestamps",
    status,
    value: worst,
    data: {
      from: (s[0]?.height ?? 1) - 1,
      to: s.at(-1)?.height ?? 0,
      backward: [...back].sort(byDepth).slice(0, 12),
      boundary: [...boundary].sort(byDepth).slice(0, 12),
    },
  };
}

/** Difficulty from a header's compact target (nBits), relative to the genesis target. */
export function difficultyFromBits(bits: number): number {
  const exp = bits >>> 24;
  const mant = bits & 0x007fffff;
  const target = mant * 2 ** (8 * (exp - 3));
  const one = 0xffff * 2 ** (8 * (0x1d - 3));
  return one / target;
}

/**
 * Difficulty readings from the bits of the first block of each recent period (oldest first, at
 * heights that are multiples of 2,016) and the current period's progress.
 */
export function difficultyReading(input: {
  periods: { height: number; bits: number }[];
  /** The current period's first block's time and the tip's height and time. */
  progress: { start: number; tip: number; tipTime: number } | null;
}): Reading<"difficulty"> {
  const p = [...input.periods].sort((a, b) => a.height - b.height);
  const adjustments: { height: number; percent: number }[] = [];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1] as { height: number; bits: number };
    const b = p[i] as { height: number; bits: number };
    if (b.height !== a.height + PERIOD) continue;
    adjustments.push({
      height: b.height,
      percent: round(100 * (difficultyFromBits(b.bits) / difficultyFromBits(a.bits) - 1), 2),
    });
  }
  const last = adjustments.at(-1);
  if (!last) return { id: "difficulty", status: "unknown", value: null, data: null };
  const period = last.height;
  let projected: number | null = null;
  let minutes: number | null = null;
  const g = input.progress;
  if (g && g.tip > period) {
    const blocks = g.tip - period;
    minutes = round((g.tipTime - g.start) / 60 / blocks, 2);
    // Difficulty scales with the inverse of the time blocks took; clamped like the code does.
    const ratio = Math.min(4, Math.max(0.25, 10 / Math.max(minutes, 0.01)));
    if (blocks >= RETARGET.settle) projected = round(100 * (ratio - 1), 2);
  }
  const worst = Math.max(Math.abs(last.percent), Math.abs(projected ?? 0));
  return {
    id: "difficulty",
    status: level(worst, RETARGET),
    value: last.percent,
    data: { period, last: last.percent, projected, minutes, adjustments: adjustments.slice(-12) },
  };
}

/**
 * Reorganizations between what the brain saw before and the chain now: every height where the
 * hash it had recorded is no longer the chain's. Depth counts the replaced blocks from the fork up
 * to the old tip.
 */
export function findReorg(
  before: Record<number, string>,
  now: Record<number, string>,
): { height: number; depth: number } | null {
  const heights = Object.keys(before)
    .map(Number)
    .filter((h) => now[h] !== undefined)
    .sort((a, b) => a - b);
  const changed = heights.filter((h) => before[h] !== now[h]);
  if (!changed.length) return null;
  const fork = changed[0] as number;
  const oldTip = Math.max(...Object.keys(before).map(Number));
  return { height: fork, depth: oldTip - fork + 1 };
}

export function reorgReading(
  events: { at: string; height: number; depth: number }[],
  followed: number,
  now: string,
): Reading<"reorgs"> {
  const since = Date.parse(now) - REORG.days * 86400e3;
  const recent = events.filter((e) => Date.parse(e.at) >= since);
  const deepest = recent.reduce((m, e) => Math.max(m, e.depth), 0);
  return {
    id: "reorgs",
    status: followed === 0 ? "unknown" : level(deepest, REORG),
    value: followed === 0 ? null : deepest,
    data: { followed, events: [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 24) },
  };
}

export interface Advisory {
  source: string;
  title: string;
  url: string;
  published: string;
  severity: "low" | "medium" | "high" | "critical" | null;
}

export function advisoryReading(items: Advisory[], now: string): Reading<"advisories"> {
  const since = Date.parse(now) - ADVISORY.days * 86400e3;
  const sorted = [...items].sort((a, b) => b.published.localeCompare(a.published));
  const recent = sorted.filter((a) => Date.parse(a.published) >= since);
  const serious = recent.some((a) => a.severity === "high" || a.severity === "critical");
  return {
    id: "advisories",
    status: serious ? "alert" : recent.length ? "elevated" : "ok",
    value: recent.length,
    data: { items: sorted.slice(0, 24) },
  };
}

/** The major version a node's user agent claims, when it says it runs Bitcoin Core. */
export function coreMajor(agent: string): number | null {
  const m = /^\/Satoshi:(\d+)\.(\d+)/.exec(agent);
  if (!m) return null;
  const major = Number(m[1]);
  // Before 22.0 versions were 0.x: 0.21 is the 21st major.
  return major === 0 ? Number(m[2]) : major;
}

export function nodeVersionReading(input: {
  agents: string[];
  newest: string;
  crawled: string;
}): Reading<"node-versions"> {
  const newestMajor = Number(input.newest.split(".")[0]);
  const below = newestMajor - EOL.maintained + 1;
  const majors = input.agents.map(coreMajor).filter((m): m is number => m !== null);
  if (!majors.length) return { id: "node-versions", status: "unknown", value: null, data: null };
  const eol = majors.filter((m) => m < below).length;
  const share = round((100 * eol) / majors.length);
  return {
    id: "node-versions",
    status: level(share, EOL),
    value: share,
    data: {
      nodes: input.agents.length,
      core: majors.length,
      eol,
      below,
      newest: input.newest,
      crawled: input.crawled,
    },
  };
}

/**
 * Stamps a reading and appends it to the watch's history: a point when the value or status
 * changed, or when the last point is a day old, so the history stays short and meaningful.
 */
export function stampReading(
  previous: WatchState | undefined,
  reading: Reading,
  at: string,
  height: number | null,
): WatchState {
  const history = [...(previous?.history ?? [])];
  const last = history.at(-1);
  const stale = !last || Date.parse(at) - Date.parse(last.at) >= 86400e3;
  if (stale || last.value !== reading.value || last.status !== reading.status)
    history.push({ at, value: reading.value, status: reading.status });
  return {
    ...reading,
    at,
    height,
    history: history.slice(-WATCH_HISTORY),
  } as WatchState;
}

/** A failed reading keeps the last data and says why; after a day without data it is unknown. */
export function failedReading(
  previous: WatchState | undefined,
  id: WatchId,
  error: string,
  at: string,
): WatchState {
  if (previous) {
    const old = Date.parse(at) - Date.parse(previous.at) >= 86400e3;
    return {
      ...previous,
      status: old ? "unknown" : previous.status,
      error: error.slice(0, 200),
    };
  }
  return {
    id,
    at,
    height: null,
    status: "unknown",
    value: null,
    history: [],
    data: null,
    error: error.slice(0, 200),
  } as WatchState;
}
