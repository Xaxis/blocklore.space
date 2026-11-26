import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AdvisoryMap,
  type AdvisoryRecord,
  advisoryMapIssues,
  advisoryReport,
  checkCve,
  EMPTY_ADVISORY_MAP,
  hasWords,
  idsIn,
  matchAdvisory,
  type NvdRecord,
  namedProducts,
  pageProject,
  threatCites,
  threatCves,
} from "../src/advisories.ts";
import type { BundleClaim, BundleTopic } from "../src/bundle.ts";
import { advisoryTopics, gapMap } from "../src/gaps.ts";
import { loadStore } from "../src/node/index.ts";
import { securityView, type Threat } from "../src/security.ts";
import { claim } from "./fixtures.ts";

const threat = (over: Partial<Threat> = {}): Threat => ({
  id: "peer-dos",
  title: "Peers that try to crash a node or exhaust its memory, disk or CPU",
  layer: "network",
  status: "watching",
  topic: "p2p-network",
  claims: [],
  mitigations: [],
  history: [],
  watches: ["advisories"],
  lab: [],
  terms: [],
  ...over,
});

const advisory = (over: Partial<AdvisoryRecord> = {}): AdvisoryRecord => ({
  source: "Bitcoin Core",
  title: "CVE-2024-52915 - Memory DoS using huge INV messages",
  url: "https://bitcoincore.org/en/2024/07/03/disclose-inv-buffer-blowup/",
  published: "2024-07-03T04:00:00Z",
  severity: "medium",
  ids: ["CVE-2024-52915"],
  ...over,
});

const map = (over: Partial<AdvisoryMap> = {}): AdvisoryMap => ({
  ...EMPTY_ADVISORY_MAP,
  products: {
    "Bitcoin Core": {
      cpe: ["bitcoin:*"],
      words: ["Bitcoin Core", "bitcoind"],
      pages: ["bitcoincore.org", "github.com/bitcoin/bitcoin"],
    },
    LND: {
      cpe: ["lightning_labs:lnd"],
      words: ["lnd"],
      pages: ["github.com/lightningnetwork/lnd"],
    },
  },
  ...over,
});

const record = (over: Partial<NvdRecord> = {}): NvdRecord => ({
  id: "CVE-2013-5700",
  checked: "2026-11-23T12:00:00Z",
  found: true,
  status: "Modified",
  published: "2013-09-10T00:00:00Z",
  products: ["bitcoin:bitcoind"],
  description: "The Bloom Filter implementation in bitcoind and Bitcoin-Qt 0.8.x before 0.8.4rc1",
  ...over,
});

const only = (a: AdvisoryRecord, threats: Threat[], m = map()) =>
  matchAdvisory(a, threats, m).map((x) => [x.threat, x.rule, x.by]);

test("words match whole, in any case and spacing, never inside a longer word", () => {
  assert.ok(hasWords("CVE-2024-52915 - Memory DoS using huge INV messages", "memory dos"));
  assert.ok(hasWords("Memory  DoS", "memory DoS"));
  assert.ok(hasWords("lightningnetwork/lnd: CVE-2024-38359", "lnd"));
  assert.ok(!hasWords("Memory DoSing", "memory DoS"));
  assert.ok(!hasWords("inventory", "inv"));
  assert.ok(!hasWords("a.b", "a.c"), "a dot in the words is a dot, not any character");
  assert.deepEqual(idsIn("x cve-2024-1234 GHSA-9GXX-58Q6-42P7 CVE-2024-1234"), [
    "CVE-2024-1234",
    "GHSA-9gxx-58q6-42p7",
  ]);
});

test("record: an advisory whose page the threat's history cites is filed there", () => {
  const t = threat({
    history: [
      {
        ref: "Inv buffer",
        url: "https://bitcoincore.org/en/2024/07/03/disclose-inv-buffer-blowup",
      },
    ],
  });
  assert.deepEqual(only(advisory({ ids: [] }), [t]), [
    ["peer-dos", "record", ["https://bitcoincore.org/en/2024/07/03/disclose-inv-buffer-blowup/"]],
  ]);
});

