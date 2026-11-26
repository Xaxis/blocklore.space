import assert from "node:assert/strict";
import { test } from "node:test";
import type { WatchState } from "../src/security.ts";
import {
  advisoryReading,
  coreMajor,
  difficultyFromBits,
  difficultyReading,
  failedReading,
  findReorg,
  gapReading,
  hashrateReading,
  nodeVersionReading,
  reorgReading,
  stampReading,
  timestampReading,
  WATCHES,
} from "../src/watch.ts";

/** Consecutive blocks from `start`, each `minutes` after the last unless overridden by height. */
function chain(start: number, n: number, minutes = 10, at: Record<number, number> = {}) {
  const out: { height: number; time: number }[] = [];
  let t = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    const h = start + i;
    t += (at[h] ?? minutes) * 60;
    out.push({ height: h, time: t });
  }
  return out;
}

test("every watch is documented with a title, a unit, thresholds and a source", () => {
  for (const w of WATCHES) {
    assert.ok(w.title.length > 3 && w.measures.length > 10, w.id);
    assert.ok(/\d/.test(w.thresholds), `${w.id} names its numbers`);
    assert.ok(w.source.length > 5 && w.every > 0, w.id);
  }
});

test("pool concentration: elevated at 30 percent, alert at 40, unknown without blocks", () => {
  const pools = (top: number) => [
    { name: "Big", blocks: top },
    { name: "Rest", blocks: 1000 - top },
  ];
  // "Rest" is one name here, so keep it below "Big" by splitting it.
  const split = (top: number) => [
    { name: "Big", blocks: top },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, blocks: (1000 - top) / 10 })),
  ];
  assert.equal(hashrateReading(split(299)).status, "ok");
  assert.equal(hashrateReading(split(300)).status, "elevated");
  assert.equal(hashrateReading(split(400)).status, "alert");
  assert.equal(hashrateReading(split(400)).value, 40);
  assert.equal(hashrateReading(pools(400)).value, 60, "the largest pool counts, whatever its name");
  assert.equal(hashrateReading([]).status, "unknown");
});

test("block gaps: elevated at 90 minutes, alert at 180, and a hole in the heights is no gap", () => {
  assert.equal(gapReading(chain(1000, 145, 10, { 1050: 89 })).status, "ok");
  const elevated = gapReading(chain(1000, 145, 10, { 1050: 90 }));
  assert.equal(elevated.status, "elevated");
  assert.deepEqual(elevated.data?.longest, { height: 1050, minutes: 90 });
  assert.equal(gapReading(chain(1000, 145, 10, { 1050: 180 })).status, "alert");
  const holed = chain(1000, 145).filter((b) => b.height !== 1050);
  holed.forEach((b) => {
    if (b.height > 1050) b.time += 500 * 60;
  });
  assert.equal(gapReading(holed).status, "ok");
  assert.equal(gapReading([]).status, "unknown");
});

test("timestamps: a step back at a period boundary is the time warp signature", () => {
  // Height 2016 * 500 = 1,008,000 starts a difficulty period.
  const b = 1_008_000;
  assert.equal(timestampReading(chain(b - 50, 100)).status, "ok");
  assert.equal(timestampReading(chain(b - 50, 100, 10, { [b - 10]: -61 })).status, "elevated");
  assert.equal(timestampReading(chain(b - 50, 100, 10, { [b]: -11 })).status, "elevated");
  const warp = timestampReading(chain(b - 50, 100, 10, { [b]: -121 }));
  assert.equal(warp.status, "alert");
  assert.deepEqual(warp.data?.boundary, [{ height: b, minutes: 121 }]);
  // The same step back away from a boundary is odd, not a time warp.
  assert.equal(timestampReading(chain(b - 50, 100, 10, { [b - 10]: -59 })).status, "ok");
});

