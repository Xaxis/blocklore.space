import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { PERIOD, Signaling } from "@blocklore/core";

// The followed state and the file live in var/ and knowledge/; point them at a temporary folder.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-signaling-"));
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_SIGNALING_FILE = path.join(tmp, "chain", "signaling.json");
const { blocksBetween } = await import("../src/security/watches.ts");
const {
  fillVersions,
  keepVersions,
  missingRanges,
  recordSignaling,
  settlePeriods,
  signalingCommand,
  signalingOf,
  SIGNALING_FILE,
} = await import("../src/signaling.ts");

type State = Parameters<typeof signalingOf>[0];

const START = 484 * PERIOD; // 975744
/** The chain both fake explorers serve: bit 2 on every seventh block, one block without the prefix. */
const versionAt = (h: number) =>
  h === START + 3 ? 0x00000004 : h % 7 === 0 ? 0x20000004 : 0x20002000;
const block = (h: number, version = versionAt(h)) => ({
  id: h.toString(16).padStart(64, "0"),
  height: h,
  timestamp: 1_763_000_000 + (h - START) * 600,
  bits: 386_000_000,
  version,
});

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/**
 * mempool.space and blockstream.info as their APIs answer (`/v1/blocks/<h>` lists 15 blocks down
 * from h, `/blocks/<h>` 10), blockstream.info giving another version at `differ`.
 */
function explorers(opts: { differ?: number } = {}): string[] {
  const asked: string[] = [];
  const list = (h: number, n: number, other: boolean) =>
    Array.from({ length: n }, (_, i) => h - i).map((x) =>
      block(x, other && x === opts.differ ? versionAt(x) ^ 0x2 : versionAt(x)),
    );
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const m = /mempool\.space\/api\/v1\/blocks\/(\d+)$/.exec(url);
    const b = /blockstream\.info\/api\/blocks\/(\d+)$/.exec(url);
    const body = m ? list(Number(m[1]), 15, false) : b ? list(Number(b[1]), 10, true) : null;
    return body
      ? new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
      : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return asked;
}

test("both explorers must agree on each block's version, read in pages aligned to their size", async () => {
  const to = START + 19;
  let asked = explorers();
  const blocks = await blocksBetween(START, to, to);
  assert.deepEqual(
    blocks.map((b) => [b.height, b.version]),
    Array.from({ length: 20 }, (_, i) => [START + i, versionAt(START + i)]),
  );
  const pages = (host: string) =>
    asked.filter((u) => u.includes(host)).map((u) => Number(u.split("/").at(-1)));
  // Pages end one below a multiple of their size (975750 is 15 x 65050 and 10 x 97575), the last
  // at `to`, so a later read of the same deep blocks asks the same URLs.
  assert.deepEqual(pages("mempool.space"), [START + 5, to]);
  assert.deepEqual(pages("blockstream.info"), [START + 5, START + 15, to]);
  asked = explorers({ differ: START + 12 });
  await assert.rejects(
    blocksBetween(START, to, to),
    /block 975756: the explorers disagree on its version/,
  );
  assert.ok(asked.some((u) => u.includes("blockstream.info")));
});

const state = (tip: number): State => ({
  blocks: { [tip]: { hash: "ab".repeat(32), time: block(tip).timestamp } },
});
/** A reader over the fake chain that counts what it is asked. */
function reader() {
  const calls: [number, number][] = [];
  const read = async (a: number, b: number) => {
    calls.push([a, b]);
    return Array.from({ length: b - a + 1 }, (_, i) => block(a + i));
  };
  return { calls, read };
}

test("a first run reads the tip's period in chunks and tallies it, with no last period yet", async () => {
  const tip = START + 400;
  const s = state(tip);
  keepVersions(s, [block(tip - 1), block(tip)], tip);
  const { calls, read } = reader();
  const r = await fillVersions(s, tip, read, Number.POSITIVE_INFINITY);
  assert.deepEqual(r, { read: 399, left: 0 });
  // Chunks end one below a multiple of 150, so the reads ask whole pages of both explorers.
  assert.deepEqual(calls, [
    [START, START + 5],
    [START + 6, START + 155],
    [START + 156, START + 305],
    [START + 306, START + 398],
  ]);
  settlePeriods(s, tip);
  const out = signalingOf(s, tip, "2026-11-23T10:00:00Z");
  assert.ok(out);
  assert.equal(Signaling.safeParse(out).success, true);
  let sevenths = 0;
  for (let h = START; h <= tip; h++) if (h % 7 === 0 && h !== START + 3) sevenths++;
  assert.deepEqual(
    {
      blocks: out.current.blocks,
      unprefixed: out.current.unprefixed,
      bit2: out.current.bits[2],
      general: out.current.general,
    },
    { blocks: 401, unprefixed: 1, bit2: sevenths, general: 401 - 1 - sevenths },
  );
  assert.equal(out.previous, null);
});