test("id: a CVE or GHSA id the threat's history or terms name files it there", () => {
  const byHistory = threat({
    history: [{ ref: "NVD", url: "https://nvd.nist.gov/vuln/detail/CVE-2024-52915" }],
  });
  assert.deepEqual(only(advisory(), [byHistory]), [["peer-dos", "id", ["CVE-2024-52915"]]]);
  const byTerm = threat({ id: "lightning-bugs", terms: ["GHSA-9gxx-58q6-42p7"] });
  const lnd = advisory({
    source: "LND",
    title: "lightningnetwork/lnd: CVE-2024-38359 LND Onion Bomb",
    url: "https://github.com/lightningnetwork/lnd/security/advisories/GHSA-9gxx-58q6-42p7",
    ids: ["CVE-2024-38359", "GHSA-9gxx-58q6-42p7"],
  });
  assert.deepEqual(only(lnd, [byTerm]), [["lightning-bugs", "id", ["GHSA-9gxx-58q6-42p7"]]]);
});

test("source: the map files every advisory of a project under a threat", () => {
  const t = threat({ id: "lightning-bugs" });
  const m = map({ sources: { "lightning-bugs": ["LND"] } });
  assert.deepEqual(only(advisory({ source: "LND", ids: [] }), [t], m), [
    ["lightning-bugs", "source", ["LND"]],
  ]);
  assert.deepEqual(only(advisory({ ids: [] }), [t], m), [], "a Bitcoin Core advisory is not LND's");
});

test("term: one of the threat's own names in the title files it, and says which", () => {
  const t = threat({ id: "header-spam", terms: ["low-difficulty headers", "CVE-2019-25220"] });
  const a = advisory({
    title: "CVE-2024-52916 - Memory DoS using low-difficulty headers",
    ids: ["CVE-2024-52916"],
  });
  assert.deepEqual(only(a, [t]), [["header-spam", "term", ["low-difficulty headers"]]]);
});

test("keyword: the map's words in the title file it, and every matching word is shown", () => {
  const m = map({ keywords: { "peer-dos": ["memory DoS", "DoS using", "disk filling"] } });
  assert.deepEqual(only(advisory(), [threat()], m), [
    ["peer-dos", "keyword", ["memory DoS", "DoS using"]],
  ]);
  assert.deepEqual(only(advisory(), [threat()]), [], "without the map's words nothing files it");
});

test("owner: the map's placement wins and names the key; exclude takes a threat away", () => {
  const dos = threat();
  const stall = threat({ id: "block-stalling", terms: ["INV messages"] });
  const m = map({
    keywords: { "peer-dos": ["memory DoS"] },
    assign: { "CVE-2024-52915": ["block-stalling"] },
  });
  assert.deepEqual(only(advisory(), [dos, stall], m), [
    ["peer-dos", "keyword", ["memory DoS"]],
    ["block-stalling", "owner", ["CVE-2024-52915"]],
  ]);
  const byPage = map({
    assign: { "https://bitcoincore.org/en/2024/07/03/disclose-inv-buffer-blowup": ["peer-dos"] },
  });
  assert.deepEqual(only(advisory(), [dos], byPage)[0]?.[1], "owner", "a page key matches too");
  const vetoed = map({ ...m, exclude: { "CVE-2024-52915": ["peer-dos", "block-stalling"] } });
  assert.deepEqual(only(advisory(), [dos, stall], vetoed), []);
});

test("an advisory nothing files is a gap for the owner; one the owner placed nowhere is not", () => {
  const log = {
    updated: "2026-11-23T00:00:00Z",
    advisories: [
      advisory(),
      advisory({
        title: "Disclosure of CVE-2020-14198",
        url: "https://bitcoincore.org/a/",
        ids: ["CVE-2020-14198"],
      }),
      advisory({
        title: "CVE-2024-52918 - Crash using malicious BIP72 URI",
        url: "https://bitcoincore.org/b/",
        ids: ["CVE-2024-52918"],
      }),
    ],
    nvd: [],
  };
  const m = map({ keywords: { "peer-dos": ["memory DoS"] }, assign: { "CVE-2024-52918": [] } });
  const r = advisoryReport({ threats: [threat()], log, map: m, claims: [] });
  assert.deepEqual(
    r.unmatched.map((a) => a.ids[0]),
    ["CVE-2020-14198"],
  );
  assert.equal(r.advisories.find((a) => a.ids[0] === "CVE-2024-52918")?.placed, true);
  assert.deepEqual(r.counts, {
    advisories: 3,
    matched: 1,
    unmatched: 1,
    cves: 0,
    checked: 0,
    found: 0,
    mismatched: 0,
    unnamed: 0,
  });
  const gaps = gapMap({
    claims: {},
    topics: [],
    review: [],
    rechecks: {},
    scorecard: null,
    advisories: r.unmatched,
  });
  assert.deepEqual(
    gaps.advisories.map((a) => [a.title, a.ids]),
    [["Disclosure of CVE-2020-14198", ["CVE-2020-14198"]]],
  );
  assert.equal(gaps.topics.length, 0, "an unmapped advisory never becomes research's topic");
});

