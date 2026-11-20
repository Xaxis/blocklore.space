import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim, Topic } from "@blocklore/core";
import { createClaim, updateClaim } from "../src/publish.ts";
import type { Candidate } from "../src/staging.ts";
import { publicTopic } from "../src/store.ts";

const t0 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const t1 = { time: "2026-12-01T12:00:00Z", height: 978300 };
const cand: Candidate = {
  id: "halvings-and-supply.next-halving",
  statement:
    "The fifth halving will cut the block subsidy from 3.125 BTC to 1.5625 BTC at block 1,050,000.",
  kind: "fact",
  topics: ["halvings-and-supply"],
  depth: "user",
  status: "established",
  confidence: "high",
  people: [],
  sources: [
    {
      tier: "T1",
      kind: "code",
      title: "x",
      url: "https://github.com/a/b/blob/0123456789abcdef0123456789abcdef01234567/c",
      locator: "y",
      quote: "zzz",
      accessed: "2026-11-20",
      supports: "direct",
    },
  ],
};

test("a new claim starts its history at publication", () => {
  const c = createClaim(cand, t0, "2026-11-20-seed-x", "quotes 1/1");
  assert.deepEqual(c.first_seen, t0);
  assert.deepEqual(c.revisions, [{ rev: 1, at: t0, run: "2026-11-20-seed-x", change: "created" }]);
  assert.equal(c.last_verified.method, "quotes 1/1");
});

test("an unchanged claim only gets a fresh last_verified", () => {
  const c = createClaim(cand, t0, "r0", "m");
  const u = updateClaim(c, cand, t1, "r1", "m2");
  assert.equal(u.changed, false);
  assert.equal(u.claim.revisions.length, 1);
  assert.deepEqual(u.claim.last_verified, { ...t1, run: "r1", method: "m2" });
});

test("a changed claim needs a reason, and keeps what it said before", () => {
  const c = createClaim(cand, t0, "r0", "m");
  const changed = {
    ...cand,
    statement:
      "The fifth halving will reduce the block subsidy from 3.125 BTC to 1.5625 BTC at block 1,050,000.",
  };
  assert.ok(updateClaim(c, changed, t1, "r1", "m").error);
  const u = updateClaim(c, { ...changed, change: "refined", note: "Plainer verb." }, t1, "r1", "m");
  assert.equal(u.changed, true);
  const rev = u.claim.revisions[1] as Claim["revisions"][number];
  assert.equal(rev.change, "refined");
  assert.deepEqual(rev.before, { statement: cand.statement });
  assert.deepEqual(u.claim.first_seen, t0);
  assert.equal(u.claim.statement, changed.statement);
  assert.equal("change" in u.claim, false);
});

test("a topic shows only published claims, and waits when none are", () => {
  const layout: Topic = {
    slug: "covenants",
    title: "Covenant proposals",
    lede: "covenants.what-a-covenant-is",
    group: "governance",
    contested: false,
    safety: false,
    sections: [
      {
        id: "basics",
        title: "Basics",
        depth: "curious",
        claims: ["covenants.what-a-covenant-is", "covenants.b"],
      },
      { id: "ctv", title: "CTV", depth: "builder", claims: ["covenants.c"] },
    ],
  };
  const policy = { topics: { covenants: { contested: true, safety: false } }, contested_terms: [] };
  assert.equal(publicTopic(layout, new Set(), policy), null);
  const t = publicTopic(layout, new Set(["covenants.b"]), policy);
  assert.ok(t);
  assert.equal(t.lede, "covenants.b");
  assert.equal(t.contested, true, "flags come from the policy, not the layout");
  assert.deepEqual(
    t.sections.map((s) => s.claims),
    [["covenants.b"]],
  );
});
