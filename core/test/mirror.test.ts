import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { claimHash } from "../src/hash.ts";
import {
  claimsLine,
  compareClaim,
  type EditionView,
  editionLine,
  exportLine,
  mcpLine,
  mirrorPosition,
  mirrorVerdict,
  readEdition,
  readMcp,
  type Served,
  sampleIds,
  servedClaim,
  snapshotLines,
  textLine,
} from "../src/mirror.ts";
import type { Claim } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

// The mirror check (MIRROR.md): a mirror is the same as the origin, behind it (exactly what the
// origin served earlier), ahead of it, or different. These cases build both sides by hand.

const t1 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const t2 = { time: "2026-11-22T15:30:00Z", height: 977050 };
const ROOT = "a".repeat(64);

const edition = (over: Partial<EditionView> = {}): EditionView => ({
  generated: t2,
  build: "1111111",
  claims: 3,
  sealed: { n: 1, root: ROOT, count: 3 },
  ...over,
});
const served = (text: string): Served => ({
  sha256: createHash("sha256").update(text).digest("hex"),
  text,
});

/** Created at t1, refined at t2: before t2 it said OLD. */
const OLD =
  "The block subsidy fell to 3.125 BTC at block 840,000, the fourth halving, in April 2024.";
const revised: Claim = claim({
  id: "halvings.revised",
  last_verified: { ...t2, run: "2026-11-22-daily", method: "quotes 1/1" },
  run: "2026-11-22-daily",
  revisions: [
    { rev: 1, at: t1, run: "2026-11-20-seed", change: "created" },
    {
      rev: 2,
      at: t2,
      run: "2026-11-22-daily",
      change: "refined",
      note: "Named the day the fourth halving's block was mined.",
      before: { statement: OLD },
    },
  ],
});
/** The same claim as the store held it before the refinement. */
const original: Claim = {
  ...revised,
  statement: OLD,
  run: "2026-11-20-seed",
  last_verified: { ...t1, run: "2026-11-20-seed", method: "quotes 1/1, chain 1/1" },
  revisions: [{ rev: 1, at: t1, run: "2026-11-20-seed", change: "created" }],
};
const kept = claim({ id: "halvings.kept" });

/** A claim as the API serves it: the bundle's extra fields beside the claim's own. */
const record = (c: Claim, over: Record<string, unknown> = {}) => ({
  ...c,
  hash: claimHash(c),
  url: `https://blocklore.space/claims/${c.id}`,
  shownIn: [],
  recheck: null,
  withdrawal: null,
  weakSources: false,
  ...over,
});
const jsonl = (cs: Claim[], over: (c: Claim) => Record<string, unknown> = () => ({})) =>
  `${cs.map((c) => JSON.stringify(record(c, over(c)))).join("\n")}\n`;

test("one commit is one edition: the same build with another store moment differs", () => {
  assert.equal(mirrorPosition(edition(), edition(), "unknown"), "same");
  assert.equal(mirrorPosition(edition(), edition({ generated: t1 }), "unknown"), "differs");
  assert.equal(
    mirrorPosition(edition(), edition({ sealed: { n: 2, root: ROOT, count: 3 } }), "unknown"),
    "differs",
  );
});

test("an older store or fewer sealed editions is behind; newer is ahead", () => {
  const older = edition({ build: "0000000", generated: t1 });
  assert.equal(mirrorPosition(edition(), older, "unknown"), "behind");
  assert.equal(mirrorPosition(edition(), older, "ancestor"), "behind");
  assert.equal(mirrorPosition(older, edition(), "descendant"), "ahead");
  assert.equal(
    mirrorPosition(edition(), edition({ build: "0000000", sealed: null }), "unknown"),
    "behind",
  );
  // Older store but more sealed editions cannot be one history.
  const mixed = edition({
    build: "0000000",
    generated: t1,
    sealed: { n: 2, root: ROOT, count: 3 },
  });
  assert.equal(mirrorPosition(edition(), mixed, "unknown"), "differs");
});

