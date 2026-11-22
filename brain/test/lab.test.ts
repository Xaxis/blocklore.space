import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Lab, type LabRun } from "@blocklore/core";

// Every path the lab writes points into a temporary folder, set before the modules load.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-lab-"));
process.env.BLOCKLORE_EMBARGO_DIR = path.join(tmp, "embargo");
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
process.env.BLOCKLORE_LAB_DIR = path.join(tmp, "lab");
process.env.BLOCKLORE_LAB_FILE = path.join(tmp, "knowledge", "security", "lab.json");
after(() => rmSync(tmp, { recursive: true, force: true }));

const lab = await import("../src/security/lab.ts");
const { listEmbargo, decide } = await import("../src/security/embargo.ts");
const { securityEvents } = await import("../src/security/events.ts");

const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);

test("the latest release is the highest final tag, never a release candidate", () => {
  const lines = [
    "aaa\trefs/tags/v31.3",
    "bbb\trefs/tags/v32.0rc4",
    "ccc\trefs/tags/v32.0",
    "ddd\trefs/tags/v32.0^{}",
    "eee\trefs/tags/v32.1",
    "fff\trefs/tags/v32.2rc1",
    "ggg\trefs/tags/v9.9.9",
    "hhh\trefs/tags/noversion",
  ].join("\n");
  assert.equal(lab.latestRelease(lines), "32.1");
  assert.equal(lab.latestRelease("x\trefs/tags/v0.21.2\ny\trefs/tags/v0.21.10"), "0.21.10");
  assert.equal(lab.latestRelease(""), null);
});

test("SHA256SUMS parses into file names and digests", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const sums = lab.parseSums(
    `${a}  bitcoin-32.1.tar.gz\n${b}  bitcoin-32.1-x86_64-linux-gnu.tar.gz\nnot a line\n`,
  );
  assert.equal(sums.get("bitcoin-32.1.tar.gz"), a);
  assert.equal(sums.get("bitcoin-32.1-x86_64-linux-gnu.tar.gz"), b);
  assert.equal(sums.size, 2);
});

test("the results file counts a script once, fails it when any variant failed, and keeps skips apart", () => {
  const csv = [
    "test,status,duration(seconds)",
    "feature_block.py,Passed,141",
    "p2p_ibd_stalling.py --v1transport,Passed,20",
    "p2p_ibd_stalling.py --v2transport,Failed,22",
    "p2p_eviction.py,Passed,9",
    "feature_asmap.py,Skipped,0",
    "ALL,Failed,192",
  ].join("\n");
  const r = lab.parseResults(csv);
  assert.deepEqual(r.tests, [
    { name: "feature_block.py", ok: true, seconds: 141 },
    { name: "p2p_eviction.py", ok: true, seconds: 9 },
    { name: "p2p_ibd_stalling.py", ok: false, seconds: 42 },
  ]);
  assert.deepEqual(r.skipped, ["feature_asmap.py"]);
  assert.equal(r.total, 192);
});

test("the run takes the threat map's tests, leaves out the release check and what the release lacks", () => {
  const threats = [
    { lab: ["feature_block.py", "p2p_invalid_block.py"] },
    { lab: ["release-signatures", "p2p_dos_header_tree.py", "feature_block.py"] },
    { lab: [] },
  ];
  const available = new Set(["feature_block.py", "p2p_invalid_block.py", "mining_basic.py"]);
  assert.deepEqual(lab.selectTests(threats, available), {
    run: ["feature_block.py", "p2p_invalid_block.py"],
    missing: ["p2p_dos_header_tree.py"],
  });
  // The owner's list replaces the map's, with or without .py.
  assert.deepEqual(lab.selectTests(threats, available, ["mining_basic", "nope.py"]), {
    run: ["mining_basic.py"],
    missing: ["nope.py"],
  });
});

test("tar entries that could escape their folder are refused", () => {
  assert.deepEqual(
    lab.unsafeEntries(["bitcoin-32.1/bin/bitcoind", "/etc/passwd", "a/../../x", "ok/..x"]),
    ["/etc/passwd", "a/../../x"],
  );
});

test("gpg's status output counts only good signatures", () => {
  const status = [
    "[GNUPG:] NEWSIG",
    "[GNUPG:] GOODSIG 1234 builder one",
    "[GNUPG:] NEWSIG",
    "[GNUPG:] EXPKEYSIG 5678 builder two",
    "[GNUPG:] NEWSIG",
    "[GNUPG:] ERRSIG 9ABC 1 10 00 1700000000 9",
    "[GNUPG:] NO_PUBKEY 9ABC",
    "[GNUPG:] GOODSIG DEF0 builder three",
  ].join("\n");
  assert.equal(lab.goodSignatures(status), 2);
});

test("config.ini points the test framework at the release and fills every placeholder", () => {
  const template = [
    "[environment]",
    "SRCDIR=@abs_top_srcdir@",
    "BUILDDIR=@abs_top_builddir@",
    "EXEEXT=@EXEEXT@",
    "RPCAUTH=@abs_top_srcdir@/share/rpcauth/rpcauth.py",
    "[components]",
    "ENABLE_WALLET=@ENABLE_WALLET_VALUE@",
    "ENABLE_BITCOIND=@BUILD_BITCOIND_VALUE@",
    "ENABLE_IPC=@ENABLE_IPC_VALUE@",
    "ENABLE_ZMQ=@ENABLE_ZMQ_VALUE@",
  ].join("\n");
  const ini = lab.configIni(
    template,
    { src: "/s", build: "/b" },
    {
      wallet: true,
      cli: true,
      bitcoind: true,
      tx: true,
      util: true,
      chainstate: false,
      walletTool: true,
      zmq: false,
      embeddedAsmap: false,
      externalSigner: false,
    },
  );
  assert.match(ini, /^SRCDIR=\/s$/m);
  assert.match(ini, /^BUILDDIR=\/b$/m);
  assert.match(ini, /^EXEEXT=$/m);
  assert.match(ini, /^RPCAUTH=\/s\/share\/rpcauth\/rpcauth\.py$/m);
  assert.match(ini, /^ENABLE_WALLET=true$/m);
  assert.match(ini, /^ENABLE_IPC=false$/m);
  assert.doesNotMatch(ini, /@/);
});