test("the security view lists each threat's advisories with the rule, and its CVE checks", () => {
  const t = threat({
    history: [{ ref: "CVE-2013-5700", url: "https://nvd.nist.gov/vuln/detail/CVE-2013-5700" }],
  });
  const view = securityView(
    {
      threats: [t],
      watches: null,
      lab: null,
      advisories: { updated: "2026-11-23T00:00:00Z", advisories: [advisory()], nvd: [record()] },
      advisoryMap: map({ keywords: { "peer-dos": ["memory DoS"] } }),
    },
    new Set(),
  );
  const v = view.layers.find((l) => l.id === "network")?.threats[0];
  assert.deepEqual(
    v?.advisories.map((a) => [a.title, a.rule, a.by, a.nvd.map((n) => n.state)]),
    [
      [
        "CVE-2024-52915 - Memory DoS using huge INV messages",
        "keyword",
        ["memory DoS"],
        ["unchecked"],
      ],
    ],
  );
  assert.deepEqual(
    v?.cves.map((c) => [c.id, c.finding, c.named, c.nvd.published]),
    [["CVE-2013-5700", null, ["Bitcoin Core"], "2013-09-10T00:00:00Z"]],
  );
  assert.equal(view.advisories.counts.found, 1);
});

test("the threat map's CVE ids are found with where each threat names them", () => {
  const cves = threatCves([
    threat({
      history: [
        { ref: "NVD: CVE-2014-8275", url: "https://nvd.nist.gov/vuln/detail/CVE-2014-8275" },
      ],
      terms: ["CVE-2014-8275"],
    }),
    threat({ id: "signature-library", terms: ["CVE-2014-8275", "strict DER"] }),
  ]);
  assert.deepEqual(
    [...cves],
    [
      [
        "CVE-2014-8275",
        [
          { id: "peer-dos", where: ["history", "terms"] },
          { id: "signature-library", where: ["terms"] },
        ],
      ],
    ],
  );
});

test("NVD check: a record NVD lacks or rejected is a mismatch, a matching product is not", () => {
  const t = threat({
    history: [{ ref: "CVE-2013-5700", url: "https://nvd.nist.gov/vuln/detail/CVE-2013-5700" }],
  });
  const named = [...threatCves([t])][0]?.[1] ?? [];
  const check = (r: NvdRecord | null, m = map()) =>
    checkCve("CVE-2013-5700", named, {
      threats: [t],
      advisories: [],
      map: m,
      records: new Map(r ? [[r.id, r]] : []),
    });
  assert.equal(check(null).finding, null, "not asked yet is not a finding");
  assert.equal(check(null).nvd.state, "unchecked");
  assert.equal(check(record()).finding, null);
  assert.equal(
    check(record()).basis,
    "any",
    "an NVD page implies no project: any project in the map",
  );
  assert.equal(check(record({ found: false, products: [], description: null })).finding, "missing");
  assert.equal(check(record({ status: "Rejected" })).finding, "rejected");
  const openssl = record({
    products: ["openssl:openssl"],
    description: "The ASN1 decoder in OpenSSL",
  });
  const c = check(openssl);
  assert.equal(c.finding, "product");
  assert.deepEqual([c.named, c.other], [[], ["openssl:openssl"]]);
  const vague = record({ products: [], description: "A remote attacker can cause a crash." });
  assert.equal(check(vague).finding, "unnamed");
  // The owner says this one is OpenSSL's: the finding goes once OpenSSL is a product they expect.
  const owned = map({
    expect: { "CVE-2013-5700": ["OpenSSL"] },
    products: {
      ...map().products,
      OpenSSL: { cpe: ["openssl:openssl"], words: ["OpenSSL"], pages: [] },
    },
  });
  assert.equal(check(openssl, owned).finding, null);
  assert.equal(check(openssl, owned).basis, "owner");
  assert.equal(
    check(record(), owned).finding,
    "product",
    "and Bitcoin Core is then the wrong product",
  );
});

