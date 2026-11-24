import assert from "node:assert/strict";
import { test } from "node:test";
import { bipView } from "../src/bipview.ts";
import { boltOf, boltView } from "../src/boltview.ts";
import { compile, type Store } from "../src/bundle.ts";
import { loadStore } from "../src/node/index.ts";
import { storeMoment } from "../src/node/moment.ts";
import { BoltIndex, type Claim, type Source, type Topic } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

// A page per BOLT: the view is assembled from the compiled bundle alone, so every line it holds is
// BOLT #0's or a published claim's, grouped as a BIP's page groups them.

const t1 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const t2 = { time: "2026-11-21T09:00:00Z", height: 976850 };
const latest = { time: "2026-11-23T11:32:53Z", height: 977197 };
const OLD = "0b5a8fbb6c4e8cc7bdc1e6ad49f6e4d3b5b5e1f0";
const HEAD = "191462825ae341f0a27098765c075f01ca9bc6c2";
const LND = "e8c1b6b4a9a5e7b0d8c4a3f2e1d0c9b8a7f6e5d4";

const bolt = (file: string, over: Partial<Source> = {}): Source => ({
  tier: "T1",
  kind: "bolt",
  title: `BOLT ${file}`,
  url: `https://github.com/lightning/bolts/blob/${OLD}/${file}#requirements`,
  locator: "Requirements",
  quote: "a short exact passage",
  accessed: "2026-11-20",
  supports: "direct",
  ...over,
});
const code: Source = {
  tier: "T1",
  kind: "code",
  title: "lnd htlcswitch",
  url: `https://github.com/lightningnetwork/lnd/blob/${LND}/htlcswitch/link.go#L10`,
  locator: "a function",
  quote: "some code",
  accessed: "2026-11-20",
  supports: "direct",
};

const made = (id: string, over: Partial<Claim>): Claim =>
  claim({
    id,
    topics: [id.split(".")[0] as string],
    first_seen: t1,
    last_verified: { ...t1, run: "2026-11-20-seed", method: "quotes 1/1" },
    revisions: [{ rev: 1, at: t1, run: "2026-11-20-seed", change: "created" }],
    checks: [],
    ...over,
  });

const claims: Claim[] = [
  made("lightning.a", { depth: "curious", sources: [bolt("02-peer-protocol.md")] }),
  made("lightning.b", {
    depth: "builder",
    kind: "trace",
    sources: [bolt("02-peer-protocol.md"), bolt("03-transactions.md"), code],
  }),
  made("lightning.readme", {
    depth: "curious",
    sources: [bolt("README.md"), bolt("bolt-simple-taproot.md")],
  }),
  made("lightning.old", {
    status: "superseded",
    superseded_by: "lightning.a",
    sources: [bolt("02-peer-protocol.md")],
  }),
];

const topics: Topic[] = [
  {
    slug: "lightning",
    title: "Lightning Network",
    lede: "lightning.a",
    contested: false,
    safety: false,
    group: "layers",
    sections: [
      {
        id: "basics",
        title: "Basics",
        depth: "curious",
        claims: ["lightning.a", "lightning.readme", "lightning.old"],
      },
      { id: "code", title: "In code", depth: "builder", claims: ["lightning.b"] },
    ],
  },
];

const H = (c: string) => c.repeat(64);
const index: BoltIndex = {
  commit: HEAD,
  read: t2,
  bolts: [
    { n: 0, title: "Introduction and Index", file: "00-introduction.md", hash: H("0") },
    {
      n: 2,
      title: "Peer Protocol for Channel Management",
      file: "02-peer-protocol.md",
      hash: H("2"),
    },
    {
      n: 3,
      title: "Bitcoin Transaction and Script Formats",
      file: "03-transactions.md",
      hash: H("3"),
    },
    { n: 8, title: "Encrypted and Authenticated Transport", file: "08-transport.md", hash: H("8") },
  ],
  // Out of time order on purpose: the view lists a BOLT's changes oldest first.
  changes: [
    { n: 2, field: "text", before: OLD, commit: HEAD, at: t2 },
    {
      n: 2,
      field: "title",
      before: "Peer Protocol",
      after: "Peer Protocol for Channel Management",
      commit: OLD,
      at: t1,
    },
    { n: 3, field: "text", before: OLD, commit: HEAD, at: t2 },
  ],
};

const store: Store = {
  wire: null,
  bips: null,
  bolts: index,
  claims,
  topics,
  proposals: [],
  debates: [],
  runs: [],
  snapshots: [],
  review: [],
};
const { bundle, issues } = compile(store, latest);

