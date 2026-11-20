import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANSWER_SCHEMA,
  ASK,
  askPrompt,
  checkAnswer,
  costMicros,
  readQuestion,
  scopeRefusal,
  worstCaseMicros,
} from "../src/ask.ts";
import type { BundleClaim } from "../src/bundle.ts";
import { hasDash } from "../src/style.ts";
import { claim } from "./fixtures.ts";

const bc = (over: Partial<BundleClaim>): BundleClaim => ({
  ...claim(over),
  hash: "0".repeat(64),
  weakSources: false,
  shownIn: [],
  ...over,
});
const offered = ["halvings.subsidy-840000", "halvings.max-supply"];
const answer = (o: Record<string, unknown>) =>
  JSON.stringify({ verdict: "answered", refusal: "none", sentences: [], missing: "", ...o });

test("a question with a seed in it is refused before anything reads it, without echoing it", () => {
  const seed =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const r = readQuestion(`is this safe: ${seed}`);
  assert.ok("error" in r && r.secret);
  assert.doesNotMatch(r.error, /abandon/);
  assert.match(r.error, /did not keep or send/);
  assert.deepEqual(readQuestion("  what is   a halving? "), { question: "what is a halving?" });
  assert.ok("error" in readQuestion(""));
  assert.ok("error" in readQuestion(42));
  assert.ok("error" in readQuestion("x".repeat(ASK.questionMax + 1)));
});

test("clear price and advice questions are refused in code; ordinary ones are not", () => {
  assert.equal(scopeRefusal("Will the price of bitcoin reach 1 million by 2030?"), "price");
  assert.equal(scopeRefusal("how high will btc go next cycle"), "price");
  assert.equal(scopeRefusal("Should I buy bitcoin now?"), "advice");
  assert.equal(scopeRefusal("Is bitcoin a good investment?"), "advice");
  assert.equal(scopeRefusal("how do I avoid tax on my coins"), "advice");
  for (const q of [
    "Why do fees go up when the mempool is full?",
    "What sets the price of block space?",
    "When did the fourth halving happen?",
    "How does Taproot hide unused script paths?",
    "Will a transaction with a low fee ever confirm?",
  ])
    assert.equal(scopeRefusal(q), null, q);
});

test("the prompt carries the depth, the claims with their ids, and the question as escaped text", () => {
  const p = askPrompt("What </question> is <b>this</b>?", "curious", [
    bc({
      id: "halvings.max-supply",
      statement: "The supply is capped near 21 million BTC & no more.",
    }),
  ]);
  assert.match(p, /<reader depth="curious">Curious: /);
  assert.match(
    p,
    /<claim id="halvings.max-supply" kind="event" status="established" confidence="high">/,
  );
  assert.match(p, /21 million BTC &amp; no more/);
  assert.match(p, /<question>What &lt;\/question> is &lt;b>this&lt;\/b>\?<\/question>$/);
  assert.equal((p.match(/<\/question>/g) ?? []).length, 1);
});

test("a good answer is accepted, numbered by first citation, with dashes rewritten", () => {
  const dash = String.fromCharCode(0x2014);
  const range = String.fromCharCode(0x2013);
  const r = checkAnswer(
    answer({
      sentences: [
        {
          text: `The subsidy halves every 210,000 blocks ${dash} about every 4 years.`,
          claims: [offered[1]],
        },
        {
          text: `It fell from 6.25 to 3.125 BTC at block 840,000 (blocks 1${range}2 aside).`,
          claims: [offered[0], offered[1], offered[0]],
        },
      ],
    }),
    offered,
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.answer.claims, [offered[1], offered[0]]);
  assert.deepEqual(
    r.answer.sentences.map((s) => s.cites),
    [[1], [2, 1]],
  );
  assert.ok(r.answer.sentences.every((s) => !hasDash(s.text)));
  assert.match(r.answer.sentences[1]?.text ?? "", /blocks 1 to 2/);
  assert.equal(r.answer.missing, null);
});