test("NVD check: the advisory carrying the CVE, else its cited page, says which project to expect", () => {
  const t = threat({
    id: "lightning-bugs",
    history: [
      {
        ref: "LND: CVE-2024-38359",
        url: "https://github.com/lightningnetwork/lnd/security/advisories/GHSA-9gxx-58q6-42p7",
      },
    ],
  });
  const named = [...threatCves([t])][0]?.[1] ?? [];
  const core = record({
    id: "CVE-2024-38359",
    products: ["bitcoin:bitcoin_core"],
    description: "Bitcoin Core",
  });
  const byPage = checkCve("CVE-2024-38359", named, {
    threats: [t],
    advisories: [],
    map: map(),
    records: new Map([[core.id, core]]),
  });
  assert.deepEqual([byPage.basis, byPage.expected, byPage.finding], ["page", ["LND"], "product"]);
  const lnd = record({
    id: "CVE-2024-38359",
    products: [],
    description: "lnd before 0.17.0 allows",
  });
  const byAdvisory = checkCve("CVE-2024-38359", named, {
    threats: [t],
    advisories: [advisory({ source: "LND", ids: ["CVE-2024-38359"] })],
    map: map(),
    records: new Map([[lnd.id, lnd]]),
  });
  assert.deepEqual(
    [byAdvisory.basis, byAdvisory.expected, byAdvisory.finding],
    ["advisory", ["LND"], null],
  );
  assert.equal(
    pageProject("https://bitcoincore.org/en/2018/09/20/notice/", map().products),
    "Bitcoin Core",
  );
  assert.equal(
    pageProject("https://github.com/bitcoin/bips/blob/master/bip-0066.mediawiki", map().products),
    null,
  );
  assert.deepEqual(
    namedProducts({ products: ["bitcoin:bitcoin-qt"], description: null }, map().products),
    {
      named: ["Bitcoin Core"],
      other: [],
    },
  );
});

test("the owner's advisory map validates against the threat map", () => {
  const { store, issues } = loadStore();
  assert.deepEqual(
    issues.filter((i) => i.file.includes("advisor")),
    [],
  );
  const m = store.security?.advisoryMap;
  assert.ok(m, "knowledge/security/advisory-map.yaml is loaded");
  assert.deepEqual(advisoryMapIssues(m, store.security?.threats ?? []), []);
  const bad = advisoryMapIssues(
    map({ keywords: { "no-such-threat": ["x y z"] }, expect: { "CVE-2014-8275": ["OpenSSL"] } }),
    [threat()],
  );
  assert.deepEqual(
    bad.map((i) => i.where),
    ["keywords.no-such-threat", "expect.CVE-2014-8275"],
  );
});

test("an advisory a published claim of the threat cites, by its page or its id, files under it", () => {
  const stall = threat({
    id: "block-stalling",
    claims: ["p2p-network.stall"],
    mitigations: ["p2p-network.stall-fix"],
  });
  const other = threat({ id: "eclipse-attack", claims: ["p2p-network.unlisted-elsewhere"] });
  const a = advisory({
    title: "CVE-2024-52922 - Hindered block propagation due to mutated blocks",
    url: "https://bitcoincore.org/en/2024/11/05/cb-stall-hindering-propagation/",
    ids: ["CVE-2024-52922"],
  });
  const claims = [
    {
      id: "p2p-network.stall",
      statement: "Before Bitcoin Core 25.1, a peer could stall a node's block download.",
      sources: [{ title: "Disclosure", url: `${a.url}#details` }],
    },
    {
      id: "p2p-network.stall-fix",
      statement: "Bitcoin Core 25.1 fixed CVE-2024-52922 by asking other peers for the block.",
      sources: [{ title: "Release notes", url: "https://bitcoincore.org/en/releases/25.1/" }],
    },
    // Cites the page too, but the threat it would file under does not list it.
    {
      id: "p2p-network.unlisted",
      statement: "Mutated blocks once hindered propagation.",
      sources: [{ title: "Disclosure", url: a.url }],
    },
  ];
  const log = { updated: "2026-11-26T09:00:00Z", advisories: [a], nvd: [] };
  const withIt = advisoryReport({ threats: [stall, other], log, map: map(), claims });
  assert.deepEqual(withIt.advisories[0]?.matches, [
    { threat: "block-stalling", rule: "claim", by: ["p2p-network.stall", "p2p-network.stall-fix"] },
  ]);
  assert.deepEqual(withIt.unmatched, []);
  // Without the claims, the same advisory is a gap; the owner's exclusion still wins.
  assert.equal(
    advisoryReport({ threats: [stall], log, map: map(), claims: [] }).unmatched.length,
    1,
  );
  assert.deepEqual(
    matchAdvisory(
      a,
      [stall],
      map({ exclude: { "CVE-2024-52922": ["block-stalling"] } }),
      threatCites([stall], claims),
    ),
    [],
  );
});

