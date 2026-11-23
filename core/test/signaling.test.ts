import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bipSignaling,
  bitRows,
  CHAINPARAMS,
  chainparamsDeployments,
  DEPLOYMENT_BITS,
  deploymentUrl,
  GENERAL_MASK,
  hasPrefix,
  periodStart,
  Signaling,
  setsBit,
  share,
  tallyPeriod,
} from "../src/signaling.ts";
import { PERIOD } from "../src/watch.ts";

const START = 484 * PERIOD; // 975744, the period of block 977250
const versions = (from: number, list: number[]) =>
  Object.fromEntries(list.map((v, i) => [from + i, v]));

test("BIP 9's prefix: only versions whose top three bits are 001 signal", () => {
  for (const v of [0x20000000, 0x20000002, 0x3fffffff, 0x2893a000])
    assert.ok(hasPrefix(v), v.toString(16));
  // 010, 011, 000, 111 and a negative int32: each read as all bits 0.
  for (const v of [0x40000000, 0x60000000, 0x00000004, 0x00000002, 0xe0000000, 0xa0000000, -1])
    assert.ok(!hasPrefix(v), v.toString(16));
  assert.ok(setsBit(0x20000004, 2) && !setsBit(0x20000004, 1));
  assert.ok(setsBit(0x30000000, 28), "bit 28 is read from an unsigned shift");
});

test("BIP 320's general purpose bits are 13 to 28 and never a deployment bit", () => {
  let mask = 0;
  for (let b = 13; b <= 28; b++) mask |= 1 << b;
  assert.equal(mask, GENERAL_MASK);
  assert.equal(DEPLOYMENT_BITS, 13);
  // bit 13, bits 13 to 28, bit 12 and bit 0
  const t = tallyPeriod({
    start: START,
    through: START + 3,
    versions: versions(START, [0x20002000, 0x3fffe000, 0x20001000, 0x20000001]),
  });
  assert.equal(t.general, 2, "the two blocks rolling bits 13 to 28");
  assert.equal(t.bits[12], 1, "bit 12 is a deployment bit");
  assert.equal(t.bits[0], 1);
  assert.equal(
    t.bits.reduce((n, x) => n + x, 0),
    2,
    "no general purpose bit lands in the per-bit counts",
  );
});

test("a version without the prefix counts as unprefixed and none of its bits count", () => {
  const t = tallyPeriod({
    start: START,
    through: START + 2,
    // version 2 sets bit 1 and 0x40002000 sets bit 13, both without top bits 001
    versions: versions(START, [0x00000002, 0x40002000, 0x20000000]),
  });
  assert.equal(t.blocks, 3);
  assert.equal(t.prefixed, 1);
  assert.equal(t.unprefixed, 2);
  assert.equal(t.bits[1], 0);
  assert.equal(t.general, 0);
});

test("a partial period counts its first block through the tip, and refuses a gap", () => {
  const list = Array.from({ length: 10 }, (_, i) => (i % 2 ? 0x20000004 : 0x20000000));
  const t = tallyPeriod({ start: START, through: START + 9, versions: versions(START, list) });
  assert.deepEqual(
    { blocks: t.blocks, end: t.end, prefixed: t.prefixed, bit2: t.bits[2] },
    { blocks: 10, end: START + PERIOD - 1, prefixed: 10, bit2: 5 },
  );
  const holed = versions(START, list);
  delete holed[START + 4];
  assert.throws(
    () => tallyPeriod({ start: START, through: START + 9, versions: holed }),
    /no version for block 975748/,
  );
});

test("a period runs from a multiple of 2016 to the block before the next", () => {
  assert.equal(periodStart(START), START);
  assert.equal(periodStart(START - 1), START - PERIOD);
  assert.equal(periodStart(START + PERIOD - 1), START);
  const full = versions(
    START - PERIOD,
    Array.from({ length: PERIOD }, () => 0x20000000),
  );
  const t = tallyPeriod({ start: START - PERIOD, through: START - 1, versions: full });
  assert.equal(t.blocks, PERIOD);
  assert.equal(t.through, t.end);
  assert.throws(
    () => tallyPeriod({ start: START - PERIOD, through: START, versions: full }),
    /not in the period/,
  );
  assert.throws(() => tallyPeriod({ start: START + 1, through: START + 1, versions: full }));
});

