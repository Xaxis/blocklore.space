import assert from "node:assert/strict";
import { test } from "node:test";
import { type BundleClaim, type BundleTopic, compile, type Store } from "../src/bundle.ts";
import { gapMap } from "../src/gaps.ts";
import { loadStore } from "../src/node/index.ts";
import type { Claim } from "../src/schema.ts";
import {
  andList,
  BROAD_TERMS,
  compareVersions,
  keepLabRuns,
  LAB_KEEP,
  LAB_MAX,
  LAYERS,
  Lab,
  LabRun,
  labRelease,
  labReleaseList,
  labReleases,
  labTestLabel,
  MAINTAINED_MAJORS,
  RELEASE_CHECK,
  releaseMajor,
  securityView,
  Threat,
  threatGaps,
  threatIssues,
  threatStatus,
  type WatchState,
} from "../src/security.ts";
import { claim } from "./fixtures.ts";

const threat = (over: Partial<Threat> = {}): Threat => ({
  id: "time-warp",
  title: "Time warp: faking block times to push difficulty down",
  layer: "mining",
  status: "defended",
  topic: "proof-of-work",
  claims: [],
  mitigations: [],
  history: [],
  watches: [],
  lab: [],
  terms: ["time warp"],
  ...over,
});

const reading = (id: WatchState["id"], status: WatchState["status"]) =>
  ({ id, status }) as Pick<WatchState, "id" | "status">;

test("the published threat map validates against the published claims", () => {
  const { store, issues } = loadStore();
  const security = store.security;
  assert.ok(security, "knowledge/security is loaded");
  assert.deepEqual(
    issues.filter((i) => i.file.includes("security")),
    [],
  );
  const ids = new Set(store.claims.map((c) => c.id));
  assert.deepEqual(threatIssues(security.threats, ids), []);
  // Every layer of Bitcoin has threats on the map.
  for (const l of LAYERS)
    assert.ok(
      security.threats.some((t) => t.layer === l.id),
      `layer ${l.id} has no threat`,
    );
  // No threat may whitelist a whole class of bugs for the disclosure gate.
  for (const t of security.threats)
    for (const term of t.terms) assert.ok(!BROAD_TERMS.has(term.toLowerCase()), `${t.id}: ${term}`);
});

test("the threat map refuses unknown claims, repeats and broad terms", () => {
  const issues = threatIssues(
    [
      threat({ claims: ["proof-of-work.nope"], terms: ["denial of service"] }),
      threat({ mitigations: ["a.b", "a.b"] }),
    ],
    new Set(["a.b"]),
  );
  const messages = issues.map((i) => `${i.where}: ${i.message}`);
  assert.ok(messages.some((m) => m.includes("no published claim proof-of-work.nope")));
  assert.ok(messages.some((m) => m.includes("is used twice")));
  assert.ok(messages.some((m) => m.includes("lists a claim twice")));
  assert.ok(messages.some((m) => m.startsWith("terms:")));
  assert.ok(issues.every((i) => i.level === "error"));
});

test("a chain watch past its threshold raises a threat's status, context watches never do", () => {
  const t = threat({ watches: ["timestamps", "advisories", "node-versions"] });
  assert.deepEqual(threatStatus(t, [reading("timestamps", "ok")]), {
    live: "defended",
    raisedBy: [],
  });
  assert.deepEqual(threatStatus(t, [reading("timestamps", "elevated")]), {
    live: "watching",
    raisedBy: ["timestamps"],
  });
  assert.equal(threatStatus(t, [reading("timestamps", "alert")]).live, "open");
  assert.equal(threatStatus(t, [reading("timestamps", "unknown")]).live, "defended");
  // A new advisory about some bug, or many old nodes, does not make this threat open.
  assert.equal(
    threatStatus(t, [reading("advisories", "alert"), reading("node-versions", "alert")]).live,
    "defended",
  );
  // A watch the threat does not list changes nothing; the owner's status is a floor.
  assert.equal(threatStatus(t, [reading("hashrate", "alert")]).live, "defended");
  assert.equal(
    threatStatus({ ...t, status: "open" }, [reading("timestamps", "elevated")]).live,
    "open",
  );
});

