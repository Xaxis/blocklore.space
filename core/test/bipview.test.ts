import assert from "node:assert/strict";
import { test } from "node:test";
import { bipInCore, bipOf, bipView, claimMarks } from "../src/bipview.ts";
import { compile, type Store } from "../src/bundle.ts";
import { loadStore } from "../src/node/index.ts";
import { storeMoment } from "../src/node/moment.ts";
import type { BipIndex, Claim, CoreBips, Source, Topic } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

// A page per BIP (BACKLOG 16): the view is assembled from the compiled bundle alone, so every
// line it holds is the index's or a published claim's.

const t1 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const t2 = { time: "2026-11-21T09:00:00Z", height: 976850 };
const latest = { time: "2026-11-23T11:32:53Z", height: 977197 };
const BIPS_AT = "a7f91321f25b5be8d93e901775621c21519e80b7";
const INDEX_AT = "fdcd8024595bc1e97db73883e716dbb91627c371";
const CORE_AT = "f498a5a6718d9157b6afb85412c3462439117702";

const bip = (n: number, over: Partial<Source> = {}): Source => ({
  tier: "T1",
  kind: "bip",
  title: `BIP ${n}`,
  url: `https://github.com/bitcoin/bips/blob/${BIPS_AT}/bip-${String(n).padStart(4, "0")}.mediawiki#specification`,
  locator: "Specification",
  quote: "a short exact passage",
  accessed: "2026-11-20",
  supports: "direct",
  ...over,
});
const code = (path: string, anchor = "", over: Partial<Source> = {}): Source => ({
  tier: "T1",
  kind: "code",
  title: `Bitcoin Core ${path}`,
  url: `https://github.com/bitcoin/bitcoin/blob/${CORE_AT}/${path}${anchor}`,
  locator: "a function",
  quote: "some code",
  accessed: "2026-11-20",
  supports: "direct",
  ...over,
});
const pr: Source = {
  tier: "T1",
  kind: "pr",
  title: "Bitcoin Core PR #19953",
  url: "https://github.com/bitcoin/bitcoin/pull/19953",
  locator: "description",
  quote: "Implements BIP 340 to 342.",
  accessed: "2026-11-20",
  supports: "background",
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
  made("taproot.a", { depth: "curious", kind: "definition", sources: [bip(341)] }),
  made("taproot.b", {
    depth: "builder",
    kind: "trace",
    sources: [bip(341), code("src/script/interpreter.cpp", "#L1890"), pr],
  }),
  made("taproot.c", {
    depth: "curious",
    sources: [bip(341, { supports: "partial" }), code("src/script/interpreter.cpp", "#L12")],
  }),
  made("segwit.d", {
    depth: "researcher",
    kind: "argument",
    status: "contested",
    confidence: "medium",
    people: ["Jane Doe"],
    attributed_to: [{ name: "Jane Doe", url: "https://delvingbitcoin.org/t/x/1/2" }],
    review: { by: "owner", reasons: ["contested status"], at: t1.time },
    sources: [bip(341), bip(141)],
  }),
  made("segwit.e", {
    depth: "builder",
    kind: "trace",
    sources: [bip(141), code("src/validation.cpp")],
  }),
  made("taproot.old", {
    status: "superseded",
    superseded_by: "taproot.a",
    sources: [bip(341), code("src/old.cpp")],
  }),
  made("taproot.gone", {
    status: "withdrawn",
    last_verified: { ...t2, run: "2026-11-21-revoke", method: "withdrawn" },
    run: "2026-11-21-revoke",
    sources: [bip(341), code("src/gone.cpp")],
    revisions: [
      { rev: 1, at: t1, run: "2026-11-20-seed", change: "created" },
      {
        rev: 2,
        at: t2,
        run: "2026-11-21-revoke",
        change: "withdrawn",
        note: "Withdrawn by the owner: the source did not say this.",
        before: { status: "established" },
      },
    ],
  }),
];

const topic = (slug: string, title: string, sections: Topic["sections"]): Topic => ({
  slug,
  title,
  lede: sections[0]?.claims[0] as string,
  contested: false,
  safety: false,
  group: "protocol",
  sections,
});
const topics: Topic[] = [
  topic("segwit", "SegWit", [
    { id: "basics", title: "Basics", depth: "builder", claims: ["segwit.e", "segwit.d"] },
  ]),
  topic("taproot", "Taproot", [
    {
      id: "basics",
      title: "Basics",
      depth: "curious",
      claims: ["taproot.c", "taproot.a", "taproot.gone"],
    },
    { id: "code", title: "In code", depth: "builder", claims: ["taproot.b", "taproot.old"] },
  ]),
];