test("components come from what the release's help prints, across wrapped lines", () => {
  // As Bitcoin Core 32.1 prints it: the asmap sentence only when the map is embedded.
  const embedded = [
    "  -asmap=<file>",
    "       Specify asn mapping used for bucketing of the peers. Relative paths will",
    "       be prefixed by the net-specific datadir location. If a bool arg",
    "       is given (-asmap or -asmap=1), the embedded mapping data in the",
    "       binary will be used.",
    "  -wallet=<path>",
    "  -zmqpubhashblock=<address>",
  ].join("\n");
  const bins = new Set(["bitcoind", "bitcoin-cli", "bitcoin-wallet"]);
  const c = lab.componentsFromHelp(embedded, bins);
  assert.equal(c.embeddedAsmap, true);
  assert.equal(c.wallet, true);
  assert.equal(c.zmq, true);
  assert.equal(c.externalSigner, false);
  assert.equal(c.tx, false);
  assert.equal(c.walletTool, true);
  const plain = "  -asmap=<file>\n       Specify asn mapping used for bucketing of the peers.";
  assert.equal(lab.componentsFromHelp(plain, bins).embeddedAsmap, false);
});

const run = (over: Partial<LabRun> = {}): LabRun => ({
  at: "2026-11-21T23:00:00Z",
  version: "32.1",
  platform: "x86_64-linux-gnu",
  verified: { sha256: true, signatures: 9, signers: 14 },
  jobs: 3,
  seconds: 600,
  tests: [
    { name: "feature_block.py", ok: true, seconds: 140 },
    { name: "p2p_invalid_block.py", ok: true, seconds: 8 },
  ],
  ...over,
});
const record = (r: LabRun) => ({ run: r, missing: [], skipped: [], tail: "private output" });
const labFile = () => process.env.BLOCKLORE_LAB_FILE as string;
const embargoFiles = () =>
  existsSync(process.env.BLOCKLORE_EMBARGO_DIR as string)
    ? readdirSync(process.env.BLOCKLORE_EMBARGO_DIR as string).filter((f) => f.endsWith(".json"))
    : [];

test("the public line is plain words, short and dash free", () => {
  const line = lab.labLine(run());
  assert.ok(line.length <= 160);
  assert.doesNotMatch(line, DASH);
  assert.match(line, /32\.1 passed all 2 tests/);
});

test("a failed test is embargoed: nothing public changes, the owner gets one private finding", () => {
  const failing = run({
    at: "2026-11-21T22:00:00Z",
    tests: [
      { name: "feature_block.py", ok: true, seconds: 140 },
      { name: "p2p_invalid_block.py", ok: false, seconds: 8 },
    ],
  });
  const g = lab.gateRun(record(failing), { publish: true });
  assert.equal(g.published, false);
  assert.ok(g.held);
  assert.equal(existsSync(labFile()), false, "lab.json must not be written");
  assert.equal(securityEvents().length, 0, "no public event");
  assert.equal(embargoFiles().length, 1);
  const [item] = listEmbargo();
  assert.equal(item?.kind, "lab");
  assert.match(item?.reasons.join(" ") ?? "", /p2p_invalid_block\.py/);
  assert.equal(item?.contacts[0]?.email, "security@bitcoincore.org");
  // The same failure again is the same finding, not a second one.
  lab.gateRun(record(failing), { publish: true });
  assert.equal(embargoFiles().length, 1);
});

test("a release that does not verify is embargoed even when every test passed", () => {
  const before = embargoFiles().length;
  const g = lab.gateRun(record(run({ verified: { sha256: true, signatures: 0, signers: 14 } })), {
    publish: true,
  });
  assert.ok(g.held);
  assert.equal(existsSync(labFile()), false);
  assert.equal(embargoFiles().length, before + 1);
});

test("a passing run publishes to lab.json with one public event", () => {
  const g = lab.gateRun(record(run()), { publish: true });
  assert.equal(g.published, true);
  assert.equal(g.held, null);
  const published = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8")));
  assert.equal(published.runs.length, 1);
  assert.equal(published.runs[0]?.version, "32.1");
  const events = securityEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "lab");
  assert.equal(events[0]?.outcome, "ok");
});

test("--no-publish leaves lab.json alone for a passing run", () => {
  const g = lab.gateRun(record(run({ at: "2026-11-21T23:30:00Z" })), { publish: false });
  assert.equal(g.published, false);
  assert.equal(Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs.length, 1);
});

test("the owner releasing a held run publishes exactly that run; dismissing publishes nothing", async () => {
  const items = listEmbargo();
  const failed = items.find((i) => i.title.includes("1 failed"));
  const unsigned = items.find((i) => i !== failed);
  assert.ok(failed && unsigned);
  await decide(unsigned.id, "dismiss", "2026-11-22T00:00:00Z");
  assert.equal(Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs.length, 1);
  const note = await decide(failed.id, "release", "2026-11-22T00:01:00Z");
  assert.match(note, /released/);
  const runs = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  assert.equal(runs.length, 2);
  assert.ok(runs.some((r) => r.at === "2026-11-21T22:00:00Z" && r.tests.some((t) => !t.ok)));
  assert.equal(listEmbargo().length, 0);
  assert.equal(securityEvents().length, 2);
});
