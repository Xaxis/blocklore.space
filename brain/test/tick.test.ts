import assert from "node:assert/strict";
import { test } from "node:test";
import { deployDecision, nextTopic } from "../src/tick.ts";

const now = new Date("2026-11-21T12:00:00Z");
const head = "677879c0123456789abcdef0123456789abcdef0";

test("the live site is redeployed at once for claims, otherwise at most every six hours", () => {
  assert.equal(deployDecision({ head, live: "677879c", urgentChanged: true, now }).deploy, false);
  assert.equal(deployDecision({ head, live: "bb06815", urgentChanged: true, now }).deploy, true);
  const wireOnly = { head, live: "bb06815", urgentChanged: false, now };
  assert.equal(deployDecision({ ...wireOnly, deployedAt: "2026-11-21T09:00:00Z" }).deploy, false);
  assert.equal(deployDecision({ ...wireOnly, deployedAt: "2026-11-21T06:00:00Z" }).deploy, true);
  assert.equal(deployDecision(wireOnly).deploy, true);
});

test("research takes the thinnest agenda topic that has nothing waiting for the owner", () => {
  const topics = [{ slug: "segwit" }, { slug: "covenants" }, { slug: "taproot" }, { slug: "ark" }];
  const published = new Map([
    ["segwit", 30],
    ["taproot", 28],
    ["covenants", 0],
  ]);
  assert.equal(nextTopic(topics, published, new Set(["covenants"])), "ark");
  assert.equal(nextTopic(topics, published, new Set(["covenants", "ark"])), "taproot");
  assert.equal(nextTopic(topics, published, new Set(topics.map((t) => t.slug))), null);
});
