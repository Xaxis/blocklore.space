import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineTool, handleMcp, type McpServer } from "../src/mcp.ts";
import { securityView, type Threat, type WatchState } from "../src/security.ts";
import {
  findThreat,
  labCounts,
  labReport,
  listThreats,
  threatLab,
  watchReading,
  watchReadings,
} from "../src/threatmap.ts";

const threat = (over: Partial<Threat>): Threat => ({
  id: "time-warp",
  title: "Time warp: faking block times to push difficulty down",
  layer: "mining",
  status: "open",
  topic: "proof-of-work",
  claims: [],
  mitigations: [],
  history: [],
  watches: [],
  lab: [],
  terms: ["time warp"],
  ...over,
});

const hashrate = (status: WatchState["status"], value: number): WatchState => ({
  id: "hashrate",
  at: "2026-11-21T23:00:00Z",
  height: 976960,
  status,
  value,
  history: [
    { at: "2026-11-20T23:00:00Z", value: 24, status: "ok" },
    { at: "2026-11-21T23:00:00Z", value, status },
  ],
  data: { blocks: 1000, pools: [{ name: "Pool A", blocks: value * 10 }] },
});

const view = securityView(
  {
    threats: [
      threat({ claims: ["pow.a"], mitigations: ["pow.b"], lab: ["mining_basic.py"] }),
      threat({
        id: "selfish-mining",
        title: "Selfish mining",
        status: "defended",
        watches: ["hashrate"],
        claims: ["pow.c"],
      }),
      threat({ id: "peer-dos", title: "Peer DoS", layer: "network", status: "watching" }),
    ],
    watches: { updated: "2026-11-21T23:00:00Z", watches: [hashrate("elevated", 31)] },
    lab: {
      runs: [
        {
          at: "2026-11-21T20:00:00Z",
          project: "bitcoin-core",
          version: "32.1",
          platform: "x86_64-linux-gnu",
          verified: { sha256: true, signatures: 9, signers: 12 },
          jobs: 3,
          seconds: 400,
          tests: [{ name: "mining_basic.py", ok: true, seconds: 20 }],
        },
        {
          at: "2026-11-21T21:00:00Z",
          project: "bitcoin-core",
          version: "31.3",
          platform: "x86_64-linux-gnu",
          verified: { sha256: true, signatures: 8, signers: 12 },
          jobs: 3,
          seconds: 300,
          tests: [{ name: "feature_block.py", ok: true, seconds: 60 }],
        },
      ],
    },
  },
  new Set(["pow.a", "pow.b"]),
);

test("listThreats filters by layer and live status, and counts what it lists", () => {
  const all = listThreats(view);
  assert.deepEqual(all.counts, { defended: 0, watching: 2, open: 1 });
  // Map order: the layers in their fixed order (network before mining), then file order.
  assert.deepEqual(
    all.threats.map((t) => t.id),
    ["peer-dos", "time-warp", "selfish-mining"],
  );
  const mining = listThreats(view, { layer: "mining" });
  assert.deepEqual(
    mining.threats.map((t) => t.id),
    ["time-warp", "selfish-mining"],
  );
  // The elevated hashrate watch raised selfish mining from defended to watching.
  const watching = listThreats(view, { status: "watching" });
  assert.deepEqual(
    watching.threats.map((t) => [t.id, t.owner_status, t.raised_by]),
    [
      ["peer-dos", "watching", []],
      ["selfish-mining", "defended", ["hashrate"]],
    ],
  );
});

test("a threat in brief counts only published claims and says what is missing", () => {
  const byId = new Map(listThreats(view).threats.map((t) => [t.id, t]));
  const warp = byId.get("time-warp");
  const selfish = byId.get("selfish-mining");
  assert.deepEqual(
    [warp?.claims, warp?.mitigations, warp?.missing, warp?.lab],
    [
      1,
      1,
      [],
      {
        tests: 1,
        run: 1,
        passed: 1,
        releases: [{ project: "bitcoin-core", version: "32.1", passed: 1, run: 1 }],
      },
    ],
  );
  // pow.c is not published: the claim is not counted and the threat goes on the research list.
  assert.deepEqual([selfish?.claims, selfish?.missing], [0, ["claims", "mitigations"]]);
  assert.equal(findThreat(view, "no-such-threat"), undefined);
});

