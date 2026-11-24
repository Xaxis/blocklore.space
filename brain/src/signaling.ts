// The version bits (BACKLOG 16; core/src/signaling.ts counts them): every block's version in the
// tip's difficulty period, read by the security watches' block following
// (brain/src/security/watches.ts), so there is one chain reader, one hourly step and one commit.
// Both explorers must agree on each version, as on each hash, time and target.
//
// The first fill reads the whole period once: up to 135 requests to mempool.space and 202 to
// blockstream.info at one a second per host, side by side (measured in features/proposals.md);
// pages more than 100 blocks deep are cached for a year. The hourly step spends about a minute of
// it at most under the tick lock and goes on the next hour; the file is written only once every
// block of the period up to the tip is read. After that a run reads only the new blocks the
// watches' sync already lists.
//
//   knowledge/chain/signaling.json   the tip's period so far and the last one that ended
//   pnpm brain signaling             reads both explorers and prints the tally, writing nothing
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  bitRows,
  Chainparams,
  chainparamsDeployments,
  DEPLOYMENT_BITS,
  PERIOD,
  type PeriodTally,
  periodStart,
  SIGNALING_SOURCE,
  Signaling,
  share,
  tallyPeriod,
} from "@blocklore/core";
import { KNOWLEDGE } from "./env.ts";

export const SIGNALING_FILE = () =>
  process.env.BLOCKLORE_SIGNALING_FILE || path.join(KNOWLEDGE, "chain", "signaling.json");

/** Bitcoin Core's mainnet deployments as the brain last read them (brain/src/chainparams.ts). */
export const CHAINPARAMS_FILE = () =>
  process.env.BLOCKLORE_CHAINPARAMS_FILE || path.join(KNOWLEDGE, "chain", "chainparams.json");

export function readChainparams(): Chainparams | null {
  const f = CHAINPARAMS_FILE();
  return existsSync(f) ? Chainparams.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
}

/** Seconds a run spends filling in the period's versions before it leaves the rest for later. */
export const FILL_SECONDS = 60;
/** Blocks read at a time: 10 whole pages of mempool.space's 15 and 15 of blockstream.info's 10. */
const CHUNK = 150;

/** What the watches' followed state keeps for the version bits (var/security/blocks.json). */
export interface VersionState {
  /** Each block's version by height, from the first block of the period before the tip's. */
  versions?: Record<string, number>;
  /** The last period that ended with every version read. */
  lastPeriod?: PeriodTally | null;
}

/** A block as both explorers listed it and agreed on. */
export interface ReadBlock {
  id: string;
  height: number;
  timestamp: number;
  version: number;
}

/** Reads blocks `from` to `to`, both explorers agreeing (the watches' `blocksBetween`). */
export type VersionReader = (from: number, to: number) => Promise<ReadBlock[]>;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d+Z$/, "Z");

/** Keeps the versions of blocks just read, from the period before the tip's on. */
export function keepVersions(s: VersionState, blocks: ReadBlock[], tip: number) {
  const from = periodStart(tip) - PERIOD;
  s.versions ??= {};
  for (const b of blocks) if (b.height >= from) s.versions[b.height] = b.version;
}

const known = (v: Record<string, number>, from: number, to: number) => {
  for (let h = from; h <= to; h++) if (v[h] === undefined) return false;
  return true;
};

/**
 * Heights still to read, as ranges: the gaps in the tip's period, then in the one before while the
 * brain followed some of it and has not tallied it (after a pause, or a first run near a boundary).
 */
export function missingRanges(s: VersionState, tip: number): [number, number][] {
  const start = periodStart(tip);
  const prev = start - PERIOD;
  const v = s.versions ?? {};
  const out: [number, number][] = [];
  const scan = (from: number, to: number) => {
    let open: number | null = null;
    for (let h = from; h <= to + 1; h++) {
      const gap = h <= to && v[h] === undefined;
      if (gap && open === null) open = h;
      if (!gap && open !== null) {
        out.push([open, h - 1]);
        open = null;
      }
    }
  };
  scan(start, tip);
  const followed = Object.keys(v).some((h) => Number(h) >= prev && Number(h) < start);
  if (prev >= 0 && s.lastPeriod?.start !== prev && followed) scan(prev, start - 1);
  return out;
}