test("git history orders two builds of one edition, and must agree with the editions", () => {
  const other = edition({ build: "0000000" });
  assert.equal(mirrorPosition(edition(), other, "ancestor"), "behind");
  assert.equal(mirrorPosition(edition(), other, "descendant"), "ahead");
  assert.equal(mirrorPosition(edition(), other, "diverged"), "differs");
  assert.equal(mirrorPosition(edition(), other, "unknown"), "differs");
  // An older commit cannot hold a newer store.
  assert.equal(mirrorPosition(edition({ generated: t1 }), other, "ancestor"), "differs");
});

test("the edition line names each difference, and a same-number edition with another root differs", () => {
  const ok = editionLine(edition(), edition(), "same", "unknown");
  assert.equal(ok.verdict, "ok");
  assert.match(ok.detail, /3 claims, store at block 977,050 .*sealed edition 1 .*build 1111111/);

  const older = edition({ build: "0000000", generated: t1, claims: 2 });
  const behind = editionLine(edition(), older, "behind", "ancestor");
  assert.equal(behind.verdict, "behind");
  assert.match(behind.detail, /2 claims \(origin 3\)/);
  assert.match(behind.detail, /build 0000000 \(origin 1111111, an older commit\)/);

  const forged = edition({
    build: "0000000",
    generated: t1,
    sealed: { n: 1, root: "b".repeat(64), count: 3 },
  });
  assert.equal(editionLine(edition(), forged, "behind", "ancestor").verdict, "differs");

  const counted = editionLine(edition(), edition({ claims: 4 }), "same", "unknown");
  assert.equal(counted.verdict, "differs");

  const dev = editionLine(edition(), edition({ build: "dev" }), "differs", "unknown");
  assert.match(dev.detail, /names no commit/);
});

test("a snapshot file is compared byte for byte, and a missing one follows the position", () => {
  const o = new Map([
    [1, "1".repeat(64)],
    [2, "2".repeat(64)],
  ]);
  const same = snapshotLines(o, new Map(o), "same");
  assert.deepEqual(
    same.map((l) => [l.check, l.verdict]),
    [
      ["snapshots/1.json", "ok"],
      ["snapshots/2.json", "ok"],
    ],
  );
  const lagging = snapshotLines(o, new Map([[1, "1".repeat(64)]]), "behind");
  assert.deepEqual(
    lagging.map((l) => l.verdict),
    ["ok", "behind"],
  );
  assert.equal(snapshotLines(o, new Map([[1, "1".repeat(64)]]), "same")[1]?.verdict, "differs");
  // A sealed file is never rewritten: other bytes under one number differ even when behind.
  const rewritten = snapshotLines(o, new Map([[1, "9".repeat(64)]]), "behind");
  assert.equal(rewritten[0]?.verdict, "differs");
  const ahead = snapshotLines(new Map([[1, "1".repeat(64)]]), o, "ahead");
  assert.equal(ahead[1]?.verdict, "ahead");
});

test("a claim is compared by its content as served, not only by the hash it names", () => {
  const r = servedClaim(record(kept));
  assert.ok(!("error" in r));
  assert.equal(r.hash, claimHash(kept));
  assert.equal(compareClaim(kept.id, r, servedClaim(record(kept)), "same").verdict, "ok");
  // An edited statement under the origin's hash is caught.
  const lying = servedClaim(
    record({ ...kept, statement: `${kept.statement} Edited.` }, { hash: claimHash(kept) }),
  );
  const v = compareClaim(kept.id, r, lying, "same");
  assert.equal(v.verdict, "differs");
  assert.match(v.why, /^content /);
  // So is the same content under another hash.
  const renamed = servedClaim(record(kept, { hash: "f".repeat(64) }));
  assert.equal(compareClaim(kept.id, r, renamed, "same").verdict, "differs");
  assert.ok("error" in servedClaim({ id: "x.y", statement: "short" }));
});

