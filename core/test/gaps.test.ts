import assert from "node:assert/strict";
import { test } from "node:test";
import type { BundleClaim, BundleTopic } from "../src/bundle.ts";
import { gapMap } from "../src/gaps.ts";
import type { Depth, Scorecard } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

const bc = (id: string, depth: Depth, statement: string): BundleClaim => ({
  ...claim({ id, topics: [id.split(".")[0] ?? ""], depth, statement }),
  hash: "0".repeat(64),
  hashes: ["0".repeat(64)],
  weakSources: false,
  recheck: null,
  at_head: [],
  shownIn: [],
  withdrawal: null,
});

const list = [
  bc("lightning.htlc", "builder", "A Lightning payment is routed through channels using HTLCs."),
  bc("lightning.channel", "user", "A Lightning channel is a shared output between two parties."),
  bc("lightning.close", "user", "Closing a Lightning channel spends its funding output."),
  bc("segwit.weight", "builder", "SegWit measures blocks in weight units, up to 4,000,000."),
  bc("segwit.wtxid", "builder", "SegWit adds a witness transaction id, the wtxid."),
  bc("segwit.what", "curious", "SegWit moves signature data into a separate witness structure."),
];
const claims = Object.fromEntries(list.map((c) => [c.id, c]));
const topic = (slug: string, title: string) => ({ slug, title }) as unknown as BundleTopic;
const ask = (short: { id: string; q: string; got: string }[]) =>
  ({
    misses: [],
    ask: { ran: "2026-11-20T21:10:59Z", short: short.map((s) => ({ ...s, kind: "uncovered" })) },
  }) as unknown as Scorecard;

test("the gap map places short answers on the nearest topic and ranks topics by open gaps", () => {
  const map = gapMap({
    claims,
    topics: [topic("lightning", "Lightning"), topic("segwit", "SegWit")],
    review: [
      { topic: "segwit", count: 2 },
      { topic: "covenants", count: 30 },
    ],
    rechecks: {
      "segwit.wtxid": { at: { time: "2026-11-21T04:20:00Z", height: 976900 }, problems: ["x"] },
    },
    scorecard: ask([
      { id: "g001", q: "How do I close a Lightning channel that is stuck?", got: "partial" },
      { id: "g002", q: "What is a Lightning channel factory?", got: "not_covered" },
      { id: "g003", q: "Who was Satoshi Nakamoto?", got: "not_covered" },
    ]),
  });
  assert.equal(map.scored, "2026-11-20T21:10:59Z");
  const [first, second, third] = map.topics;
  assert.equal(first?.slug, "lightning");
  assert.deepEqual(
    first?.questions.map((q) => q.id),
    ["g001", "g002"],
  );
  // Lightning has 2 user claims, 1 builder claim and none at the other depths: all five are thin.
  assert.deepEqual(
    first?.thin.map((d) => `${d.depth}:${d.claims}`),
    ["curious:0", "user:2", "holder:0", "builder:1", "researcher:0"],
  );
  assert.equal(first?.score, 3 * 2 + 5);
  assert.equal(second?.slug, "segwit");
  assert.deepEqual(second?.rechecks, ["segwit.wtxid"]);
  assert.equal(second?.pending, 2);
  assert.equal(second?.score, 2 * 1 + 5);
  // A topic with nothing published but claims in review is listed for its review count, not as thin.
  assert.deepEqual(
    { slug: third?.slug, claims: third?.claims, pending: third?.pending, thin: third?.thin },
    { slug: "covenants", claims: 0, pending: 30, thin: [] },
  );
  assert.deepEqual(
    map.unplaced.map((q) => q.id),
    ["g003"],
  );
});

test("without a scored run the gap map still reports thin depths and has no questions", () => {
  const map = gapMap({ claims, topics: [], review: [], rechecks: {}, scorecard: null });
  assert.equal(map.scored, null);
  assert.equal(map.topics.length, 0);
  assert.deepEqual(map.unplaced, []);
});

test("a passage moved on at head is a gap of its claim's topic, one point per claim", () => {
  const PIN = "a0988140b71485ad12c3c3a4a9573f7c21b1eff8";
  const HEAD = "dbe9eacd17ae1cc24581081613123a40b44a9f31";
  const at = { time: "2026-11-24T07:39:10Z", height: 977341 };
  const a = (source: number, state: "current" | "changed" | "gone") => ({
    source,
    repo: "bitcoin/bitcoin",
    path: "src/chainparams.cpp",
    pinned: PIN,
    branch: "master",
    head: HEAD,
    state,
    since: at,
    read: at,
  });
  const moved = {
    ...claims,
    "segwit.weight": {
      ...claims["segwit.weight"],
      at_head: [a(0, "changed"), a(1, "gone")],
    } as BundleClaim,
    "segwit.what": { ...claims["segwit.what"], at_head: [a(0, "current")] } as BundleClaim,
  };
  const input = { topics: [topic("segwit", "SegWit")], review: [], rechecks: {}, scorecard: null };
  const before = gapMap({ ...input, claims }).topics.find((t) => t.slug === "segwit");
  const after = gapMap({ ...input, claims: moved }).topics.find((t) => t.slug === "segwit");
  assert.deepEqual(before?.moved, []);
  assert.deepEqual(
    after?.moved.map((m) => [m.claim, m.source, m.state, m.pinned, m.head]),
    [
      ["segwit.weight", 0, "changed", PIN, HEAD],
      ["segwit.weight", 1, "gone", PIN, HEAD],
    ],
  );
  assert.equal((after?.score ?? 0) - (before?.score ?? 0), 1, "one claim, two passages: one point");
});
