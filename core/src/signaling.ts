// Version-bit signaling (BACKLOG 16): which bits the blocks of a difficulty period set in their
// version, counted from each block's version alone. Counts and shares only: Blocklore reports
// parameters, signaling and stated plans, never whether a proposal will activate
// (core/src/evaluate.ts; EDITORIAL.md, "No predicted outcomes"). The brain reads the versions with
// the security watches' block following (brain/src/signaling.ts); this file only counts, so the
// same versions always give the same tally.
//
// The rules, each from its primary source (bitcoin/bips at the commit knowledge/bips.json was
// read at, fdcd8024595bc1e97db73883e716dbb91627c371):
//
// - BIP 9, "Bit flags" (https://github.com/bitcoin/bips/blob/fdcd8024595bc1e97db73883e716dbb91627c371/bip-0009.mediawiki):
//   "The top 3 bits of such blocks must be 001", and "When a block nVersion does not have top bits
//   001, it is treated as if all bits are 0 for the purposes of deployments." Its pseudocode counts
//   a block for `bit` when `walk.nVersion & 0xE0000000 == 0x20000000 && (walk.nVersion >> bit) & 1
//   == 1`, and a deployment's bit "is chosen from the set {0,1,2,...,28}". It counts 2016 blocks a
//   retarget period: PERIOD in core/src/watch.ts.
// - BIP 320, "Specification" (https://github.com/bitcoin/bips/blob/fdcd8024595bc1e97db73883e716dbb91627c371/bip-0320.mediawiki):
//   "Sixteen bits from the block header nVersion field, starting from 13 and ending at 28
//   inclusive (0x1fffe000), are reserved for general use and removed from BIP8 and BIP9
//   specifications." Blocks that set them are counted, and never shown as signaling.
// - Bitcoin Core's mainnet deployments: CHAINPARAMS below.
//
// Pure: no clock and no randomness; heights and versions come in as arguments.
import { z } from "zod";
import { PERIOD } from "./watch.ts";

/** BIP 9: a version signals only when `version & PREFIX_MASK` is `PREFIX` (top bits 001). */
export const PREFIX_MASK = 0xe0000000;
export const PREFIX = 0x20000000;
/** BIP 320: bits 13 to 28, reserved for general use (version rolling), never a signal. */
export const GENERAL_MASK = 0x1fffe000;
/** Bits 0 to 12: the bits BIP 320 leaves to soft fork deployments. */
export const DEPLOYMENT_BITS = 13;

/** Whether a block version carries BIP 9's prefix, the top three bits 001. */
export const hasPrefix = (version: number): boolean => (version & PREFIX_MASK) === PREFIX;

/** Whether a version sets bit `bit` (0 is the lowest). */
export const setsBit = (version: number, bit: number): boolean => ((version >>> bit) & 1) === 1;

/** The first height of the difficulty period holding `height`. */
export const periodStart = (height: number): number => height - (height % PERIOD);

/**
 * Bitcoin Core's mainnet version bits deployments, read from src/kernel/chainparams.cpp at the
 * newest release when this was written, v32.1 (tag object 94f59fa4, commit f0de87f0). Lines 132 to
 * 137 of CMainParams define one: `consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].bit =
 * 28;` with `nStartTime = Consensus::BIP9Deployment::NEVER_ACTIVE;`, and src/consensus/params.h's
 * `enum DeploymentPos` lists no other. Master (dbe9eacd, 2026-11-23) defines the same. A
 * deployment's name is shown beside its bit only from this list; update the pin, with the lines,
 * when a release defines a new one (features/proposals.md says how to check).
 */
