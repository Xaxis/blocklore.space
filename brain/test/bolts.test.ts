import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BoltIndex } from "@blocklore/core";
import { diffBolts, parseBoltIndex, refreshBolts, sha256 } from "../src/bolts.ts";

// Real lines of BOLT #0 (lightning/bolts 00-introduction.md at 191462825a): its heading and its
// numbered list, which skips 6.
const INTRO = `# BOLT #0: Introduction and Index

Welcome, friend! These Basis of Lightning Technology (BOLT) documents
describe a layer-2 protocol for off-chain bitcoin transfer by mutual
cooperation, relying on on-chain transactions for enforcement if
necessary.

1. [BOLT #1](01-messaging.md): Base Protocol
2. [BOLT #2](02-peer-protocol.md): Peer Protocol for Channel Management
3. [BOLT #3](03-transactions.md): Bitcoin Transaction and Script Formats
4. [BOLT #4](04-onion-routing.md): Onion Routing Protocol
5. [BOLT #5](05-onchain.md): Recommendations for On-chain Transaction Handling
7. [BOLT #7](07-routing-gossip.md): P2P Node and Channel Discovery
8. [BOLT #8](08-transport.md): Encrypted and Authenticated Transport
9. [BOLT #9](09-features.md): Assigned Feature Flags
10. [BOLT #10](10-dns-bootstrap.md): DNS Bootstrap and Assisted Node Location
11. [BOLT #11](11-payment-encoding.md): Invoice Protocol for Lightning Payments
12. [BOLT #12](12-offer-encoding.md): Negotiation Protocol for Lightning Payments

## The Spark: A Short Introduction to Lightning
`;

const A = "a".repeat(40);
const B = "b".repeat(40);
const AT = { time: "2026-11-24T07:00:00Z", height: 977340 };

test("BOLT #0's own list: its heading as BOLT 0, then each numbered BOLT with its file", () => {
  const list = parseBoltIndex(INTRO);
  assert.equal(list.length, 12);
  assert.deepEqual(list[0], { n: 0, title: "Introduction and Index", file: "00-introduction.md" });
  assert.deepEqual(list[1], { n: 1, title: "Base Protocol", file: "01-messaging.md" });
  assert.deepEqual(
    list.map((b) => b.n),
    [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(list.find((b) => b.n === 12)?.title, "Negotiation Protocol for Lightning Payments");
});

test("an index that cannot be trusted throws instead of writing", () => {
  assert.throws(() => parseBoltIndex(INTRO.replace("# BOLT #0:", "# Intro:")), /no heading/);
  assert.throws(() => parseBoltIndex("# BOLT #0: Introduction and Index\n"), /lists no BOLT/);
  assert.throws(
    () => parseBoltIndex(INTRO.replace("[BOLT #2](02-peer", "[BOLT #2](03-peer")),
    /BOLT #2 points at 03-peer-protocol.md/,
  );
  assert.throws(
    () => parseBoltIndex(`${INTRO}\n1. [BOLT #1](01-messaging.md): Base Protocol\n`),
    /BOLT #1 is listed twice/,
  );
});

test("changes between readings: added, removed, retitled, and a text that moved", () => {
  const was = [
    { n: 1, title: "Base Protocol", file: "01-messaging.md", hash: sha256("one") },
    { n: 2, title: "Peer Protocol", file: "02-peer-protocol.md", hash: sha256("two") },
    { n: 3, title: "Transactions", file: "03-transactions.md", hash: sha256("three") },
  ];
  const now = [
    { n: 1, title: "Base Protocol", file: "01-messaging.md", hash: sha256("one") },
    {
      n: 2,
      title: "Peer Protocol for Channel Management",
      file: "02-peer-protocol.md",
      hash: sha256("two, edited"),
    },
    { n: 12, title: "Offers", file: "12-offer-encoding.md", hash: sha256("twelve") },
  ];
  assert.deepEqual(diffBolts({ commit: A, bolts: was }, now, B, AT), [
    {
      n: 2,
      field: "title",
      before: "Peer Protocol",
      after: "Peer Protocol for Channel Management",
      commit: B,
      at: AT,
    },
    { n: 2, field: "text", before: A, commit: B, at: AT },
    { n: 3, field: "removed", before: "Transactions", commit: B, at: AT },
    { n: 12, field: "added", after: "Offers", commit: B, at: AT },
  ]);
  assert.deepEqual(diffBolts({ commit: A, bolts: was }, was, B, AT), [], "nothing moved");
});

test("the step: a first reading is the baseline, the same head reads nothing, a moved text is one change", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolts-"));
  const file = path.join(dir, "bolts.json");
  const before = process.env.BLOCKLORE_BOLTS_FILE;
  process.env.BLOCKLORE_BOLTS_FILE = file;
  const chain = { name: "test", tipHeight: async () => AT.height } as never;
  const texts: Record<string, string> = { "00-introduction.md": INTRO };
  let reads = 0;
  const read = async (_sha: string, f: string) => {
    reads++;
    return texts[f] ?? `text of ${f}`;
  };
  try {
    const run = (head: string) =>
      refreshBolts({ commit: false, push: false }, { head: () => head, read, chain });
    await run(A);
    let index = BoltIndex.parse(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(index.commit, A);
    assert.equal(index.bolts.length, 12);
    assert.deepEqual(index.changes, [], "the first reading is the baseline");
    assert.equal(index.read.height, AT.height);
    assert.equal(index.bolts[0]?.hash, sha256(INTRO), "each hash is of the file's text");
    reads = 0;
    await run(A);
    assert.equal(reads, 0, "the same head reads nothing");
    await run(B);
    assert.equal(
      BoltIndex.parse(JSON.parse(readFileSync(file, "utf8"))).commit,
      A,
      "a new head with the same index and texts writes nothing",
    );
    texts["02-peer-protocol.md"] = "an edited BOLT 2";
    await run(B);
    index = BoltIndex.parse(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(index.commit, B);
    assert.deepEqual(
      index.changes.map((c) => [c.n, c.field, c.before, c.commit]),
      [[2, "text", A, B]],
    );
  } finally {
    if (before === undefined) delete process.env.BLOCKLORE_BOLTS_FILE;
    else process.env.BLOCKLORE_BOLTS_FILE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
