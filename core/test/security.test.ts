import assert from "node:assert/strict";
import { test } from "node:test";
import type { BundleClaim, BundleTopic } from "../src/bundle.ts";
import { gapMap } from "../src/gaps.ts";
import { loadStore } from "../src/node/index.ts";
import {
  BROAD_TERMS,
  LAYERS,
  type LabRun,
  securityView,
  type Threat,
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
  assert.equal(p2p.score, 2);
  const pow = map.topics.find((t) => t.slug === "proof-of-work");
  assert.deepEqual(
    pow?.threats.map((t) => t.id),
    ["selfish-mining"],
  );
});

test("the security view resolves claims, statuses and the newest lab result per test", () => {
  const run = (at: string, ok: boolean): LabRun => ({
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
  assert.equal(view.lab?.at, "2026-11-21T00:00:00Z");
  assert.equal(view.layers.length, LAYERS.length);
});