/** Splits ranges at multiples of CHUNK, so each read asks whole pages of both explorers. */
function chunks(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [from, to] of ranges)
    for (let a = from; a <= to; ) {
      const b = Math.min(to, a - (a % CHUNK) + CHUNK - 1);
      out.push([a, b]);
      a = b + 1;
    }
  return out;
}

/**
 * Reads the missing versions a chunk at a time until none is missing or `seconds` have passed
 * (a chunk under way finishes). Returns how many it read and how many are still missing.
 */
export async function fillVersions(
  s: VersionState,
  tip: number,
  read: VersionReader,
  seconds = FILL_SECONDS,
  clock: () => number = Date.now,
): Promise<{ read: number; left: number }> {
  const started = clock();
  let count = 0;
  for (const [a, b] of chunks(missingRanges(s, tip))) {
    if (clock() - started >= seconds * 1000) break;
    const blocks = await read(a, b);
    s.versions ??= {};
    for (const x of blocks) s.versions[x.height] = x.version;
    count += blocks.length;
  }
  const left = missingRanges(s, tip).reduce((n, [a, b]) => n + b - a + 1, 0);
  return { read: count, left };
}

/**
 * Tallies the period before the tip's once every version in it is read, and forgets the versions
 * no tally needs any more.
 */
export function settlePeriods(s: VersionState, tip: number) {
  const start = periodStart(tip);
  const prev = start - PERIOD;
  s.versions ??= {};
  if (prev >= 0 && s.lastPeriod?.start !== prev && known(s.versions, prev, start - 1))
    s.lastPeriod = tallyPeriod({ start: prev, through: start - 1, versions: s.versions });
  const keep = s.lastPeriod?.start === prev ? start : prev;
  for (const h of Object.keys(s.versions)) if (Number(h) < keep) delete s.versions[h];
}

/** The file's content once every block of the tip's period is read; null until then. */
export function signalingOf(
  s: VersionState & { blocks: Record<string, { hash: string; time: number }> },
  tip: number,
  now: string,
): Signaling | null {
  const start = periodStart(tip);
  const block = s.blocks[tip];
  if (!block || !known(s.versions ?? {}, start, tip)) return null;
  return Signaling.parse({
    updated: now,
    tip: { height: tip, hash: block.hash, time: iso(block.time) },
    current: tallyPeriod({ start, through: tip, versions: s.versions ?? {} }),
    previous: s.lastPeriod?.start === start - PERIOD ? s.lastPeriod : null,
  });
}

/**
 * The hourly step, called by the watches once their sync has read the newest blocks: fills in the
 * period (a minute at most), tallies, and writes the file when the period is read to the tip.
 */
export async function recordSignaling(
  s: VersionState & { blocks: Record<string, { hash: string; time: number }> },
  tip: number,
  read: VersionReader,
  now: string,
  seconds = FILL_SECONDS,
): Promise<{ written: boolean; note: string }> {
  const started = Date.now();
  const filled = await fillVersions(s, tip, read, seconds);
  const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
  settlePeriods(s, tip);
  const out = signalingOf(s, tip, now);
  if (!out)
    return {
      written: false,
      note: `read ${filled.read} block versions in ${took}, ${filled.left} still to read on the next run`,
    };
  mkdirSync(path.dirname(SIGNALING_FILE()), { recursive: true });
  writeFileSync(SIGNALING_FILE(), `${JSON.stringify(out, null, 1)}\n`);
  return {
    written: true,
    note: `period from ${out.current.start}, ${out.current.blocks} of ${PERIOD} blocks to ${tip}; read ${filled.read} block versions in ${took}`,
  };
}

const pct = (n: number, of: number) => `${n}`.padStart(5) + `${share(n, of)}%`.padStart(8);

