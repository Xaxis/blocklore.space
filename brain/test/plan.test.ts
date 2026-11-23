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
