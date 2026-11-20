import assert from "node:assert/strict";
import { test } from "node:test";
import type { BundleClaim, BundleTopic } from "../src/bundle.ts";
import { gapMap } from "../src/gaps.ts";
import type { Depth, Scorecard } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

const bc = (id: string, depth: Depth, statement: string): BundleClaim => ({
  ...claim({ id, topics: [id.split(".")[0] ?? ""], depth, statement }),
  hash: "0".repeat(64),
  weakSources: false,
  recheck: null,
  shownIn: [],
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
  // A topic with nothing published is listed for its review count and has no thin depths.
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