export const CHAINPARAMS = {
  release: "v32.1",
  commit: "f0de87f040621468b956f01f526a43a010310501",
  file: "src/kernel/chainparams.cpp",
  deployments: [
    {
      /** The enumerator chainparams.cpp names it by, quoted. */
      name: "DEPLOYMENT_TESTDUMMY",
      bit: 28,
      /** BIPs that define it, as chainparams.cpp's own comment names them; none here. */
      bips: [] as number[],
      /** Its start time as chainparams.cpp writes it, quoted. */
      start: "Consensus::BIP9Deployment::NEVER_ACTIVE",
      lines: [132, 137] as const,
    },
  ],
};
export type Deployment = (typeof CHAINPARAMS)["deployments"][number];

/** A deployment's lines in chainparams.cpp at the pinned commit. */
export const deploymentUrl = (d: Deployment): string =>
  `https://github.com/bitcoin/bitcoin/blob/${CHAINPARAMS.commit}/${CHAINPARAMS.file}#L${d.lines[0]}-L${d.lines[1]}`;

const Count = z.number().int().min(0).max(PERIOD);
const Height = z.number().int().min(0);

/** One difficulty period's tally, from its first block through `through`. */
export const PeriodTally = z
  .strictObject({
    /** The period's first and last heights. */
    start: Height,
    end: Height,
    /** The newest block counted. */
    through: Height,
    /** Blocks counted: `start` through `through`. */
    blocks: z.number().int().min(1).max(PERIOD),
    /** Blocks whose version carries BIP 9's prefix (top bits 001). */
    prefixed: Count,
    /** Per bit 0 to 12: prefixed blocks that set it. */
    bits: z.array(Count).length(DEPLOYMENT_BITS),
    /** Prefixed blocks that set any of BIP 320's general purpose bits, 13 to 28. */
    general: Count,
    /** Blocks whose version lacks the prefix: BIP 9 reads every bit of them as 0. */
    unprefixed: Count,
  })
  .superRefine((t, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (t.start % PERIOD !== 0) bad(`start ${t.start} is not the first block of a period`);
    if (t.end !== t.start + PERIOD - 1) bad("end is not the period's last block");
    if (t.through < t.start || t.through > t.end) bad("through is outside the period");
    if (t.blocks !== t.through - t.start + 1) bad("blocks is not the count from start to through");
    if (t.prefixed + t.unprefixed !== t.blocks) bad("prefixed and unprefixed do not add up");
    if (t.general > t.prefixed || t.bits.some((n) => n > t.prefixed))
      bad("a bit is counted on more blocks than carry the prefix");
  });
export type PeriodTally = z.infer<typeof PeriodTally>;

const isoTime = z.iso.datetime({ offset: false });

/** knowledge/chain/signaling.json: the tip's period so far and the last period that ended. */
export const Signaling = z
  .strictObject({
    /** When the brain last read the blocks. */
    updated: isoTime,
    /** The newest block counted, as both explorers listed it. */
    tip: z.strictObject({
      height: Height,
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      time: isoTime,
    }),
    current: PeriodTally,
    /** The period before the tip's, every block read; null until the brain has followed one. */
    previous: PeriodTally.nullable(),
  })
  .superRefine((s, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (s.current.through !== s.tip.height) bad("the current period is not counted to the tip");
    if (s.current.start !== periodStart(s.tip.height)) bad("current is not the tip's period");
    if (s.previous && s.previous.start !== s.current.start - PERIOD)
      bad("previous is not the period before the tip's");
    if (s.previous && s.previous.through !== s.previous.end) bad("previous is not complete");
  });
export type Signaling = z.infer<typeof Signaling>;

/** Where the versions come from, in plain words. */
export const SIGNALING_SOURCE =
  "Block versions from mempool.space and blockstream.info, which must agree on every block";

/**
 * Tallies the period starting at `start` from its first block through `through`, given every
 * block's version by height. Throws when a version is missing: a partial count would mislead.
 */