test("a run stops reading after its minute, writes nothing, and the next run finishes", async () => {
  const tip = START + 1500;
  const s = state(tip);
  keepVersions(s, [block(tip)], tip);
  const { calls, read } = reader();
  let t = 0;
  const clock = () => {
    t += 25_000; // each chunk takes 25 s
    return t;
  };
  const first = await fillVersions(s, tip, read, 60, clock);
  assert.equal(calls.length, 2, "two chunks fit in the minute");
  assert.ok(first.left > 0);
  assert.equal(signalingOf(s, tip, "2026-11-23T10:00:00Z"), null, "no tally of part of a period");
  const r = await recordSignaling(s, tip, read, "2026-11-23T11:00:00Z", Number.POSITIVE_INFINITY);
  assert.equal(r.written, true);
  const file = Signaling.parse(JSON.parse(readFileSync(SIGNALING_FILE(), "utf8")));
  assert.equal(file.current.blocks, 1501);
  assert.equal(file.tip.height, tip);
});

test("at a period boundary the last period is tallied and its versions forgotten", () => {
  const prev = START - PERIOD;
  const s = state(START + 2);
  keepVersions(
    s,
    Array.from({ length: PERIOD + 3 }, (_, i) => block(prev + i)),
    START + 2,
  );
  assert.deepEqual(missingRanges(s, START + 2), []);
  settlePeriods(s, START + 2);
  assert.equal(s.lastPeriod?.start, prev);
  assert.equal(s.lastPeriod?.blocks, PERIOD);
  assert.deepEqual(Object.keys(s.versions ?? {}).map(Number), [START, START + 1, START + 2]);
  const out = signalingOf(s, START + 2, "2026-11-23T10:00:00Z");
  assert.equal(out?.previous?.through, START - 1);
  assert.equal(out?.current.blocks, 3);
});

test("after a pause across a boundary, the gaps in the last period are read too", () => {
  const prev = START - PERIOD;
  const s: State = {
    ...state(START + 10),
    versions: Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [prev + i, versionAt(prev + i)]),
    ),
  };
  assert.deepEqual(missingRanges(s, START + 10), [
    [START, START + 10],
    [prev + 100, START - 1],
  ]);
  // A first run deep in a period does not reach back for the last one.
  assert.deepEqual(missingRanges(state(START + 1000), START + 1000), [[START, START + 1000]]);
});

test("a version the explorers disagree on stops the step and leaves the file as it was", async () => {
  const before = readFileSync(SIGNALING_FILE(), "utf8");
  const tip = START + 19;
  explorers({ differ: START + 7 });
  const s = state(tip);
  await assert.rejects(
    recordSignaling(s, tip, (a, b) => blocksBetween(a, b, tip), "2026-11-23T12:00:00Z"),
    /disagree on its version/,
  );
  assert.equal(readFileSync(SIGNALING_FILE(), "utf8"), before);
});

test("pnpm brain signaling prints the tally and writes nothing", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "blocklore-signaling-cmd-"));
  process.env.BLOCKLORE_SIGNALING_FILE = path.join(dir, "signaling.json");
  const tip = START + 30;
  const { read } = reader();
  const lines: string[] = [];
  const code = await signalingCommand(
    {
      tip: async () => tip,
      blocks: (a, b) => read(a, b),
      followed: { blocks: {} },
      newest: () => "32.1",
    },
    (l) => lines.push(l),
  );
  assert.equal(code, 0);
  assert.match(
    lines[0] ?? "",
    /period 975744 to 977759: 31 of 2016 blocks so far, as of block 975774/,
  );
  assert.ok(lines.some((l) => /bit 2 /.test(l)));
  assert.ok(lines.some((l) => /BIP 320 bits 13 to 28 \(not a signal\)/.test(l)));
  assert.ok(lines.some((l) => /none on bits 0 to 12; DEPLOYMENT_TESTDUMMY on bit 28/.test(l)));
  assert.ok(lines.at(-1)?.endsWith("wrote nothing."));
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(existsSync(path.join(tmp, "security", "blocks.json")), false);
});