test("a threat without published claims becomes a research gap on its topic", () => {
  const thin = threat({ id: "eclipse-attack", topic: "p2p-network", title: "Eclipse attacks" });
  const covered = threat({ claims: ["proof-of-work.a"], mitigations: ["proof-of-work.b"] });
  const half = threat({ id: "selfish-mining", claims: ["proof-of-work.a"] });
  const gaps = threatGaps([thin, covered, half], new Set(["proof-of-work.a", "proof-of-work.b"]));
  assert.deepEqual(
    gaps.map((g) => [g.id, g.missing]),
    [
      ["eclipse-attack", ["claims", "mitigations"]],
      ["selfish-mining", ["mitigations"]],
    ],
  );
  const bc = (id: string): BundleClaim => ({
    ...claim({ id, topics: ["proof-of-work"] }),
    hash: "0".repeat(64),
    hashes: ["0".repeat(64)],
    weakSources: false,
    recheck: null,
    shownIn: [],
    withdrawal: null,
  });
  const map = gapMap({
    claims: { "proof-of-work.a": bc("proof-of-work.a"), "proof-of-work.b": bc("proof-of-work.b") },
    topics: [{ slug: "proof-of-work", title: "Proof of work" } as unknown as BundleTopic],
    review: [],
    rechecks: {},
    scorecard: null,
    threats: gaps,
  });
  // A topic only the threat map knows still shows up, so research can be planned on it.
  const p2p = map.topics.find((t) => t.slug === "p2p-network");
  assert.ok(p2p);
  assert.deepEqual(p2p.threats, [
    { id: "eclipse-attack", title: "Eclipse attacks", missing: ["claims", "mitigations"] },
  ]);
  // One unexplained threat (2), and nothing published at any of the five depths (5).
  assert.equal(p2p.score, 2 + 5);
  const pow = map.topics.find((t) => t.slug === "proof-of-work");
  assert.deepEqual(
    pow?.threats.map((t) => t.id),
    ["selfish-mining"],
  );
});

test("the security view resolves claims, statuses and the newest lab result per test", () => {
  const run = (at: string, ok: boolean): LabRun => ({
    project: "bitcoin-core",
    at,
    version: "32.1",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 9, signers: 14 },
    jobs: 3,
    seconds: 100,
    tests: [{ name: "mining_basic.py", ok, seconds: 20 }],
  });
  const view = securityView(
    {
      threats: [
        threat({
          claims: ["proof-of-work.a", "proof-of-work.unpublished"],
          watches: ["timestamps"],
          lab: ["mining_basic.py", "release-signatures", "p2p_eviction.py"],
        }),
      ],
      watches: {
        updated: "2026-11-21T00:00:00Z",
        watches: [
          {
            id: "timestamps",
            at: "2026-11-21T00:00:00Z",
            height: 1,
            status: "elevated",
            value: 61,
            history: [],
            data: null,
          },
        ],
      },
      lab: { runs: [run("2026-11-21T00:00:00Z", true), run("2026-11-14T00:00:00Z", false)] },
    },
    new Set(["proof-of-work.a"]),
  );
  const mining = view.layers.find((l) => l.id === "mining");
  const t = mining?.threats[0];
  assert.ok(t);
  assert.equal(t.live, "watching");
  assert.deepEqual(t.published, { claims: ["proof-of-work.a"], mitigations: [] });
  assert.deepEqual(t.missing, ["mitigations"]);
  // Newest first: the passing run of 21 November wins over the failure a week before.
  assert.deepEqual(
    t.results.map((r) => [r.name, r.ok]),
    [
      ["mining_basic.py", true],
      ["release-signatures", true],
    ],
  );
  assert.deepEqual(mining?.counts, { defended: 0, watching: 1, open: 0 });
  assert.deepEqual(
    view.labReleases.map((r) => r.at),
    ["2026-11-21T00:00:00Z"],
  );
  assert.equal(view.layers.length, LAYERS.length);
});

const labRun = (
  version: string,
  at: string,
  tests: [string, boolean][],
  project: LabRun["project"] = "bitcoin-core",
): LabRun => ({
  at,
  project,
  version,
  platform: "x86_64-linux-gnu",
  verified: { sha256: true, signatures: 8, signers: 40 },
  jobs: 3,
  seconds: 300,
  tests: tests.map(([name, ok]) => ({ name, ok, seconds: 5 })),
});