export function tallyPeriod(input: {
  start: number;
  through: number;
  versions: Readonly<Record<number, number>>;
}): PeriodTally {
  const { start, through, versions } = input;
  if (start % PERIOD !== 0) throw new Error(`${start} is not the first block of a period`);
  if (through < start || through >= start + PERIOD)
    throw new Error(`${through} is not in the period from ${start}`);
  const bits = new Array<number>(DEPLOYMENT_BITS).fill(0);
  let prefixed = 0;
  let general = 0;
  for (let h = start; h <= through; h++) {
    const v = versions[h];
    if (v === undefined || !Number.isInteger(v)) throw new Error(`no version for block ${h}`);
    if (!hasPrefix(v)) continue;
    prefixed++;
    for (let b = 0; b < DEPLOYMENT_BITS; b++) if (setsBit(v, b)) bits[b] = (bits[b] ?? 0) + 1;
    if ((v & GENERAL_MASK) !== 0) general++;
  }
  const blocks = through - start + 1;
  return PeriodTally.parse({
    start,
    end: start + PERIOD - 1,
    through,
    blocks,
    prefixed,
    bits,
    general,
    unprefixed: blocks - prefixed,
  });
}

/** A count as a percentage of the blocks counted, to one decimal. */
export const share = (count: number, blocks: number): number =>
  blocks > 0 ? Math.round((1000 * count) / blocks) / 10 : 0;

/** One deployment bit as a page or an answer shows it. */
export interface BitRow {
  bit: number;
  /** Blocks this period that set it, and their share of the blocks so far. */
  current: { blocks: number; share: number };
  /** The same over the last period, when it is known. */
  previous: { blocks: number; share: number } | null;
  /** The deployment Bitcoin Core's mainnet parameters define on this bit, if any (CHAINPARAMS). */
  deployment: { name: string; url: string; start: string } | null;
}

const deploymentOn = (bit: number) => {
  const d = CHAINPARAMS.deployments.find((x) => x.bit === bit);
  return d ? { name: d.name, url: deploymentUrl(d), start: d.start } : null;
};

const row = (s: Signaling, bit: number): BitRow => ({
  bit,
  current: {
    blocks: s.current.bits[bit] ?? 0,
    share: share(s.current.bits[bit] ?? 0, s.current.blocks),
  },
  previous: s.previous
    ? {
        blocks: s.previous.bits[bit] ?? 0,
        share: share(s.previous.bits[bit] ?? 0, s.previous.blocks),
      }
    : null,
  deployment: deploymentOn(bit),
});

/** A row per bit 0 to 12 that any block set this period or the last, lowest bit first. */
export function bitRows(s: Signaling): BitRow[] {
  const out: BitRow[] = [];
  for (let b = 0; b < DEPLOYMENT_BITS; b++)
    if ((s.current.bits[b] ?? 0) > 0 || (s.previous?.bits[b] ?? 0) > 0) out.push(row(s, b));
  return out;
}

/** Deployments that chainparams defines on bits 0 to 12, and those it defines on other bits. */
export function chainparamsDeployments(): { onDeploymentBits: Deployment[]; other: Deployment[] } {
  return {
    onDeploymentBits: CHAINPARAMS.deployments.filter((d) => d.bit < DEPLOYMENT_BITS),
    other: CHAINPARAMS.deployments.filter((d) => d.bit >= DEPLOYMENT_BITS),
  };
}

/** The BIPs that define version bits themselves: BIP 9's prefix and bits, BIP 320's reserve. */
export const VERSION_BITS_BIPS = [9, 320] as const;

/**
 * What BIP `n`'s page shows of the signaling: the whole tally for BIP 9 and BIP 320, which define
 * the bits; the row of each deployment chainparams defines for the BIP; otherwise nothing.
 */
export function bipSignaling(
  n: number,
  s: Signaling | null,
): { scheme: boolean; deployments: BitRow[] } | null {
  if (!s) return null;
  const scheme = (VERSION_BITS_BIPS as readonly number[]).includes(n);
  const deployments = CHAINPARAMS.deployments
    .filter((d) => d.bips.includes(n) && d.bit < DEPLOYMENT_BITS)
    .map((d) => row(s, d.bit));
  return scheme || deployments.length ? { scheme, deployments } : null;
}