const index: BipIndex = {
  commit: INDEX_AT,
  read: t2,
  bips: [
    {
      n: 141,
      layer: "Consensus (soft fork)",
      title: "Segregated Witness (Consensus layer)",
      type: "Specification",
      status: "Deployed",
      file: "bip-0141.mediawiki",
    },
    {
      n: 341,
      layer: "Consensus (soft fork)",
      title: "Taproot: SegWit version 1 spending rules",
      type: "Specification",
      status: "Deployed",
      file: "bip-0341.mediawiki",
    },
    { n: 40, title: "Stratum wire protocol", type: "Standard", status: "BIP number allocated" },
  ],
  // Out of time order on purpose: the view lists an entry's changes oldest first.
  changes: [
    {
      n: 341,
      title: "Taproot: SegWit version 1 spending rules",
      field: "status",
      before: "Final",
      after: "Deployed",
      commit: INDEX_AT,
      at: t2,
    },
    {
      n: 141,
      title: "Segregated Witness (Consensus layer)",
      field: "status",
      before: "Final",
      after: "Deployed",
      commit: INDEX_AT,
      at: t2,
    },
    {
      n: 341,
      title: "Taproot: SegWit version 1 spending rules",
      field: "added",
      after: "Draft",
      commit: BIPS_AT,
      at: t1,
    },
  ],
};