test("the lab shows the newest release of each of the three newest majors, each test per release", () => {
  const runs = [
    labRun("32.1", "2026-11-22T00:57:50Z", [
      ["feature_block.py", true],
      ["p2p_dos_header_tree.py", true],
    ]),
    // 31.3 lacks the newer test: that release has no result for it, not a failure.
    labRun("31.3", "2026-11-23T01:00:00Z", [["feature_block.py", true]]),
    labRun("31.2", "2026-11-24T00:00:00Z", [["feature_block.py", false]]),
    labRun("30.5", "2026-11-23T02:00:00Z", [
      ["feature_block.py", true],
      ["p2p_dos_header_tree.py", true],
    ]),
    labRun("29.5", "2026-10-01T00:00:00Z", [["feature_block.py", true]]),
  ];
  // The newest point release of a major wins over a later run on an older one.
  assert.deepEqual(
    labReleases(runs).map((r) => r.version),
    ["32.1", "31.3", "30.5"],
  );
  assert.deepEqual(
    labReleases(runs, 4).map((r) => r.version),
    ["32.1", "31.3", "30.5", "29.5"],
  );
  // With every 31.x run held back, 29.5, no longer maintained, does not take 31's place.
  assert.deepEqual(
    labReleases(runs.filter((r) => !r.version.startsWith("31."))).map((r) => r.version),
    ["32.1", "30.5"],
  );
  assert.deepEqual(labReleases([]), []);
  const view = securityView(
    {
      threats: [
        threat({ lab: ["feature_block.py", "p2p_dos_header_tree.py", "release-signatures"] }),
      ],
      watches: null,
      lab: { runs },
    },
    new Set(),
  );
  const t = view.layers.flatMap((l) => l.threats)[0];
  assert.deepEqual(
    t?.results.map((r) => `${r.name} ${r.version} ${r.ok}`),
    [
      "feature_block.py 32.1 true",
      "feature_block.py 31.3 true",
      "feature_block.py 30.5 true",
      "p2p_dos_header_tree.py 32.1 true",
      "p2p_dos_header_tree.py 30.5 true",
      "release-signatures 32.1 true",
      "release-signatures 31.3 true",
      "release-signatures 30.5 true",
    ],
  );
  assert.equal(view.labRuns[0]?.version, "31.2", "every run stays in labRuns, newest first");
  assert.equal(andList(view.labReleases.map((r) => r.version)), "32.1, 31.3 and 30.5");
  assert.equal(andList(["32.1"]), "32.1");
  assert.equal(andList(["32.1", "31.3"]), "32.1 and 31.3");
});

test("libsecp256k1's programs are lab tests no functional test can collide with, and read as words", () => {
  const map = threat({
    lab: ["feature_dersig.py", "secp256k1/tests", "secp256k1/exhaustive_tests"],
  });
  assert.ok(Threat.safeParse(map).success);
  // Only the programs the lab knows; never a script's name under the prefix.
  for (const bad of ["secp256k1/ctime_tests", "secp256k1/tests.py", "secp256k1/", "tests"])
    assert.equal(Threat.safeParse(threat({ lab: [bad] })).success, false, bad);
  const run = labRun("32.1", "2026-11-23T12:00:00Z", [
    ["feature_dersig.py", true],
    ["secp256k1/tests", true],
    ["secp256k1/exhaustive_tests", false],
  ]);
  assert.ok(LabRun.safeParse(run).success);
  const view = securityView({ threats: [map], watches: null, lab: { runs: [run] } }, new Set());
  const t = view.layers.flatMap((l) => l.threats)[0];
  assert.deepEqual(
    t?.results.map((r) => `${r.name} ${r.ok}`),
    ["feature_dersig.py true", "secp256k1/tests true", "secp256k1/exhaustive_tests false"],
  );
  assert.equal(labTestLabel("secp256k1/noverify_tests"), "libsecp256k1 noverify_tests");
  assert.equal(labTestLabel("feature_dersig.py"), "feature_dersig.py");
  assert.match(labTestLabel(RELEASE_CHECK), /SHA256SUMS/);
});

