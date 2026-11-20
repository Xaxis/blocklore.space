import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanQuestion, type QueueItem, QueueUpdate, queueId, queueOrder } from "../src/queue.ts";

test("links are stripped from a queued question, words are kept", () => {
  assert.equal(
    cleanQuestion("What is Ark? see https://example.com/x?y=1 and www.spam.io too"),
    "What is Ark? see and too",
  );
  assert.equal(cleanQuestion("Explain   evil.com/path   please"), "Explain please");
  assert.equal(
    cleanQuestion("Is Ark safe? mail me at a.b+c@mail.example.org or @satoshi_fan"),
    "Is Ark safe? mail me at or",
  );
  assert.equal(
    cleanQuestion("Who runs npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m now?"),
    "Who runs now?",
  );
  assert.equal(
    cleanQuestion("Why is block 840,000 special for the subsidy?"),
    "Why is block 840,000 special for the subsidy?",
  );
});

test("one question has one id whatever its case, spacing or punctuation", () => {
  const a = queueId("What is Ark?");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(queueId("  what IS ark"), a);
  assert.equal(queueId("What is Ark? https://example.com"), a);
  assert.notEqual(queueId("What is a statechain?"), a);
});

test("updates from the brain are validated, and the public order puts open questions first", () => {
  assert.ok(
    QueueUpdate.safeParse({
      id: "0123456789abcdef",
      status: "answered",
      claims: ["lightning.what-it-is"],
    }).success,
  );
  assert.ok(!QueueUpdate.safeParse({ id: "0123456789abcdef", status: "deleted" }).success);
  assert.ok(!QueueUpdate.safeParse({ id: "xyz", status: "queued" }).success);
  assert.ok(
    !QueueUpdate.safeParse({ id: "0123456789abcdef", status: "answered", claims: ["Not An Id"] })
      .success,
  );
  const item = (id: string, status: QueueItem["status"], asks: number, at: string): QueueItem => ({
    id,
    q: id,
    missing: null,
    at,
    asks,
    status,
    claims: [],
    note: null,
    updated: at,
  });
  const sorted = [
    item("answered", "answered", 9, "2026-11-01"),
    item("old", "queued", 1, "2026-11-02"),
    item("popular", "researching", 4, "2026-11-10"),
    item("new", "queued", 1, "2026-11-12"),
  ].sort(queueOrder);
  assert.deepEqual(
    sorted.map((i) => i.id),
    ["popular", "old", "new", "answered"],
  );
});
