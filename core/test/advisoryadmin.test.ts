import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AdvisoryMap,
  type AdvisoryRecord,
  advisoryReport,
  EMPTY_ADVISORY_MAP,
  type NvdRecord,
} from "../src/advisories.ts";
import {
  AdvisoryAdminView,
  advisoryAdminView,
  advisoryCommandProblem,
  advisoryKeyOf,
  isAdvisoryCommand,
  projectsToDrop,
} from "../src/advisoryadmin.ts";
import { Command, signCommand, verifyEnvelope } from "../src/control.ts";
import type { Threat } from "../src/security.ts";

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
  title: "CVE-2025-62860 - Inbound Tor connections wrongly receive -whitelist permissions",
  url: "https://bitcoincore.org/en/2026/11/10/disclose-cve-2025-62860/",
  published: "2026-11-10T00:00:00Z",
  severity: "low",
  ids: ["CVE-2025-62860"],
  ...over,
});

const record = (over: Partial<NvdRecord> = {}): NvdRecord => ({
  id: "CVE-2014-8275",
  checked: "2026-11-23T12:00:00Z",
  found: true,
  status: "Modified",
  published: "2015-01-09T00:00:00Z",
  products: ["openssl:openssl"],
  description: "OpenSSL before 0.9.8zd does not enforce certain constraints on certificate data",
  ...over,
});

const threats = [
  threat(),
  threat({
    id: "signature-library",
    title: "A flaw in the library that checks signatures",
    layer: "cryptography",
    history: [
      {
        ref: "CVE-2014-8275",
        url: "https://nvd.nist.gov/vuln/detail/CVE-2014-8275",
        date: "2015-01-09",
      },
    ],
  }),
  threat({ id: "replacement-cycling", title: "Replacement cycling", layer: "layers" }),
];

const map = (over: Partial<AdvisoryMap> = {}): AdvisoryMap => ({
  ...EMPTY_ADVISORY_MAP,
  products: {
    "Bitcoin Core": { cpe: ["bitcoin:*"], words: ["Bitcoin Core"], pages: ["bitcoincore.org"] },
  },
  ...over,
});

const viewOf = (m: AdvisoryMap, advisories = [advisory()]) =>
  advisoryAdminView({
    threats,
    report: advisoryReport({
      threats,
      log: { updated: "2026-11-23T12:00:00Z", advisories, nvd: [record()] },
      map: m,
      claims: [],
    }),
    map: m,
    head: "abc123",
  });

test("the admin's view lists what to map, the owner's placements, the findings and expectations", () => {
  const ghsa = advisory({
    source: "LND",
    title: "Something in LND",
    url: "https://github.com/lightningnetwork/lnd/security/advisories/GHSA-aaaa-bbbb-cccc",
    ids: ["GHSA-aaaa-bbbb-cccc"],
  });
  const bare = advisory({ title: "No id at all", url: "https://example.org/a", ids: [] });
  const v = viewOf(map(), [advisory(), ghsa, bare]);
  assert.ok(AdvisoryAdminView.safeParse(v).success, "it matches the schema the sync checks");
  assert.deepEqual(
    v.unmatched.map((a) => a.key),
    ["CVE-2025-62860", "GHSA-aaaa-bbbb-cccc", "https://example.org/a"],
  );
  assert.deepEqual(
    v.threats.map((t) => t.id),
    ["peer-dos", "signature-library", "replacement-cycling"],
  );
  assert.equal(v.layers.length, 8);
  assert.deepEqual(
    v.findings.map((f) => [f.id, f.finding, f.other]),
    [["CVE-2014-8275", "product", ["openssl:openssl"]]],
  );
  assert.deepEqual(v.placed, []);
  assert.deepEqual(v.counts, { advisories: 3, matched: 0, unmatched: 3, cves: 1, findings: 1 });

  const placed = viewOf(
    map({
      assign: { "CVE-2025-62860": ["peer-dos"] },
      products: {
        ...map().products,
        OpenSSL: { cpe: ["openssl:openssl"], words: [], pages: [] },
      },
      expect: { "CVE-2014-8275": ["OpenSSL"] },
    }),
  );
  assert.deepEqual(placed.unmatched, []);
  assert.deepEqual(placed.placed, [
    {
      key: "CVE-2025-62860",
      threats: ["peer-dos"],
      advisories: [
        {
          title: advisory().title,
          url: advisory().url,
          source: "Bitcoin Core",
        },
      ],
    },
  ]);
  assert.deepEqual(placed.findings, [], "the expectation settles the finding");
  assert.deepEqual(placed.expected, [
    {
      id: "CVE-2014-8275",
      projects: ["OpenSSL"],
      made: ["OpenSSL"],
      threats: [{ id: "signature-library", where: ["history"] }],
      finding: null,
    },
  ]);
});

test("an advisory is named by its first CVE id, else its GHSA id, else its page", () => {
  assert.equal(
    advisoryKeyOf({ ids: ["GHSA-aaaa-bbbb-cccc", "CVE-2024-1"], url: "https://x.y/" }),
    "CVE-2024-1",
  );
  assert.equal(
    advisoryKeyOf({ ids: ["GHSA-aaaa-bbbb-cccc"], url: "https://x.y/" }),
    "GHSA-aaaa-bbbb-cccc",
  );
  assert.equal(advisoryKeyOf({ ids: [], url: "https://x.y/" }), "https://x.y/");
});