test("lab.json keeps every release's runs: newest first, at most LAB_KEEP of each major", () => {
  const weeks = Array.from({ length: LAB_KEEP + 2 }, (_, i) =>
    labRun("32.1", `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`, [["a.py", true]]),
  );
  const older = labRun("31.3", "2026-10-01T00:00:00Z", [["a.py", true]]);
  const kept = keepLabRuns([older, ...weeks, weeks[0] as LabRun]);
  // The oldest weeks of 32 go; 31.3's single run stays, however old; a repeat counts once.
  assert.equal(kept.filter((r) => r.version === "32.1").length, LAB_KEEP);
  assert.equal(kept[0]?.at, "2026-11-14T00:00:00Z");
  assert.equal(kept.at(-1)?.version, "31.3");
  assert.equal(kept.length, LAB_KEEP + 1);
  assert.ok(Lab.safeParse({ runs: kept }).success);
  assert.equal(LAB_KEEP * MAINTAINED_MAJORS, 36);
  assert.equal(releaseMajor("0.21.2"), 21);
  assert.equal(releaseMajor("32.1"), 32);
  assert.equal(compareVersions("0.21.10", "0.21.2") > 0, true);
  assert.equal(compareVersions("32.0", "32"), 0);
});

test("an LND run records its project, is tagged as LND tags and holds only LND's packages", () => {
  // Every run published before LND joined the lab reads as Bitcoin Core's.
  const old = labRun("32.1", "2026-11-22T00:00:00Z", [["feature_block.py", true]]);
  const { project: _, ...bare } = old;
  assert.equal(LabRun.parse(bare).project, "bitcoin-core");
  const lnd = labRun("0.21.8-beta", "2026-11-23T22:00:00Z", [["lnd/contractcourt", true]], "lnd");
  assert.ok(LabRun.safeParse(lnd).success);
  const bad: [string, LabRun][] = [
    ["a Core version on LND", { ...lnd, version: "0.21.8" }],
    ["an LND version on Core", { ...old, version: "0.21.8-beta" }],
    ["a Core script in LND's run", { ...lnd, tests: old.tests }],
    ["an LND package in Core's run", { ...old, tests: lnd.tests }],
  ];
  for (const [why, run] of bad) assert.equal(LabRun.safeParse(run).success, false, why);
  // Only the packages the lab knows, under their own prefix.
  assert.ok(
    Threat.safeParse(threat({ lab: ["lnd/contractcourt", "lnd/watchtower/lookout"] })).success,
  );
  for (const name of ["lnd/routing", "lnd/", "lnd/contractcourt/", "contractcourt"])
    assert.equal(Threat.safeParse(threat({ lab: [name] })).success, false, name);
  assert.equal(labTestLabel("lnd/watchtower/lookout"), "LND watchtower/lookout");
  assert.equal(LAB_MAX, LAB_KEEP * (MAINTAINED_MAJORS + 1));
});

test("LND's newest release joins Core's maintained majors, its own line, its own tests", () => {
  const runs = [
    labRun("32.1", "2026-11-22T00:57:50Z", [["mempool_truc.py", true]]),
    labRun("31.3", "2026-11-23T01:00:00Z", [["mempool_truc.py", true]]),
    labRun("30.5", "2026-11-23T02:00:00Z", [["mempool_truc.py", true]]),
    labRun("0.21.7-beta", "2026-11-24T00:00:00Z", [["lnd/contractcourt", false]], "lnd"),
    labRun("0.21.8-beta", "2026-11-23T22:00:00Z", [["lnd/contractcourt", true]], "lnd"),
    labRun("0.20.8-beta", "2026-11-23T23:00:00Z", [["lnd/contractcourt", true]], "lnd"),
  ];
  // LND's 0.x numbering never pushes Core's majors out: each project counts its own. The newest
  // LND release wins over a later run on an older one, and only one LND line shows.
  assert.deepEqual(labReleases(runs).map(labRelease), [
    "Bitcoin Core 32.1",
    "Bitcoin Core 31.3",
    "Bitcoin Core 30.5",
    "LND 0.21.8-beta",
  ]);
  assert.equal(
    labReleaseList(labReleases(runs)),
    "Bitcoin Core 32.1, 31.3 and 30.5 and LND 0.21.8-beta",
  );
  assert.ok(compareVersions("0.21.8-beta", "0.21.7-beta") > 0);
  const view = securityView(
    {
      threats: [threat({ lab: ["mempool_truc.py", "lnd/contractcourt", "release-signatures"] })],
      watches: null,
      lab: { runs },
    },
    new Set(),
  );
  const t = view.layers.flatMap((l) => l.threats)[0];
  // Each test only on its own project's releases; the release check is Core's.
  assert.deepEqual(
    t?.results.map((r) => `${r.name} ${r.project} ${r.version} ${r.ok}`),
    [
      "mempool_truc.py bitcoin-core 32.1 true",
      "mempool_truc.py bitcoin-core 31.3 true",
      "mempool_truc.py bitcoin-core 30.5 true",
      "lnd/contractcourt lnd 0.21.8-beta true",
      "release-signatures bitcoin-core 32.1 true",
      "release-signatures bitcoin-core 31.3 true",
      "release-signatures bitcoin-core 30.5 true",
    ],
  );
});

