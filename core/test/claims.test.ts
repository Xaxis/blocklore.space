import assert from "node:assert/strict";
import { test } from "node:test";
import { gateReasons } from "../src/gate.ts";
import { changeEvents, claimAsOf } from "../src/replay.ts";
import { Claim } from "../src/schema.ts";
import { undash } from "../src/style.ts";
import { validateClaim } from "../src/validate.ts";
import { claim } from "./fixtures.ts";

const errors = (c: ReturnType<typeof claim>) =>
  validateClaim(c)
    .filter((i) => i.level === "error")
    .map((i) => `${i.where}: ${i.message}`);

test("the fixture is a valid claim", () => {
  assert.ok(Claim.safeParse(claim()).success);
  assert.deepEqual(errors(claim()), []);
});

test("a dash in a statement is an error, and undash removes it", () => {
  const dash = String.fromCharCode(0x2014);
  const bad = claim({
    statement: `The block subsidy fell at block 840,000 ${dash} the fourth halving ${dash} to 3.125 BTC per block mined.`,
  });
  assert.ok(errors(bad).some((e) => e.includes("dash")));
  assert.equal(undash(`a ${dash} b`), "a, b");
  assert.equal(undash(`blocks 2${String.fromCharCode(0x2013)}4`), "blocks 2 to 4");
});

test("git sources must be cited at a commit, and quotes are required", () => {
  const c = claim();
  const src = c.sources[0];
  assert.ok(src);
  const atBranch = claim({
    sources: [{ ...src, url: "https://github.com/bitcoin/bitcoin/blob/master/src/validation.cpp" }],
  });
  assert.ok(errors(atBranch).some((e) => e.includes("commit")));
  const noQuote = claim({ sources: [{ ...src, quote: undefined }] });
  assert.ok(errors(noQuote).some((e) => e.includes("quote")));
});

test("a stance needs attribution, and the gate holds stances, people and contested topics", () => {
  assert.ok(errors(claim({ kind: "stance" })).some((e) => e.startsWith("attributed_to")));
  const topics = new Map([
    ["halvings", { slug: "halvings", contested: false, safety: false }],
    ["covenants", { slug: "covenants", contested: true, safety: false }],
  ]);
  assert.deepEqual(gateReasons(claim(), topics), []);
  assert.deepEqual(gateReasons(claim({ topics: ["halvings", "covenants"] }), topics), [
    "contested topic: covenants",
  ]);
  assert.deepEqual(gateReasons(claim({ kind: "stance", people: ["Satoshi Nakamoto"] }), topics), [
    "a stance",
    "names Satoshi Nakamoto",
  ]);
});

test("revisions replay: the past state comes back exactly", () => {
  const t1 = { time: "2026-11-20T12:00:00Z", height: 976700 };
  const t2 = { time: "2026-12-01T09:00:00Z", height: 978300 };
  const c = claim({
    statement:
      "The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000, the fourth halving, mined on 20 April 2024 (UTC).",
    confidence: "high",
    last_verified: { ...t2, run: "2026-12-01-daily", method: "quotes 1/1" },
    revisions: [
      { rev: 1, at: t1, run: "2026-11-20-seed", change: "created" },
      {
        rev: 2,
        at: t2,
        run: "2026-12-01-daily",
        change: "refined",
        note: "Said which time zone the date is in.",
        before: {
          statement:
            "The old statement had no time zone but was otherwise the same as now, and long enough.",
        },
      },
    ],
  });
  assert.deepEqual(errors(c), []);
  assert.equal(claimAsOf(c, { height: 976000 }), null);
  assert.equal(
    claimAsOf(c, { height: 977000 })?.statement,
    "The old statement had no time zone but was otherwise the same as now, and long enough.",
  );
  assert.equal(claimAsOf(c, { time: "2026-12-02T00:00:00Z" })?.statement, c.statement);
  assert.equal(claimAsOf(c, { height: 977000 })?.revisions.length, 1);
  const ev = changeEvents(c);
  assert.equal(ev.length, 2);
  assert.equal(ev[1]?.change, "refined");
  assert.equal(ev[1]?.statement, c.statement);
  assert.ok(ev[0]?.statement.startsWith("The old statement"));
});

test("history must be well formed", () => {
  const at = claim().first_seen;
  const twice = claim({
    revisions: [
      { rev: 1, at, run: "r", change: "created" },
      { rev: 3, at, run: "r", change: "refined" },
    ],
  });
  const e = errors(twice);
  assert.ok(e.some((m) => m.includes("expected 2")));
  assert.ok(e.some((m) => m.includes("says why")));
});