const tip = { height: START + 1506, hash: "0".repeat(64), time: "2026-11-23T09:00:00Z" };
function signaling(currentBits: number[], previousBits: number[] | null): Signaling {
  const cur = Array.from(
    { length: 1507 },
    (_, i) => (i < 40 ? (currentBits[i % currentBits.length] ?? 0) : 0) | 0x20000000,
  );
  const prev = previousBits
    ? Array.from(
        { length: PERIOD },
        (_, i) => (i < 20 ? (previousBits[i % previousBits.length] ?? 0) : 0) | 0x20000000,
      )
    : null;
  return Signaling.parse({
    updated: "2026-11-23T09:05:00Z",
    tip,
    current: tallyPeriod({ start: START, through: tip.height, versions: versions(START, cur) }),
    previous: prev
      ? tallyPeriod({
          start: START - PERIOD,
          through: START - 1,
          versions: versions(START - PERIOD, prev),
        })
      : null,
  });
}

test("the file must hold the tip's period to the tip and the complete period before it", () => {
  const s = signaling([0], null);
  assert.ok(Signaling.safeParse({ ...s, tip: { ...s.tip, height: tip.height + 1 } }).error);
  const prev = signaling([0], [0]).previous;
  assert.ok(prev);
  assert.ok(
    Signaling.safeParse({
      ...s,
      previous: {
        ...prev,
        start: prev.start - PERIOD,
        end: prev.end - PERIOD,
        through: prev.through - PERIOD,
      },
    }).error,
    "a previous period that is not the one before",
  );
  assert.ok(Signaling.safeParse({ ...s, previous: prev }).success);
});

test("rows: one per deployment bit any block set this period or the last, with shares", () => {
  assert.deepEqual(bitRows(signaling([0], null)), [], "no block set a deployment bit");
  const rows = bitRows(signaling([1 << 1, 1 << 4], [1 << 4, 1 << 7]));
  assert.deepEqual(
    rows.map((r) => [r.bit, r.current.blocks, r.current.share, r.previous?.blocks]),
    [
      [1, 20, 1.3, 0],
      [4, 20, 1.3, 10],
      [7, 0, 0, 10],
    ],
  );
  assert.equal(share(3, 1507), 0.2);
  assert.equal(share(0, 0), 0);
  // Bitcoin Core v32.1 defines no deployment on bits 0 to 12, so no row carries a name.
  assert.ok(rows.every((r) => r.deployment === null));
});

test("deployment names come only from chainparams at its pinned commit", () => {
  assert.match(CHAINPARAMS.commit, /^[0-9a-f]{40}$/);
  const { onDeploymentBits, other } = chainparamsDeployments();
  assert.deepEqual(onDeploymentBits, []);
  assert.deepEqual(
    other.map((d) => [d.name, d.bit]),
    [["DEPLOYMENT_TESTDUMMY", 28]],
  );
  const url = deploymentUrl(other[0] as (typeof other)[number]);
  assert.equal(
    url,
    `https://github.com/bitcoin/bitcoin/blob/${CHAINPARAMS.commit}/src/kernel/chainparams.cpp#L132-L137`,
  );
});

test("a BIP page shows the tally for BIP 9 and BIP 320, a deployment's row, or nothing", () => {
  const s = signaling([1 << 1], null);
  assert.deepEqual(bipSignaling(9, s), { scheme: true, deployments: [] });
  assert.deepEqual(bipSignaling(320, s), { scheme: true, deployments: [] });
  assert.equal(bipSignaling(341, s), null, "Taproot is buried, no deployment in chainparams");
  assert.equal(bipSignaling(9, null), null, "nothing before the brain has counted");
});