test("the fixtures compile without errors", () => {
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
  );
});

test("boltOf reads a BOLT's number from its file's link and nothing else in lightning/bolts", () => {
  assert.equal(boltOf(bolt("02-peer-protocol.md").url), 2);
  assert.equal(boltOf(`https://github.com/lightning/bolts/blob/${OLD}/12-offer-encoding.md`), 12);
  assert.equal(boltOf(`https://github.com/lightning/bolts/blob/${OLD}/00-introduction.md`), 0);
  assert.equal(boltOf(bolt("README.md").url), null, "the README is no BOLT");
  assert.equal(boltOf(bolt("bolt-simple-taproot.md").url), null, "an extension draft is no BOLT");
  assert.equal(boltOf("https://github.com/lightning/bolts/pull/1160"), null);
  assert.equal(boltOf("https://github.com/someone/bolts/blob/x/02-peer-protocol.md"), null);
  assert.equal(boltOf(undefined), null);
});

test("citations: each current claim once per BOLT it cites, never a superseded one", () => {
  assert.deepEqual(bundle.boltCitations, { 2: ["lightning.a", "lightning.b"], 3: ["lightning.b"] });
});

test("a BOLT's view: BOLT #0's entry at its commit, its text there, its changes oldest first", () => {
  const v = boltView(bundle, 2);
  assert.ok(v);
  assert.equal(v.entry.title, "Peer Protocol for Channel Management");
  assert.equal(v.text, `https://github.com/lightning/bolts/blob/${HEAD}/02-peer-protocol.md`);
  assert.equal(v.index, `https://github.com/lightning/bolts/blob/${HEAD}/00-introduction.md`);
  assert.deepEqual(
    v.history.map((c) => c.field),
    ["title", "text"],
  );
  assert.deepEqual(v.claims, ["lightning.a", "lightning.b"]);
  assert.deepEqual(
    v.topics.map((t) => [t.slug, t.depths.map((d) => [d.depth, d.claims])]),
    [
      [
        "lightning",
        [
          ["curious", ["lightning.a"]],
          ["builder", ["lightning.b"]],
        ],
      ],
    ],
  );
  assert.deepEqual(
    v.implementations.map((i) => [i.url.split("#")[0], i.claims]),
    [[`https://github.com/lightningnetwork/lnd/blob/${LND}/htlcswitch/link.go`, ["lightning.b"]]],
  );
});

test("a BOLT nothing cites has an empty view; one the index does not list has none", () => {
  const v = boltView(bundle, 8);
  assert.ok(v);
  assert.deepEqual([v.claims, v.topics, v.implementations, v.history], [[], [], [], []]);
  assert.equal(boltView(bundle, 6), null, "there is no BOLT 6");
  assert.equal(boltView({ ...bundle, bolts: null }, 2), null);
});

test("the BIP and BOLT views group the same claims the same way", () => {
  // One grouping (citingGroups) serves both, so a claim reads the same on either page.
  const asBip = bipView(
    {
      ...bundle,
      bips: {
        commit: HEAD,
        read: t2,
        bips: [{ n: 2, title: "x", type: "Process", status: "Active" }],
        changes: [],
      },
      bipCitations: { 2: bundle.boltCitations[2] ?? [] },
    },
    2,
  );
  const asBolt = boltView(bundle, 2);
  assert.ok(asBip && asBolt);
  assert.deepEqual(
    [asBip.claims, asBip.topics, asBip.marks, asBip.implementations],
    [asBolt.claims, asBolt.topics, asBolt.marks, asBolt.implementations],
  );
});

test("the committed store: every BOLT BOLT #0 lists has a view whose lines all trace to claims", () => {
  const real = loadStore();
  assert.deepEqual(
    real.issues.filter((i) => i.file === "knowledge/bolts.json"),
    [],
  );
  const { bundle: b } = compile(real.store, storeMoment(real.store));
  assert.ok(b.bolts, "knowledge/bolts.json is loaded");
  assert.ok(BoltIndex.safeParse(b.bolts).success);
  for (const entry of b.bolts.bolts) {
    const v = boltView(b, entry.n);
    assert.ok(v, `BOLT ${entry.n} has a view`);
    for (const id of v.claims)
      assert.ok(
        b.claims[id]?.sources.some((s) => boltOf(s.url) === entry.n),
        `${id} is published and cites BOLT ${entry.n}`,
      );
  }
  const peer = boltView(b, 2);
  assert.ok(peer && peer.claims.length > 0, "BOLT 2 is cited");
});