test("difficulty: adjustments from compact targets, elevated at 15 percent, alert at 25", () => {
  assert.equal(difficultyFromBits(0x1d00ffff), 1);
  assert.ok(Math.abs(difficultyFromBits(0x1c7fff80) - 2) < 1e-6);
  const r = difficultyReading({
    periods: [
      { height: 2016 * 10, bits: 0x1d00ffff },
      { height: 2016 * 11, bits: 0x1c7fff80 },
    ],
    progress: null,
  });
  assert.equal(r.value, 100);
  assert.equal(r.status, "alert");
  const steady = difficultyReading({
    periods: [
      { height: 2016 * 10, bits: 0x1d00ffff },
      { height: 2016 * 11, bits: 0x1d00ffff },
    ],
    // 600 blocks in at 8 minutes a block: on course for +25 percent.
    progress: { start: 0, tip: 2016 * 11 + 600, tipTime: 600 * 8 * 60 },
  });
  assert.equal(steady.data?.projected, 25);
  assert.equal(steady.status, "alert");
  const early = difficultyReading({
    periods: [
      { height: 2016 * 10, bits: 0x1d00ffff },
      { height: 2016 * 11, bits: 0x1d00ffff },
    ],
    progress: { start: 0, tip: 2016 * 11 + 100, tipTime: 100 * 8 * 60 },
  });
  assert.equal(early.data?.projected, null, "too early in the period to project");
  assert.equal(early.status, "ok");
});

test("reorgs: the depth counts replaced blocks; one block is normal, two elevated, three alert", () => {
  const before = { 100: "a", 101: "b", 102: "c" };
  assert.equal(findReorg(before, { 100: "a", 101: "b", 102: "c", 103: "d" }), null);
  assert.deepEqual(findReorg(before, { 100: "a", 101: "b", 102: "x" }), { height: 102, depth: 1 });
  assert.deepEqual(findReorg(before, { 100: "a", 101: "y", 102: "x" }), { height: 101, depth: 2 });
  const now = "2026-11-21T00:00:00Z";
  const ev = (depth: number, at = now) => ({ at, height: 100, depth });
  assert.equal(reorgReading([ev(1)], 160, now).status, "ok");
  assert.equal(reorgReading([ev(2)], 160, now).status, "elevated");
  assert.equal(reorgReading([ev(3)], 160, now).status, "alert");
  assert.equal(reorgReading([ev(3, "2026-10-01T00:00:00Z")], 160, now).status, "ok", "old news");
  assert.equal(reorgReading([], 0, now).status, "unknown");
});

test("advisories: elevated while one is under 30 days old, alert when it is high or critical", () => {
  const now = "2026-11-21T00:00:00Z";
  const a = (published: string, severity: "low" | "high" | null) => ({
    source: "Bitcoin Core",
    title: "CVE-2026-1 - x",
    url: "https://bitcoincore.org/en/2026/11/20/disclose-x/",
    published,
    severity,
  });
  assert.equal(advisoryReading([a("2026-09-01T00:00:00Z", "high")], now).status, "ok");
  assert.equal(advisoryReading([a("2026-11-20T00:00:00Z", "low")], now).status, "elevated");
  assert.equal(advisoryReading([a("2026-11-20T00:00:00Z", null)], now).value, 1);
  assert.equal(advisoryReading([a("2026-11-20T00:00:00Z", "high")], now).status, "alert");
});