test("an unmapped advisory rides on its project's topic, else the topic nearest its title and page", () => {
  const threats = [
    threat({ id: "peer-dos", topic: "p2p-network" }),
    threat({ id: "time-warp", topic: "consensus-security" }),
    threat({ id: "lightning-bugs", topic: "lightning" }),
  ];
  const filed = [
    { source: "Bitcoin Core", matches: [{ threat: "peer-dos", rule: "keyword" as const, by: [] }] },
    { source: "Bitcoin Core", matches: [{ threat: "peer-dos", rule: "id" as const, by: [] }] },
    { source: "Bitcoin Core", matches: [{ threat: "time-warp", rule: "id" as const, by: [] }] },
    { source: "LND", matches: [{ threat: "lightning-bugs", rule: "source" as const, by: [] }] },
  ];
  const topics = advisoryTopics(filed, threats);
  assert.deepEqual(
    [...topics],
    [
      ["Bitcoin Core", "p2p-network"],
      ["LND", "lightning"],
    ],
  );
  const unmapped = [
    { ...advisory({ title: "Disclosure of CVE-2015-3641", ids: ["CVE-2015-3641"] }), nvd: [] },
    {
      nvd: [],
      ...advisory({
        source: "Core Lightning",
        title: "Disclosure of CVE-2099-0001",
        url: "https://example.org/en/2099/01/01/disclose_channel_force_close/",
        ids: ["CVE-2099-0001"],
      }),
    },
  ];
  const bc = (id: string, statement: string): BundleClaim => ({
    ...claim({ id, topics: [id.split(".")[0] ?? ""], depth: "user", statement }),
    hash: "0".repeat(64),
    hashes: ["0".repeat(64)],
    weakSources: false,
    recheck: null,
    at_head: [],
    shownIn: [],
    withdrawal: null,
  });
  const claims = {
    "lightning.close": bc(
      "lightning.close",
      "A force close settles a Lightning channel on chain without the other party's help.",
    ),
    "p2p-network.peers": bc(
      "p2p-network.peers",
      "A Bitcoin node keeps a few outbound peers that it chose itself, to resist being isolated.",
    ),
  };
  const topicsOf = ["lightning", "p2p-network"].map(
    (slug) => ({ slug, title: slug }) as BundleTopic,
  );
  const base = { claims, topics: topicsOf, review: [], rechecks: {}, scorecard: null };
  const gaps = gapMap({ ...base, advisories: unmapped, advisoryTopics: topics });
  const on = (slug: string) =>
    gaps.topics.find((t) => t.slug === slug)?.advisories.map((a) => a.ids[0]);
  assert.deepEqual(on("p2p-network"), ["CVE-2015-3641"], "Bitcoin Core's own topic");
  // Core Lightning has nothing filed yet: its page's words ("channel force close") place it.
  assert.deepEqual(on("lightning"), ["CVE-2099-0001"]);
  assert.equal(gaps.advisories.length, 2, "both still listed as advisories to map");
  const score = (g: ReturnType<typeof gapMap>) => g.topics.map((t) => [t.slug, t.score]);
  assert.deepEqual(score(gaps), score(gapMap(base)), "placed advisories never weigh on the score");
});