test("the lab per release: each test on each maintained release, and each release's run", () => {
  const warp = findThreat(view, "time-warp");
  assert.ok(warp);
  // 31.3's run did not have mining_basic.py: no result there, which is not a failure.
  assert.deepEqual(threatLab(warp, view), [
    {
      name: "mining_basic.py",
      project: "bitcoin-core",
      releases: [
        { version: "32.1", ok: true, at: "2026-11-21T20:00:00Z" },
        { version: "31.3", ok: null, at: "2026-11-21T21:00:00Z" },
      ],
    },
  ]);
  assert.deepEqual(
    labReport(view).map((r) => [r.version, r.passed, r.run, r.verified.signatures, r.tests]),
    [
      ["32.1", 1, 1, 9, [{ name: "mining_basic.py", ok: true }]],
      ["31.3", 1, 1, 8, [{ name: "feature_block.py", ok: true }]],
    ],
  );
  assert.deepEqual(labCounts({ lab: [], results: [] }), {
    tests: 0,
    run: 0,
    passed: 0,
    releases: [],
  });
});

test("an LND package is tested only on LND's release, and the report names each run's project", () => {
  const core = {
    at: "2026-11-23T20:00:00Z",
    project: "bitcoin-core" as const,
    version: "32.1",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 8, signers: 40 },
    jobs: 3,
    seconds: 400,
    tests: [{ name: "mempool_truc.py", ok: true, seconds: 20 }],
  };
  const lnd = {
    ...core,
    at: "2026-11-23T22:00:00Z",
    project: "lnd" as const,
    version: "0.21.8-beta",
    verified: { sha256: true, signatures: 5, signers: 16 },
    jobs: 1,
    tests: [{ name: "lnd/contractcourt" as const, ok: true, seconds: 80 }],
  };
  const v = securityView(
    {
      threats: [threat({ id: "pinning", lab: ["mempool_truc.py", "lnd/contractcourt"] })],
      watches: null,
      lab: { runs: [core, lnd] },
    },
    new Set(),
  );
  const pinning = findThreat(v, "pinning");
  assert.ok(pinning);
  // No Bitcoin Core release has an LND package, and LND's release no Core script: neither is
  // shown as "not run" on the other project's release.
  assert.deepEqual(threatLab(pinning, v), [
    {
      name: "mempool_truc.py",
      project: "bitcoin-core",
      releases: [{ version: "32.1", ok: true, at: core.at }],
    },
    {
      name: "lnd/contractcourt",
      project: "lnd",
      releases: [{ version: "0.21.8-beta", ok: true, at: lnd.at }],
    },
  ]);
  assert.deepEqual(labCounts(pinning), {
    tests: 2,
    run: 2,
    passed: 2,
    releases: [
      { project: "bitcoin-core", version: "32.1", passed: 1, run: 1 },
      { project: "lnd", version: "0.21.8-beta", passed: 1, run: 1 },
    ],
  });
  assert.deepEqual(
    labReport(v).map((r) => [r.project, r.version, r.verified.signatures, r.verified.signers]),
    [
      ["bitcoin-core", "32.1", 8, 40],
      ["lnd", "0.21.8-beta", 5, 16],
    ],
  );
});

test("a watch reading carries its documented thresholds, unit and recent history", () => {
  const [w] = watchReadings(view);
  assert.equal(w?.id, "hashrate");
  assert.equal(w?.unit, "%");
  assert.equal(w?.value, 31);
  assert.match(w?.thresholds ?? "", /Elevated at 30%/);
  assert.equal(watchReading(view.watches[0] as WatchState, 1).history.length, 1);
  assert.deepEqual(watchReadings(view, ["reorgs"]), []);
});

test("the threat tools answer through the MCP server and refuse secrets in their arguments", () => {
  const server: McpServer = {
    name: "t",
    title: "T",
    version: "1",
    websiteUrl: "https://example.org",
    instructions: "",
    ttlMs: 1,
    tools: [
      defineTool({
        name: "threats",
        title: "Threats",
        description: "The map.",
        input: z.strictObject({
          id: z.string().max(60).optional(),
          status: z.enum(["defended", "watching", "open"]).optional(),
        }),
        run: ({ id, status }) => {
          if (!id) return { ok: true, data: listThreats(view, { status }) };
          const t = findThreat(view, id);
          return t
            ? { ok: true, data: { id: t.id, status: t.live } }
            : { ok: false, error: "none" };
        },
      }),
    ],
  };
  const call = (args: Record<string, unknown>) =>
    handleMcp(
      {
        method: "POST",
        header: () => null,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "threats", arguments: args },
        }),
      },
      server,
    ).body as { result: { isError: boolean; structuredContent?: Record<string, unknown> } };
  const open = call({ status: "open" }).result;
  assert.equal(open.isError, false);
  assert.deepEqual(open.structuredContent?.counts, { defended: 0, watching: 0, open: 1 });
  assert.deepEqual(call({ id: "selfish-mining" }).result.structuredContent, {
    id: "selfish-mining",
    status: "watching",
  });
  assert.equal(call({ id: "nope" }).result.isError, true);
  const secret = call({
    id: "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz",
  });
  assert.equal(secret.result.isError, true);
  assert.equal(secret.result.structuredContent, undefined);
});