/** The tally as lines for a terminal. */
export function describe(s: Signaling, cp: Chainparams | null): string[] {
  const period = (t: PeriodTally, label: string) => {
    const rows = bitRows(s, cp).map((r) => ({
      bit: r.bit,
      n: label === "this" ? r.current.blocks : (r.previous?.blocks ?? 0),
    }));
    return [
      `  BIP 9 prefix (top bits 001)            ${pct(t.prefixed, t.blocks)}`,
      ...(rows.some((r) => r.n > 0)
        ? rows.map((r) => `  bit ${String(r.bit).padEnd(35)}${pct(r.n, t.blocks)}`)
        : [`  no block set a deployment bit (0 to ${DEPLOYMENT_BITS - 1})`]),
      `  BIP 320 bits 13 to 28 (not a signal)   ${pct(t.general, t.blocks)}`,
      `  without the prefix                     ${pct(t.unprefixed, t.blocks)}`,
    ];
  };
  const c = s.current;
  const { onDeploymentBits, other } = chainparamsDeployments(cp);
  return [
    `Version bits, period ${c.start} to ${c.end}: ${c.blocks} of ${PERIOD} blocks so far, as of block ${s.tip.height} (${s.tip.time}, ${s.tip.hash})`,
    ...period(c, "this"),
    ...(s.previous
      ? [
          `Last period, ${s.previous.start} to ${s.previous.end}, all ${PERIOD} blocks:`,
          ...period(s.previous, "last"),
        ]
      : ["Last period: not followed yet"]),
    `${
      cp
        ? `Deployments in Bitcoin Core ${cp.release}'s mainnet chainparams (${cp.commit.slice(0, 10)})`
        : "Deployments: chainparams not read yet (pnpm brain bips)"
    }: ${
      onDeploymentBits.length
        ? onDeploymentBits.map((d) => `${d.name} on bit ${d.bit}`).join(", ")
        : `none on bits 0 to ${DEPLOYMENT_BITS - 1}`
    }${other.length ? `; ${other.map((d) => `${d.name} on bit ${d.bit}, start ${d.start}`).join("; ")}` : ""}`,
    `${SIGNALING_SOURCE}.`,
  ];
}

/**
 * `pnpm brain signaling`: the tally now, read from both explorers on top of what the watches have
 * followed, printed and never written (neither the followed state nor the file).
 */
export async function signalingCommand(
  chain: {
    tip: () => Promise<number>;
    blocks: (from: number, to: number, deep: number) => Promise<ReadBlock[]>;
    followed: VersionState & { blocks: Record<string, { hash: string; time: number }> };
    /** Bitcoin Core's newest release, to say when the chainparams read are behind it. */
    newest?: () => string;
  },
  log: (line: string) => void = console.log,
): Promise<number> {
  const started = Date.now();
  const t = await chain.tip();
  const s = chain.followed;
  const seen = Object.keys(s.blocks)
    .map(Number)
    .filter((h) => h <= t);
  // The newest blocks, from the 6 before the newest the watches saw, as their sync reads them.
  const from = Math.max(periodStart(t), Math.min(seen.length ? Math.max(...seen) - 5 : t, t));
  const fresh = await chain.blocks(from, t, t);
  for (const b of fresh) s.blocks[b.height] = { hash: b.id, time: b.timestamp };
  keepVersions(s, fresh, t);
  const filled = await fillVersions(
    s,
    t,
    (a, b) => chain.blocks(a, b, t),
    Number.POSITIVE_INFINITY,
  );
  settlePeriods(s, t);
  const out = signalingOf(s, t, iso(Date.now() / 1000));
  if (!out) throw new Error(`the period to block ${t} could not be read in full`);
  const cp = readChainparams();
  for (const line of describe(out, cp)) log(line);
  const newest = chain.newest?.();
  if (newest && `v${newest}` !== cp?.release)
    log(
      `Bitcoin Core's newest release is v${newest}, the chainparams read are ${cp?.release ?? "none"}'s: the hourly chainparams step reads v${newest}'s.`,
    );
  log(
    `Read ${fresh.length + filled.read} block versions in ${((Date.now() - started) / 1000).toFixed(1)} s; wrote nothing.`,
  );
  return 0;
}