const store: Store = {
  wire: null,
  bips: index,
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

test("a BIP's view: the index entry at its commit, its text there, its changes oldest first", () => {
  const v = bipView(bundle, 341);
  assert.ok(v);
  assert.equal(v.entry.title, "Taproot: SegWit version 1 spending rules");
  assert.equal(v.entry.status, "Deployed");
  assert.equal(v.commit, INDEX_AT);
  assert.deepEqual(v.read, t2);
  assert.equal(v.text, `https://github.com/bitcoin/bips/blob/${INDEX_AT}/bip-0341.mediawiki`);
  assert.equal(v.index, `https://github.com/bitcoin/bips/blob/${INDEX_AT}/README.mediawiki`);
  assert.deepEqual(
    v.history.map((c) => [c.field, c.after]),
    [
      ["added", "Draft"],
      ["status", "Deployed"],
    ],
  );
});

test("citing claims group by primary topic, most claims first, then by depth in reading order", () => {
  const v = bipView(bundle, 341);
  assert.ok(v);
  assert.deepEqual(v.topics, [
    {
      slug: "taproot",
      title: "Taproot",
      depths: [
        { depth: "curious", claims: ["taproot.c", "taproot.a"] },
        { depth: "builder", claims: ["taproot.b"] },
      ],
    },
    { slug: "segwit", title: "SegWit", depths: [{ depth: "researcher", claims: ["segwit.d"] }] },
  ]);
  assert.deepEqual(v.claims, ["taproot.c", "taproot.a", "taproot.b", "segwit.d"]);
  // Superseded and withdrawn claims are never shown as citing it.
  assert.ok(!v.claims.includes("taproot.old"));
  assert.ok(!v.claims.includes("taproot.gone"));
});

test("contested claims, stances and arguments are marked, never left as plain statements", () => {
  const v = bipView(bundle, 341);
  assert.deepEqual(v?.marks, { "segwit.d": ["contested", "argument"] });
  assert.deepEqual(claimMarks({ kind: "stance", status: "established" }), ["stance"]);
  assert.deepEqual(claimMarks({ kind: "fact", status: "established" }), []);
});

test("code appears only where a claim citing the BIP cites it, once per file", () => {
  const v = bipView(bundle, 341);
  assert.deepEqual(v?.implementations, [
    {
      title: "Bitcoin Core src/script/interpreter.cpp",
      url: `https://github.com/bitcoin/bitcoin/blob/${CORE_AT}/src/script/interpreter.cpp#L1890`,
      kind: "code",
      repo: "bitcoin/bitcoin",
      // In the order the page lists the claims: taproot.c is Curious, taproot.b Builder.
      claims: ["taproot.c", "taproot.b"],
    },
  ]);
  // BIP 141's code comes from segwit.e alone; the contested claim citing both cites no code.
  assert.deepEqual(
    bipView(bundle, 141)?.implementations.map((i) => [i.title, i.claims]),
    [["Bitcoin Core src/validation.cpp", ["segwit.e"]]],
  );
});

test("a BIP nothing cites has an empty view; one the index does not list has none", () => {
  const v = bipView(bundle, 40);
  assert.ok(v);
  assert.equal(v.text, null);
  assert.deepEqual([v.claims, v.topics, v.implementations, v.history], [[], [], [], []]);
  assert.equal(bipView(bundle, 9999), null);
  assert.equal(bipView({ ...bundle, bips: null }, 341), null);
});

test("bipOf reads the BIP number from a bitcoin/bips link and nothing else", () => {
  assert.equal(bipOf(bip(341).url), 341);
  assert.equal(bipOf(`https://github.com/bitcoin/bips/blob/${BIPS_AT}/bip-0054.md`), 54);
  assert.equal(bipOf("https://github.com/bitcoin/bitcoin/blob/x/src/validation.cpp"), null);
  assert.equal(bipOf(undefined), null);
});

test("the committed store: every BIP in the index has a view whose lines all trace to claims", () => {
  const real = loadStore();
  const { bundle: b } = compile(real.store, storeMoment(real.store));
  assert.ok(b.bips, "knowledge/bips.json is loaded");
  for (const entry of b.bips.bips) {
    const v = bipView(b, entry.n);
    assert.ok(v, `BIP ${entry.n} has a view`);
    for (const id of v.claims) {
      const c = b.claims[id];
      assert.ok(c, `${id} is published`);
      assert.ok(
        c.sources.some((s) => bipOf(s.url) === entry.n),
        `${id} cites BIP ${entry.n}`,
      );
    }
    for (const i of v.implementations)
      for (const id of i.claims) {
        assert.ok(v.claims.includes(id), `${i.title} comes from a claim citing BIP ${entry.n}`);
        assert.ok(
          b.claims[id]?.sources.some((s) => s.url?.split("#")[0] === i.url.split("#")[0]),
          `${id} cites ${i.url}`,
        );
      }
  }
  const taproot = bipView(b, 341);
  assert.ok(taproot && taproot.claims.length > 0, "BIP 341 is cited");
});

test("Bitcoin Core's own entry shows on each BIP it names, linked at its line, with its changes", () => {
  const at = { time: "2026-11-24T05:19:06Z", height: 977324 };
  const commit = "d".repeat(40);
  const list: CoreBips = {
    commit,
    read: at,
    entries: [
      {
        bips: [340, 341, 342],
        text: "Validation rules for Taproot are implemented as of v0.21.0 (PR 19953).",
        since: "v0.21.0",
        prs: [19953],
        line: 58,
      },
    ],
    changes: [{ n: 341, field: "added", after: "Validation rules...", commit, at }],
  };
  const v = bipInCore(list, 341);
  assert.deepEqual(v, {
    text: "Validation rules for Taproot are implemented as of v0.21.0 (PR 19953).",
    with: [340, 342],
    since: "v0.21.0",
    prs: [{ n: 19953, url: "https://github.com/bitcoin/bitcoin/pull/19953" }],
    commit,
    read: at,
    url: `https://github.com/bitcoin/bitcoin/blob/${commit}/doc/bips.md#L58`,
    history: list.changes,
  });
  assert.equal(bipInCore(list, 9), null);
  assert.equal(bipInCore(null, 341), null);
  assert.deepEqual(bipView({ ...bundle, coreBips: list }, 341)?.core, v);
  assert.equal(bipView(bundle, 341)?.core, null);
});

test("the committed store: Core's list reaches the bundle and every BIP it names that the index lists", () => {
  const real = loadStore();
  assert.deepEqual(
    real.issues.filter((i) => i.file === "knowledge/core-bips.json"),
    [],
  );
  const { bundle: b } = compile(real.store, storeMoment(real.store));
  assert.ok(b.coreBips && b.coreBips.entries.length > 50, "knowledge/core-bips.json is loaded");
  for (const e of b.coreBips.entries)
    for (const n of e.bips) {
      if (!b.bips?.bips.some((x) => x.n === n)) continue;
      const v = bipView(b, n);
      assert.equal(v?.core?.text, e.text, `BIP ${n} shows Core's words`);
      assert.match(v?.core?.url ?? "", /\/doc\/bips\.md#L\d+$/);
    }
  assert.equal(bipView(b, 341)?.core?.since, "v0.21.0");
});