test("node versions: the share of Core nodes on a major version past end of life", () => {
  assert.equal(coreMajor("/Satoshi:0.21.1/"), 21);
  assert.equal(coreMajor("/Satoshi:32.1.0/"), 32);
  assert.equal(coreMajor("/btcd:0.24.2/"), null);
  const now = "2026-11-26T12:00:00Z";
  const bitnodes = {
    source: "bitnodes" as const,
    agents: [
      ["/Satoshi:32.1.0/", 70],
      ["/Satoshi:30.0.0/", 10],
      ["/Satoshi:29.2.0/", 20],
      ["/btcd:0.24.2/", 1],
    ] as const,
    crawled: "2026-11-26T02:41:22Z",
  };
  const one = nodeVersionReading({ crawls: [bitnodes], newest: "32.1", now });
  // 32, 31 and 30 are maintained; 29 is past end of life.
  assert.equal(one.data?.below, 30);
  assert.equal(one.value, 20);
  assert.equal(one.status, "elevated");
  assert.equal(one.data?.core, 100);
  assert.equal(one.data?.nodes, 101);

  // A second crawl that puts more past end of life does not raise the watch: the lower share
  // counts, and both are kept. 0.21 is the 21st major.
  const dashjr = {
    source: "dashjr" as const,
    agents: [
      ["/Satoshi:32.1.0/", 40],
      ["/Satoshi:0.21.1/", 60],
    ] as const,
    crawled: "2026-11-26T12:00:10Z",
  };
  const two = nodeVersionReading({
    crawls: [bitnodes, dashjr],
    newest: "32.1",
    now: "2026-11-26T12:30:00Z",
  });
  assert.equal(two.value, 20);
  assert.equal(two.status, "elevated", "60% in one crawl alone would be an alert");
  assert.equal(two.data?.crawled, bitnodes.crawled);
  assert.deepEqual(
    two.data?.crawls?.map((c) => [c.source, c.share, c.core, c.eol]),
    [
      ["bitnodes", 20, 100, 20],
      ["dashjr", 60, 100, 60],
    ],
  );
  // When both say so, it is an alert.
  const both = nodeVersionReading({
    crawls: [{ ...bitnodes, agents: dashjr.agents }, dashjr],
    newest: "32.1",
    now: "2026-11-26T12:30:00Z",
  });
  assert.equal(both.status, "alert");

  // A crawl over a week old is left out; with nothing fresh there is no reading.
  const stale = nodeVersionReading({
    crawls: [{ ...bitnodes, crawled: "2026-11-18T00:00:00Z" }, dashjr],
    newest: "32.1",
    now: "2026-11-26T12:30:00Z",
  });
  assert.equal(stale.value, 60);
  assert.deepEqual(
    stale.data?.crawls?.map((c) => c.source),
    ["dashjr"],
  );
  const none = nodeVersionReading({
    crawls: [{ ...bitnodes, crawled: "2026-11-01T00:00:00Z" }],
    newest: "32.1",
    now,
  });
  assert.equal(none.status, "unknown");
  assert.equal(none.data, null);
});

test("a watch's history grows only on a change or once a day, and a failure keeps the last data", () => {
  const r = hashrateReading([
    { name: "A", blocks: 25 },
    ...Array(3).fill({ name: "B", blocks: 25 }),
  ]);
  const s1 = stampReading(undefined, r, "2026-11-21T00:00:00Z", 1);
  const s2 = stampReading(s1, r, "2026-11-21T01:00:00Z", 2);
  assert.equal(s2.history.length, 1, "same reading an hour later adds nothing");
  const s3 = stampReading(s2, r, "2026-11-22T00:00:00Z", 3);
  assert.equal(s3.history.length, 2, "a day later it does");
  const f = failedReading(s3, "hashrate", "HTTP 503", "2026-11-22T01:00:00Z");
  assert.equal(f.status, s3.status);
  assert.equal(f.value, s3.value);
  assert.equal(f.error, "HTTP 503");
  const later = failedReading(s3, "hashrate", "HTTP 503", "2026-11-23T01:00:00Z");
  assert.equal(later.status, "unknown", "a day without data is unknown");
  const fresh = failedReading(undefined, "reorgs", "x", "2026-11-22T01:00:00Z") as WatchState;
  assert.equal(fresh.status, "unknown");
  let s = s1;
  for (let i = 0; i < 60; i++)
    s = stampReading(
      s,
      { ...r, value: i },
      new Date(Date.parse("2026-11-21T00:00:00Z") + i * 3600e3).toISOString(),
      i,
    );
  assert.equal(s.history.length, 48);
});