test("a served claim whose links to unpublished claims were dropped still matches its twin", () => {
  // The store links a claim that is not published; the API serves `related` without it, under the
  // stored claim's hash, so the hash cannot be recomputed from the record. Both sites agree.
  const stored = claim({ id: "halvings.linked", related: ["halvings.kept", "halvings.gated"] });
  const asServed = record({ ...stored, related: ["halvings.kept"] }, { hash: claimHash(stored) });
  const o = servedClaim(asServed);
  assert.ok(!("error" in o));
  assert.notEqual(o.content, o.hash);
  assert.equal(compareClaim(stored.id, o, servedClaim(asServed), "same").verdict, "ok");
  // Once the linked claim publishes, a mirror behind shows the shorter list: behind, not different.
  const later = servedClaim(record(stored));
  assert.equal(compareClaim(stored.id, later, o, "behind").verdict, "behind");
  assert.equal(compareClaim(stored.id, later, o, "same").verdict, "differs");
});

test("a claim at an earlier revision of the origin's is behind; any other change differs", () => {
  const o = servedClaim(record(revised));
  const m = servedClaim(record(original));
  assert.equal(compareClaim(revised.id, o, m, "behind").verdict, "behind");
  assert.match(compareClaim(revised.id, o, m, "behind").why, /revision 1 of the origin's 2/);
  // The same old revision while the editions agree is a difference.
  assert.equal(compareClaim(revised.id, o, m, "same").verdict, "differs");
  // An old revision with one byte changed is not the origin's history.
  const tampered = servedClaim(record({ ...original, statement: OLD.replace("April", "Apri1") }));
  assert.equal(compareClaim(revised.id, o, tampered, "behind").verdict, "differs");
  // The other way round, the mirror is ahead.
  assert.equal(compareClaim(revised.id, m, o, "ahead").verdict, "ahead");
  // Missing claims follow the position.
  assert.equal(compareClaim(revised.id, o, null, "behind").verdict, "behind");
  assert.equal(compareClaim(revised.id, o, null, "same").verdict, "differs");
  assert.equal(compareClaim(revised.id, null, o, "ahead").verdict, "ahead");
});

test("the export names the claim one changed byte is in", () => {
  const o = served(jsonl([kept, revised]));
  assert.equal(exportLine(o, o, "same").verdict, "ok");
  const changed = served(
    jsonl([{ ...kept, statement: kept.statement.replace("6.25", "6.26") }, revised]),
  );
  const line = exportLine(o, changed, "same");
  assert.equal(line.verdict, "differs");
  assert.match(line.detail, /1 differs: halvings\.kept/);
});

test("an older export is behind; a field outside the hash is named", () => {
  const o = served(jsonl([kept, revised]));
  const older = served(jsonl([kept, original]));
  const line = exportLine(o, older, "behind");
  assert.equal(line.verdict, "behind");
  assert.match(line.detail, /1 behind: halvings\.revised/);
  const fewer = exportLine(o, served(jsonl([kept])), "behind");
  assert.equal(fewer.verdict, "behind");
  // Only last_verified moved: same hashes, other bytes.
  const rechecked = served(
    jsonl([kept, revised], (c) =>
      c.id === kept.id
        ? { last_verified: { ...t2, run: "2026-11-22-daily", method: "quotes 1/1" } }
        : {},
    ),
  );
  const outside = exportLine(o, rechecked, "same");
  assert.equal(outside.verdict, "differs");
  assert.match(outside.detail, /first at halvings\.kept\.last_verified/);
  assert.equal(exportLine(o, rechecked, "behind").verdict, "behind");
});

test("a text differs at its first differing line", () => {
  const o = served("# Blocklore\n\nThis edition has 3 claims.\n");
  const m = served("# Blocklore\n\nThis edition has 2 claims.\n");
  assert.equal(textLine("llms.txt", o, o, "same").verdict, "ok");
  const d = textLine("llms.txt", o, m, "same");
  assert.equal(d.verdict, "differs");
  assert.match(d.detail, /from line 3: "This edition has 2 claims\."/);
  assert.equal(textLine("llms.txt", o, m, "behind").verdict, "behind");
  // On a long line the shown part starts near the first character that differs.
  const long = `- [API](https://blocklore.space/api/v1): JSON for claims, topics, changes since a block height, search`;
  const longer = served(`${long.replace(", search", ", any claim as it stood (?at=), search")}\n`);
  const shown = textLine("llms.txt", served(`${long}\n`), longer, "same").detail;
  assert.match(shown, /from line 1: "\.\.\.[^"]{0,20}a block height, any claim as it stood/);
  assert.match(shown, /origin "\.\.\.[^"]{0,20}a block height, search"/);
});