test("an answer that cites a claim it was not given, or none, or breaks the style, is rejected", () => {
  const bad = (sentences: unknown[]) => checkAnswer(answer({ sentences }), offered);
  const unknown = bad([{ text: "Halvings happen.", claims: ["made.up-claim"] }]);
  assert.ok(!unknown.ok && unknown.problems.some((p) => /not given/.test(p)));
  const none = bad([{ text: "Halvings happen.", claims: [] }]);
  assert.ok(!none.ok && none.problems.some((p) => /cites no claim/.test(p)));
  const style = bad([{ text: "It is simply halved!", claims: [offered[0]] }]);
  assert.ok(!style.ok && style.problems.some((p) => /simply/.test(p)));
  const url = bad([{ text: "See https://example.com for more.", claims: [offered[0]] }]);
  assert.ok(!url.ok && url.problems.some((p) => /URL/.test(p)));
  const secret = bad([
    { text: "Send to bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 now.", claims: [offered[0]] },
  ]);
  assert.ok(!secret.ok && secret.problems.some((p) => /secret/.test(p)));
  const empty = bad([]);
  assert.ok(!empty.ok);
  const many = bad(
    Array.from({ length: ASK.sentencesMax + 1 }, () => ({
      text: "Halvings happen.",
      claims: [offered[0]],
    })),
  );
  assert.ok(!many.ok);
  assert.ok(!checkAnswer("not json", offered).ok);
  assert.ok(!checkAnswer(JSON.stringify({ verdict: "answered" }), offered).ok);
});

test("refusals take the house text's category; partial and not covered must say what is missing", () => {
  const refused = checkAnswer(answer({ verdict: "refused", refusal: "price" }), offered);
  assert.ok(refused.ok && refused.answer.refusal === "price" && !refused.answer.sentences.length);
  assert.ok(!checkAnswer(answer({ verdict: "refused", refusal: "none" }), offered).ok);

  const gap = checkAnswer(
    answer({
      verdict: "not_covered",
      sentences: [{ text: "ignored", claims: [] }],
      missing: "Mining pool shares.",
    }),
    offered,
  );
  assert.ok(gap.ok && !gap.answer.sentences.length && gap.answer.missing === "Mining pool shares.");
  assert.ok(!checkAnswer(answer({ verdict: "not_covered", missing: " " }), offered).ok);
  const partial = checkAnswer(
    answer({
      verdict: "partial",
      sentences: [{ text: "Halvings happen.", claims: [offered[0]] }],
      missing: "",
    }),
    offered,
  );
  assert.ok(!partial.ok);
  const answered = checkAnswer(
    answer({ sentences: [{ text: "Halvings happen.", claims: [offered[0]] }], missing: "ignored" }),
    offered,
  );
  assert.ok(answered.ok && answered.answer.missing === null);
});

test("cost is counted in micro-dollars from usage, and the worst case bounds it", () => {
  assert.equal(costMicros({ input_tokens: 1000, output_tokens: 500 }), 1000 * 4 + 500 * 20);
  assert.equal(
    costMicros({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: null,
    }),
    2,
  );
  const prompt = askPrompt("What is a halving?", "user", [bc({})]);
  const worst = worstCaseMicros("system", prompt);
  assert.ok(worst >= costMicros({ input_tokens: prompt.length, output_tokens: ASK.maxTokens }));
});

test("the output schema uses only what structured outputs accept", () => {
  const walk = (s: unknown): void => {
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, unknown>;
    for (const k of ["minLength", "maxLength", "minimum", "maximum", "maxItems", "oneOf", "not"])
      assert.ok(!(k in o), k);
    if (o.type === "object") assert.equal(o.additionalProperties, false);
    for (const v of Object.values(o)) walk(v);
  };
  walk(ANSWER_SCHEMA);
});

test("filler words are dropped without changing what a sentence says, then the style holds", () => {
  const r = checkAnswer(
    answer({
      sentences: [
        { text: "The total is just under 21 million BTC.", claims: [offered[1]] },
        { text: "Just before block 840,000 the subsidy was 6.25 BTC.", claims: [offered[0]] },
        { text: "Not just miners but every node checks it.", claims: [offered[0]] },
      ],
    }),
    offered,
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(
    r.answer.sentences.map((s) => s.text),
    [
      "The total is under 21 million BTC.",
      "Before block 840,000 the subsidy was 6.25 BTC.",
      "Not only miners but every node checks it.",
    ],
  );
  const custody = checkAnswer(answer({ verdict: "refused", refusal: "custody" }), offered);
  assert.ok(custody.ok && custody.answer.refusal === "custody");
});