test("undoing an expectation drops only a project the admin made that nothing else names", () => {
  const m = map({
    products: {
      ...map().products,
      OpenSSL: { cpe: ["openssl:openssl"], words: [], pages: [] },
      Shared: { cpe: ["a:b"], words: [], pages: [] },
    },
    expect: {
      "CVE-2014-8275": ["OpenSSL", "Bitcoin Core", "Shared"],
      "CVE-2014-0001": ["Shared"],
    },
  });
  assert.deepEqual(projectsToDrop(m, "CVE-2014-8275"), ["OpenSSL"]);
  assert.deepEqual(projectsToDrop(m, "CVE-2099-0001"), []);
});

test("the four commands are signed commands of the control plane, and malformed ones are not", () => {
  const ok = [
    { type: "advisory.assign", advisory: "CVE-2025-62860", threats: ["peer-dos"] },
    { type: "advisory.assign", advisory: "GHSA-aaaa-bbbb-cccc", threats: [] },
    { type: "advisory.assign", advisory: "https://bitcoincore.org/en/x/", threats: [] },
    { type: "advisory.unassign", advisory: "CVE-2025-62860" },
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "OpenSSL", cpe: ["openssl:openssl"] },
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "Bitcoin Core", cpe: [] },
    { type: "advisory.unexpect", cve: "CVE-2014-8275" },
  ];
  for (const cmd of ok) {
    const p = Command.safeParse(cmd);
    assert.ok(p.success, JSON.stringify(cmd));
    assert.ok(isAdvisoryCommand(p.data));
  }
  const bad = [
    // an advisory key that is neither an id nor an https page
    { type: "advisory.assign", advisory: "http://bitcoincore.org/x", threats: [] },
    { type: "advisory.assign", advisory: "CVE-2025-62860", threats: ["Peer DoS"] },
    { type: "advisory.assign", advisory: "CVE-2025-62860", threats: ["peer-dos", "peer-dos"] },
    { type: "advisory.assign", advisory: "CVE-2025-62860" },
    { type: "advisory.assign", advisory: "CVE-2025-62860", threats: [], file: "/etc/passwd" },
    // a project name that reads as a pair, holds a newline, or is too long
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "openssl:openssl", cpe: [] },
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "Open\nSSL", cpe: [] },
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "x".repeat(41), cpe: [] },
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "OpenSSL", cpe: ["OpenSSL"] },
    { type: "advisory.expect", cve: "CVE-2014-8275", project: "OpenSSL", cpe: ["a:b", "a:b"] },
    { type: "advisory.expect", cve: "cve-2014-8275", project: "OpenSSL", cpe: [] },
    { type: "advisory.unexpect", cve: "CVE-2014-8275", project: "OpenSSL" },
  ];
  for (const cmd of bad) assert.equal(Command.safeParse(cmd).success, false, JSON.stringify(cmd));

  const KEY = "k".repeat(48);
  const e = signCommand(KEY, {
    id: "0f6c1e7a-1111-4a2b-9c3d-123456789abc",
    at: "2026-11-23T11:59:00.000Z",
    by: "owner@example.com",
    cmd: { type: "advisory.assign", advisory: "CVE-2025-62860", threats: ["peer-dos"] },
  });
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(verifyEnvelope(KEY, e, now, () => false).ok, true);
  const other = { ...e, cmd: { ...e.cmd, threats: ["signature-library"] } };
  assert.equal(verifyEnvelope(KEY, other, now, () => false).ok, false, "a changed threat list");
});

test("a command must fit the map as the owner was shown it", () => {
  const v = viewOf(map());
  const problem = (cmd: Parameters<typeof advisoryCommandProblem>[0]) =>
    advisoryCommandProblem(cmd, v);
  assert.equal(
    problem({ type: "advisory.assign", advisory: "CVE-2025-62860", threats: ["peer-dos"] }),
    null,
  );
  assert.equal(problem({ type: "advisory.assign", advisory: "CVE-2025-62860", threats: [] }), null);
  assert.match(
    problem({ type: "advisory.assign", advisory: "CVE-2025-62860", threats: ["no-such"] }) ?? "",
    /no threat no-such/,
  );
  assert.match(
    problem({ type: "advisory.assign", advisory: "CVE-2099-1234", threats: [] }) ?? "",
    /not an advisory to map/,
  );
  assert.match(
    problem({ type: "advisory.unassign", advisory: "CVE-2025-62860" }) ?? "",
    /not placed/,
  );
  const expect = (project: string, cpe: string[], cve = "CVE-2014-8275") =>
    problem({ type: "advisory.expect", cve, project, cpe });
  assert.equal(expect("OpenSSL", ["openssl:openssl"]), null);
  assert.match(expect("OpenSSL", ["tukaani:xz"]) ?? "", /does not list tukaani:xz/);
  assert.match(expect("bitcoin core", ["openssl:openssl"]) ?? "", /already has a project/);
  assert.match(expect("Bitcoin Core", []) ?? "", /does not name Bitcoin Core/);
  assert.match(expect("OpenSSL", [], "CVE-2099-0001") ?? "", /no NVD finding/);
  assert.match(
    problem({ type: "advisory.unexpect", cve: "CVE-2014-8275" }) ?? "",
    /no expectation/,
  );

  // A finding NVD can settle only by a record it has: an id with no record is left open.
  const missing = advisoryAdminView({
    threats,
    report: advisoryReport({
      threats,
      log: {
        updated: "2026-11-23T12:00:00Z",
        advisories: [],
        nvd: [record({ found: false, status: null, products: [], description: null })],
      },
      map: map(),
      claims: [],
    }),
    map: map(),
    head: "abc",
  });
  assert.equal(missing.findings[0]?.finding, "missing");
  assert.match(
    advisoryCommandProblem(
      { type: "advisory.expect", cve: "CVE-2014-8275", project: "OpenSSL", cpe: [] },
      missing,
    ) ?? "",
    /not about the product/,
  );
});
