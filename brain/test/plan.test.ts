import assert from "node:assert/strict";
import { test } from "node:test";
import { type GapMap, gapScore, type TopicGap } from "@blocklore/core";
import { planResearch, researchTask } from "../src/plan.ts";

const gap = (slug: string, over: Partial<TopicGap> = {}): TopicGap => {
  const g = {
    slug,
    title: slug,
    claims: 20,
    pending: 0,
    thin: [],
    questions: [],
    rechecks: [],
    moved: [],
    threats: [],
    ...over,
  };
  return { ...g, score: gapScore(g) };
};
const q = (id: string, text: string) => ({ id, kind: "uncovered", q: text, got: "not_covered" });

const map: GapMap = {
  scored: null,
  unplaced: [],
  misses: [],
  advisories: [],
  topics: [
    gap("covenants", { claims: 0, pending: 34 }),
    gap("lightning", { questions: [q("g150", "What is Ark?"), q("g151", "What is eltoo?")] }),
    gap("segwit", { thin: [{ depth: "curious", claims: 1 }], rechecks: ["segwit.wtxid"] }),
    gap("taproot", { claims: 10 }),
  ],
};
const agenda = ["covenants", "lightning", "segwit", "taproot", "ark"].map((slug) => ({
  slug,
  scope: `The ${slug} scope.`,
}));

test("research takes the topic with the most open gaps that has nothing waiting for review", () => {
  // Two open questions (6) outrank a topic nobody has started (5).
  assert.equal(planResearch(map, agenda, new Set(["covenants"]))?.slug, "lightning");
  // An agenda topic with nothing published is thin at all five depths (5), above segwit's 3: a new
  // topic is the largest gap, not the smallest.
  assert.equal(planResearch(map, agenda, new Set(["covenants", "lightning"]))?.slug, "ark");
  assert.equal(
    planResearch(map, agenda, new Set(["covenants", "lightning", "ark"]))?.slug,
    "segwit",
  );
  // No gaps anywhere open: the thinnest topic.
  assert.equal(
    planResearch(map, agenda, new Set(["covenants", "lightning", "segwit", "ark"]))?.slug,
    "taproot",
  );
  assert.equal(planResearch(map, agenda, new Set(agenda.map((t) => t.slug))), null);
});

test("the research task carries the scope, the questions, the thin depths and failed rechecks", () => {
  const task = researchTask("The segwit scope.", map.topics[2]);
  assert.match(task, /^The segwit scope\./);
  assert.match(task, /curious \(1\)/);
  assert.match(task, /segwit\.wtxid/);
  const lightning = researchTask("The lightning scope.", map.topics[1]);
  assert.match(lightning, /- What is Ark\?\n- What is eltoo\?$/);
  assert.equal(researchTask("Just the scope.  ", undefined), "Just the scope.");
});

test("passages moved on at head reach the task, and weigh one per claim on the score", () => {
  const PIN = "a0988140b71485ad12c3c3a4a9573f7c21b1eff8";
  const HEAD = "dbe9eacd17ae1cc24581081613123a40b44a9f31";
  const m = (claim: string, source: number, state: "changed" | "gone" = "changed") => ({
    claim,
    source,
    repo: "bitcoin/bitcoin",
    path: "src/chainparams.cpp",
    pinned: PIN,
    head: HEAD,
    state,
  });
  const g = gap("taproot", {
    moved: [
      m("taproot.speedy-trial", 3),
      m("taproot.speedy-trial", 4, "gone"),
      m("taproot.three-bips", 1),
    ],
  });
  assert.equal(
    g.score,
    gapScore({ questions: [], rechecks: [], thin: [] }) + 2,
    "two claims, not three passages",
  );
  const task = researchTask("Taproot: the soft fork.", g);
  assert.ok(task.includes("https://blocklore.space/gaps#moved"));
  assert.ok(task.includes("A claim about what happened then keeps its pinned source"));
  assert.ok(
    task.includes(
      `- taproot.speedy-trial, source 4: bitcoin/bitcoin src/chainparams.cpp, cited at ${PIN}; the passage is gone from the file at head ${HEAD}`,
    ),
  );
  assert.ok(
    task.includes(
      `- taproot.speedy-trial, source 5: bitcoin/bitcoin src/chainparams.cpp, cited at ${PIN}; the file is gone at head ${HEAD}`,
    ),
  );
  assert.ok(
    !researchTask("Taproot.", gap("taproot")).includes("gaps#moved"),
    "nothing moved, no section",
  );
});
