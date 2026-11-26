import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanQuestion,
  outOfBounds,
  type QueueItem,
  QueueUpdate,
  queueId,
  queueOrder,
  takenBy,
} from "../src/queue.ts";
import { nearestScope, specificWords } from "../src/search.ts";

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

test("each reader question lists the published runs that carried it, oldest first", () => {
  const run = (id: string, time: string, asked?: string[]) => ({
    id,
    started: { time, height: 0 },
    ...(asked ? { asked } : {}),
  });
  const a = "0123456789abcdef";
  const b = "fedcba9876543210";
  const taken = takenBy([
    run("2026-11-26-daily-segwit", "2026-11-26T01:00:00Z", [a]),
    run("2026-11-25-daily-lightning", "2026-11-25T01:00:00Z", [a, b]),
    run("2026-11-24-daily-taproot", "2026-11-24T01:00:00Z"),
  ]);
  assert.deepEqual(taken.get(a), ["2026-11-25-daily-lightning", "2026-11-26-daily-segwit"]);
  assert.deepEqual(taken.get(b), ["2026-11-25-daily-lightning"]);
  assert.equal(taken.size, 2);
});

test("a question asking for a price prediction or trading advice is out of bounds, and only that", () => {
  assert.equal(outOfBounds("What will the price of bitcoin be next year?"), "price");
  assert.equal(outOfBounds("Can you predict the BTC price by 2030?"), "price");
  assert.equal(outOfBounds("Should I buy bitcoin now?"), "advice");
  assert.equal(outOfBounds("Is now a good time to buy?"), "advice");
  assert.equal(outOfBounds("What was the price of bitcoin when the first halving happened?"), null);
  // A question about how something is priced, even in the future, is a question about Bitcoin.
  assert.equal(
    outOfBounds("How will the fee market price block space after the subsidy ends?"),
    null,
  );
  assert.equal(outOfBounds("How are transaction fees priced in sats per vbyte?"), null);
  assert.equal(outOfBounds("Should I use a hardware signer?"), null);
});

test("a question goes to the agenda topic whose scope is nearest its own words, then to claims", () => {
  const agenda = [
    {
      slug: "self-custody",
      title: "Self-custody",
      scope: "Seed phrases, backups and signing devices.",
    },
    {
      slug: "cryptography",
      title: "Cryptography",
      scope: "Schnorr signatures and the secp256k1 curve.",
    },
  ];
  assert.deepEqual(specificWords("Does Bitcoin work?"), "");
  assert.equal(
    nearestScope(agenda, "How do I keep my seed phrase safe from fire?"),
    "self-custody",
  );
  assert.equal(nearestScope(agenda, "Why does Bitcoin use the secp256k1 curve?"), "cryptography");
  assert.equal(nearestScope(agenda, "Does bitcoin work?"), null, "no words of its own");
  assert.equal(nearestScope(agenda, "Who mints Chaumian ecash?"), null);
});

test("filler never places a question, and a scope's title outweighs a word in another's scope", () => {
  assert.equal(specificWords("Why are my transaction fees so high right now?"), "transaction fees");
  assert.equal(specificWords("What happens in a 51% attack?"), "51 attack");
  const zw = String.fromCharCode(0x200b);
  assert.equal(
    specificWords(`How are Light${zw}ning channels closed?`),
    "Lightning channels closed",
  );
  // The real agenda's shape: one scope names a BIP and "decides", the BIP process's title names
  // BIPs and its scope never says "merged". At an even title weight this went to proof-of-work.
  const agenda = [
    {
      slug: "proof-of-work",
      title: "Proof of work",
      scope: "Difficulty, timestamps and the BIP that decides how a block's time is checked.",
    },
    {
      slug: "bip-process",
      title: "The BIP process",
      scope:
        "How a BIP is written, numbered and discussed by its editors, and what each status means over time.",
    },
  ];
  assert.equal(
    nearestScope(agenda, "What is a BIP and who decides if it gets merged?"),
    "bip-process",
  );
});
