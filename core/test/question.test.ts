import assert from "node:assert/strict";
import { test } from "node:test";
import { QUESTION_MAX, readQuestion } from "../src/question.ts";

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
  assert.ok("error" in readQuestion("x".repeat(QUESTION_MAX + 1)));
});