test("the MCP server must answer initialize as the same build", () => {
  const init = (version: string) =>
    readMcp({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-11-25", serverInfo: { name: "blocklore", version } },
    });
  assert.equal(mcpLine(init("1111111"), init("1111111"), "same").verdict, "ok");
  assert.equal(mcpLine(init("1111111"), init("0000000"), "behind").verdict, "behind");
  assert.equal(mcpLine(init("1111111"), init("0000000"), "same").verdict, "differs");
  const err = readMcp({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "nope" } });
  assert.equal(mcpLine(init("1111111"), err, "same").verdict, "differs");
});

test("the run exits 0 when all is ok, 1 on any difference, 2 when only behind or only ahead", () => {
  const l = (verdict: "ok" | "behind" | "ahead" | "differs") => ({
    verdict,
    check: "x",
    detail: "",
  });
  assert.deepEqual(mirrorVerdict([l("ok"), l("ok")]), { verdict: "ok", exit: 0 });
  assert.deepEqual(mirrorVerdict([l("ok"), l("behind")]), { verdict: "behind", exit: 2 });
  assert.deepEqual(mirrorVerdict([l("ahead"), l("ok")]), { verdict: "ahead", exit: 2 });
  assert.deepEqual(mirrorVerdict([l("behind"), l("differs")]), { verdict: "differs", exit: 1 });
  assert.deepEqual(mirrorVerdict([l("behind"), l("ahead")]), { verdict: "differs", exit: 1 });
  const summary = claimsLine("api/v1/claims", "claims", [
    { id: "a.b", verdict: "ok", why: "" },
    { id: "c.d", verdict: "behind", why: "not on the mirror yet" },
  ]);
  assert.equal(summary.verdict, "behind");
  assert.match(summary.detail, /2 claims; 1 behind: c\.d \(not on the mirror yet\)/);
});

test("an edition is read from the API's answers, and anything else is refused", () => {
  const api = { edition: { generated: t2, build: "1111111", claims: 3 } };
  const snaps = {
    snapshots: [
      { n: 2, root: "b".repeat(64), count: 3 },
      { n: 1, root: ROOT, count: 2 },
    ],
  };
  const r = readEdition(api, snaps);
  assert.ok(!("error" in r));
  assert.deepEqual(r.edition.sealed, { n: 2, root: "b".repeat(64), count: 3 });
  assert.deepEqual(r.editions, [1, 2]);
  const unsealed = readEdition(api, { snapshots: [] });
  assert.ok(!("error" in unsealed));
  assert.equal(unsealed.edition.sealed, null);
  assert.ok("error" in readEdition({}, snaps));
  assert.ok("error" in readEdition(api, { snapshots: [{ n: 1, root: "nope", count: 1 }] }));
});

test("a sample is the same for the same seed, distinct, and in id order", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `t.c${String(i).padStart(2, "0")}`);
  const a = sampleIds(ids, 10, 42);
  assert.deepEqual(a, sampleIds(ids, 10, 42));
  assert.equal(new Set(a).size, 10);
  assert.deepEqual(a, [...a].sort());
  assert.notDeepEqual(a, sampleIds(ids, 10, 43));
  assert.equal(sampleIds(ids, 80, 1).length, 50);
});