test("lab.json keeps each project's runs apart: an old Core 0.21 never crowds out LND 0.21", () => {
  const lnd = Array.from({ length: LAB_KEEP + 3 }, (_, i) =>
    labRun(
      "0.21.8-beta",
      `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      [["lnd/sweep", true]],
      "lnd",
    ),
  );
  const core = labRun("0.21.2", "2026-10-01T00:00:00Z", [["a.py", true]]);
  const kept = keepLabRuns([core, ...lnd]);
  assert.equal(kept.filter((r) => r.project === "lnd").length, LAB_KEEP);
  assert.ok(kept.some((r) => r.project === "bitcoin-core" && r.version === "0.21.2"));
  assert.ok(Lab.safeParse({ runs: kept }).success);
});

test("a claim the owner withdrew no longer explains a threat, on the security page or the gap map", () => {
  const at = { time: "2026-11-22T09:00:00Z", height: 977000 };
  const what = claim({ id: "halvings.what" });
  const defense = claim({ id: "halvings.defense" });
  const withdrawn: Claim = {
    ...defense,
    status: "withdrawn",
    revisions: [
      ...defense.revisions,
      {
        rev: 2,
        at: defense.first_seen,
        run: "2026-11-22-revoke-x",
        change: "withdrawn",
        note: "Withdrawn by the owner: misquoted.",
        before: { status: "established" },
      },
    ],
  };
  const store = (claims: Claim[]): Store => ({
    wire: null,
    bips: null,
    claims,
    topics: [
      {
        slug: "halvings",
        title: "Halvings",
        lede: "halvings.what",
        contested: false,
        safety: false,
        group: "protocol",
        sections: [
          { id: "basics", title: "Basics", depth: "curious", claims: claims.map((c) => c.id) },
        ],
      },
    ],
    proposals: [],
    debates: [],
    runs: [],
    snapshots: [],
    review: [],
    security: {
      threats: [
        threat({ topic: "halvings", claims: ["halvings.what"], mitigations: ["halvings.defense"] }),
      ],
      watches: null,
      lab: null,
    },
  });
  const shown = (claims: Claim[]) => {
    const { bundle, issues } = compile(store(claims), at);
    const t = bundle.security.layers.flatMap((l) => l.threats).find((x) => x.id === "time-warp");
    return {
      errors: issues.filter((i) => i.level === "error"),
      published: t?.published,
      missing: t?.missing,
      gap: bundle.gaps.topics.find((g) => g.slug === "halvings")?.threats,
    };
  };

  const before = shown([what, defense]);
  assert.deepEqual(before.errors, []);
  assert.deepEqual(before.published, {
    claims: ["halvings.what"],
    mitigations: ["halvings.defense"],
  });
  assert.deepEqual(before.missing, []);
  assert.deepEqual(before.gap, []);

  // Withdrawn, the claim stays in the store and the threat's file may still list it, so the
  // bundle still compiles, but the threat is a gap again until the owner links another claim.
  const after = shown([what, withdrawn]);
  assert.deepEqual(after.errors, []);
  assert.deepEqual(after.published, { claims: ["halvings.what"], mitigations: [] });
  assert.deepEqual(after.missing, ["mitigations"]);
  assert.deepEqual(after.gap, [
    { id: "time-warp", title: threat().title, missing: ["mitigations"] },
  ]);
});
