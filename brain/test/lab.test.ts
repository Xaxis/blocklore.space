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
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_LAB_DIR = path.join(tmp, "lab");
process.env.BLOCKLORE_LAB_FILE = path.join(tmp, "knowledge", "security", "lab.json");
after(() => rmSync(tmp, { recursive: true, force: true }));

const lab = await import("../src/security/lab.ts");
const secp = await import("../src/security/secp256k1.ts");
const { listEmbargo, decide } = await import("../src/security/embargo.ts");
const { securityEvents } = await import("../src/security/events.ts");

const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);

test("the lab tests the newest final release of each of the newest three majors", () => {
  const lines = [
    "aaa\trefs/tags/v31.3",
    "bbb\trefs/tags/v32.0rc4",
    "ccc\trefs/tags/v32.0",
    "ddd\trefs/tags/v32.0^{}",
    "eee\trefs/tags/v32.1",
    "fff\trefs/tags/v32.2rc1",
    "ggg\trefs/tags/v33.0rc1",
    "hhh\trefs/tags/v30.10",
    "iii\trefs/tags/v30.9",
    "jjj\trefs/tags/v29.5",
    "kkk\trefs/tags/v9.9.9",
    "lll\trefs/tags/noversion",
  ].join("\n");
  // 33 has only a release candidate, so it is not out; 30.10 is newer than 30.9.
  assert.deepEqual(lab.maintainedReleases(lines), ["32.1", "31.3", "30.10"]);
  assert.deepEqual(lab.maintainedReleases(lines, 1), ["32.1"]);
  // Before 22.0 a major was 0.x.
  assert.deepEqual(
    lab.maintainedReleases("x\trefs/tags/v0.21.2\ny\trefs/tags/v0.21.10\nz\trefs/tags/v0.20.2"),
    ["0.21.10", "0.20.2"],
  );
  assert.deepEqual(lab.maintainedReleases(""), []);
});

test("on the real tag list of 2026-11-23 the lab tests 32.1, 31.3 and 30.5", () => {
  // `git ls-remote --tags https://github.com/bitcoin/bitcoin` as it stood: rc tags, peeled tags,
  // v27-final and noversion among them.
  const real = readFileSync(
    path.join(import.meta.dirname, "data", "core-ls-remote-2026-11-23.txt"),
    "utf8",
  );
  assert.ok(real.includes("refs/tags/v32.0rc4") && real.includes("refs/tags/v27-final"));
  assert.deepEqual(lab.maintainedReleases(real), ["32.1", "31.3", "30.5"]);
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
    secp256k1: [],
    missing: ["p2p_dos_header_tree.py"],
  });
  // The owner's list replaces the map's, with or without .py.
  assert.deepEqual(lab.selectTests(threats, available, ["mining_basic", "nope.py"]), {
    run: ["mining_basic.py"],
    secp256k1: [],
    missing: ["nope.py"],
  });
});

test("libsecp256k1's programs come apart from the functional tests, never as scripts", () => {
  const threats = [
    { lab: ["feature_dersig.py", "secp256k1/exhaustive_tests", "secp256k1/tests"] },
    { lab: ["secp256k1/tests", "secp256k1/noverify_tests"] },
  ];
  const available = new Set(["feature_dersig.py"]);
  // Each program once, in the order they run; none becomes secp256k1/tests.py.
  assert.deepEqual(lab.selectTests(threats, available), {
    run: ["feature_dersig.py"],
    secp256k1: ["tests", "noverify_tests", "exhaustive_tests"],
    missing: [],
  });
  assert.deepEqual(
    lab.selectTests(threats, available, ["secp256k1/tests", "secp256k1/ctime_tests"]),
    {
      run: [],
      secp256k1: ["tests"],
      missing: ["secp256k1/ctime_tests"],
    },
  );
});

// The three CMake files as each release ships them (cmake/secp256k1.cmake, src/secp256k1/
// CMakeLists.txt and src/secp256k1/src/CMakeLists.txt), copied from the verified source tarballs.
const cmake = (version: string) => {
  const dir = path.join(import.meta.dirname, "data", `secp256k1-${version}`);
  return {
    core: readFileSync(path.join(dir, "secp256k1.cmake"), "utf8"),
    top: readFileSync(path.join(dir, "CMakeLists.txt"), "utf8"),
    src: readFileSync(path.join(dir, "src-CMakeLists.txt"), "utf8"),
  };
};

test("libsecp256k1 builds with the modules and defines the release's own CMake files give it", () => {
  const b = secp.secpBuild(cmake("32.1"), "x64");
  assert.equal(b.version, "0.8.1");
  // ECDH off and recovery on are Core's; musig on is Core's and turns on schnorrsig and extrakeys;
  // ellswift and silent payments are the library's defaults, which Core leaves alone.
  assert.deepEqual(b.modules, [
    "ellswift",
    "musig",
    "silentpayments",
    "schnorrsig",
    "extrakeys",
    "recovery",
  ]);
  assert.deepEqual(b.flags, ["-std=c90", "-O2", "-g", "-fvisibility=hidden"]);
  const S = "/lab/32.1/src/bitcoin-32.1/src/secp256k1";
  const O = "/lab/32.1/secp256k1";
  const base = [
    "-std=c90",
    "-O2",
    "-g",
    "-fvisibility=hidden",
    "-DECMULT_WINDOW_SIZE=15",
    "-DCOMB_BLOCKS=43",
    "-DCOMB_TEETH=6",
    "-DUSE_ASM_X86_64=1",
    "-DENABLE_MODULE_ELLSWIFT=1",
    "-DENABLE_MODULE_MUSIG=1",
    "-DENABLE_MODULE_SILENTPAYMENTS=1",
    "-DENABLE_MODULE_SCHNORRSIG=1",
    "-DENABLE_MODULE_EXTRAKEYS=1",
    "-DENABLE_MODULE_RECOVERY=1",
  ];
  assert.deepEqual(secp.secpCommands(b, { secp: S, out: O }), [
    {
      step: "precomputed",
      argv: [...base, "-c", `${S}/src/precomputed_ecmult.c`, `${S}/src/precomputed_ecmult_gen.c`],
    },
    {
      step: "noverify_tests",
      argv: [
        ...base,
        "-DSUPPORTS_CONCURRENCY=1",
        "-o",
        `${O}/noverify_tests`,
        `${S}/src/tests.c`,
        `${O}/precomputed_ecmult.o`,
        `${O}/precomputed_ecmult_gen.o`,
      ],
    },
    {
      step: "tests",
      argv: [
        ...base,
        "-DVERIFY",
        "-DSUPPORTS_CONCURRENCY=1",
        "-o",
        `${O}/tests`,
        `${S}/src/tests.c`,
        `${O}/precomputed_ecmult.o`,
        `${O}/precomputed_ecmult_gen.o`,
      ],
    },
    {
      step: "exhaustive_tests",
      argv: [...base, "-DVERIFY", "-o", `${O}/exhaustive_tests`, `${S}/src/tests_exhaustive.c`],
    },
  ]);
  // Only what was asked for: exhaustive_tests alone needs no precomputed tables.
  assert.deepEqual(
    secp.secpCommands(b, { secp: S, out: O }, ["exhaustive_tests"]).map((c) => c.step),
    ["exhaustive_tests"],
  );

  // 31.3: no silent payments yet. 30.5: no SUPPORTS_CONCURRENCY, programs declared one by one.
  const b31 = secp.secpBuild(cmake("31.3"), "x64");
  assert.equal(b31.version, "0.7.2");
  assert.deepEqual(b31.modules, ["ellswift", "musig", "schnorrsig", "extrakeys", "recovery"]);
  const b30 = secp.secpBuild(cmake("30.5"), "x64");
  assert.equal(b30.version, "0.7.1");
  assert.deepEqual(b30.modules, b31.modules);
  assert.deepEqual(
    b30.programs.map((p) => [p.name, p.source, p.defines.join(" "), p.precomputed]),
    [
      ["noverify_tests", "tests.c", "", true],
      ["tests", "tests.c", "VERIFY", true],
      ["exhaustive_tests", "tests_exhaustive.c", "VERIFY", false],
    ],
  );
  assert.ok(!b30.defines.some((d) => d.startsWith("ENABLE_MODULE_ECDH")));
  // No x86_64 assembly on an arm64 machine: AUTO finds none there.
  assert.ok(!secp.secpBuild(cmake("32.1"), "arm64").defines.includes("USE_ASM_X86_64=1"));
});

test("a release whose CMake files the lab cannot read the same way does not build", () => {
  const real = cmake("32.1");
  // CMake itself stops when a module another needs was turned off.
  const noSchnorr = real.core.replace(
    'set(SECP256K1_ENABLE_MODULE_MUSIG ON CACHE BOOL "" FORCE)',
    'set(SECP256K1_ENABLE_MODULE_MUSIG ON CACHE BOOL "" FORCE)\n  set(SECP256K1_ENABLE_MODULE_SCHNORRSIG OFF CACHE BOOL "" FORCE)',
  );
  assert.throws(() => secp.secpBuild({ ...real, core: noSchnorr }, "x64"), /needs/);
  assert.throws(
    () => secp.secpBuild({ ...real, top: real.top.replace(/SECP256K1_ECMULT_WINDOW_SIZE 15/, "") }),
    /ecmult window/,
  );
  // Core turning a module off changes what is built: no guessing from an older release.
  const noRecovery = real.core.replace(
    "SECP256K1_ENABLE_MODULE_RECOVERY ON",
    "SECP256K1_ENABLE_MODULE_RECOVERY OFF",
  );
  assert.ok(!secp.secpBuild({ ...real, core: noRecovery }, "x64").modules.includes("recovery"));
});

test("a program passes only when it exits 0 after its own last line", () => {
  // As 32.1's and 31.3's tests print it, then as 30.5's tests and every exhaustive_tests do.
  const framework = [
    "Tests running silently. Use '-log=1' to enable detailed logging",
    "iterations = 16",
    "jobs = 0. Sequential execution.",
    "random seed = ec420fa089ff3123c6290e266ea0b1ba",
    "Total execution time: 60.263 seconds",
  ].join("\n");
  const legacy = "test count = 16\nrandom seed = 5f2c\nno problems found\n";
  assert.equal(secp.secpPassed(framework, 0), true);
  assert.equal(secp.secpPassed(legacy, 0), true);
  // A failed CHECK aborts: SIGABRT, 134 through the shell; or the time limit's 124.
  const aborted = "random seed = 1\nsrc/tests.c:1234: test condition failed: r == 1\n";
  assert.equal(secp.secpPassed(aborted, 134), false);
  assert.equal(secp.secpPassed(legacy, 124), false);
  assert.equal(secp.secpPassed(framework, null), false);
  // Exiting 0 before the end (a usage text, an early return) is no pass.
  assert.equal(secp.secpPassed("Usage: ./tests [options]\n", 0), false);
  assert.equal(secp.secpPassed("Total execution time: soon\n", 0), false);
  // GNU time's -o file, as it writes it for a pass and for a failure.
  assert.equal(secp.timeSeconds("60.26\n"), 60.26);
  assert.equal(secp.timeSeconds("Command terminated by signal 6\n0.41\n"), 0.41);
  assert.equal(secp.timeSeconds(""), null);
});

test("tar entries that could escape their folder are refused", () => {
  assert.deepEqual(
    lab.unsafeEntries(["bitcoin-32.1/bin/bitcoind", "/etc/passwd", "a/../../x", "ok/..x"]),
    ["/etc/passwd", "a/../../x"],
  );
});

test("the test ports start where nothing on the machine listens", () => {
  // /proc/net/tcp as the kernel writes it: 0A is LISTEN, the port is the hex after the colon.
  const tcp = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:2D50 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1",
    "   1: 0100007F:3EB2 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 2 1",
  ].join("\n");
  const tcp6 = [
    "  sl  local_address                         remote_address                        st",
    "   0: 00000000000000000000000000000000:49C1 00000000000000000000000000000000:0000 0A",
  ].join("\n");
  // 0x2D50 is 11600 (listening); 0x3EB2 is 16050 but only connected; 0x49C1 is 18881.
  assert.deepEqual([...lab.listeningPorts(tcp, tcp6)].sort(), [11600, 18881]);
  // On 2026-11-23 a web server held 11600, inside the default p2p window for 47 tests.
  assert.equal(lab.portBase(new Set([11600]), 47), 12000);
  // 12000's RPC window (17000 up) is free, but 13000's holds 18881: 12000 still wins.
  assert.equal(lab.portBase(new Set([11600, 18881]), 47), 12000);
  assert.equal(lab.portBase(new Set([11600, 17100, 18000]), 47), 14000);
  assert.equal(lab.portBase(new Set(), 47), 11000);
  // Nothing free below the ephemeral ports: the framework's own default.
  const everywhere = new Set(Array.from({ length: 22 }, (_, i) => 11000 + i * 1000 + 5));
  assert.equal(lab.portBase(everywhere, 47), 11000);
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

test("config.ini for a release before 32.0 turns each built component's line on and the rest off", () => {
  // As Bitcoin Core 31.3 and 30.5 ship test/config.ini.in: a _TRUE prefix per component line.
  // Left as it was, configparser read no ENABLE_BITCOIND and the runner ran nothing.
  const template = [
    "[environment]",
    "SRCDIR=@abs_top_srcdir@",
    "[components]",
    "@ENABLE_WALLET_TRUE@ENABLE_WALLET=true",
    "@BUILD_BENCH_TRUE@BUILD_BENCH=true",
    "@BUILD_BITCOIN_CLI_TRUE@ENABLE_CLI=true",
    "@BUILD_BITCOIND_TRUE@ENABLE_BITCOIND=true",
    "@ENABLE_ZMQ_TRUE@ENABLE_ZMQ=true",
    "@ENABLE_IPC_TRUE@ENABLE_IPC=true",
    "@SOMETHING_NEW_TRUE@SOMETHING_NEW=true",
  ].join("\n");
  const ini = lab.configIni(
    template,
    { src: "/s", build: "/b" },
    {
      wallet: true,
      cli: true,
      bitcoind: true,
      tx: false,
      util: false,
      chainstate: false,
      walletTool: false,
      zmq: false,
      embeddedAsmap: false,
      externalSigner: false,
    },
  );
  assert.match(ini, /^ENABLE_WALLET=true$/m);
  assert.match(ini, /^ENABLE_CLI=true$/m);
  assert.match(ini, /^ENABLE_BITCOIND=true$/m);
  assert.match(ini, /^#BUILD_BENCH=true$/m);
  assert.match(ini, /^#ENABLE_ZMQ=true$/m);
  assert.match(ini, /^#ENABLE_IPC=true$/m);
  assert.match(ini, /^#SOMETHING_NEW=true$/m);
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
const library = (testsOk: boolean) => [
  { name: "secp256k1/exhaustive_tests", ok: true, seconds: 10 },
  { name: "secp256k1/noverify_tests", ok: true, seconds: 41 },
  { name: "secp256k1/tests", ok: testsOk, seconds: testsOk ? 60 : 3 },
];
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
  // libsecp256k1's programs replay nothing in regtest: the line says what they are.
  const both = lab.labLine(run({ tests: [...run().tests, ...library(true)] }));
  assert.ok(both.length <= 160);
  assert.equal(
    both,
    "Lab: Bitcoin Core 32.1 passed all 2 tests that replay known attacks, in regtest, and all 3 of libsecp256k1's own test programs",
  );
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

test("each maintained release is its own run, beside the others and the history; a failure on one holds only that one", () => {
  const before = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  // An older release lacks a newer test: its run records only the tests it has.
  const older = run({
    at: "2026-11-23T01:00:00Z",
    version: "31.3",
    tests: [{ name: "feature_block.py", ok: true, seconds: 120 }],
  });
  const failing = run({
    at: "2026-11-23T02:00:00Z",
    version: "30.5",
    tests: [
      { name: "feature_block.py", ok: true, seconds: 130 },
      { name: "p2p_invalid_block.py", ok: false, seconds: 9 },
    ],
  });
  assert.equal(lab.gateRun(record(older), { publish: true }).published, true);
  const g = lab.gateRun(record(failing), { publish: true });
  assert.equal(g.published, false);
  assert.match(g.held?.title ?? "", /Bitcoin Core 30\.5, 1 failed/);
  const runs = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  // Newest first; the 32.1 history is kept; 30.5 never reached the file.
  assert.deepEqual(
    runs.map((r) => [r.version, r.at]),
    [["31.3", "2026-11-23T01:00:00Z"], ...before.map((r) => [r.version, r.at])],
  );
  assert.deepEqual(runs[0]?.tests, older.tests);
  assert.equal(
    securityEvents().filter((e) => e.text.includes("30.5")).length,
    0,
    "no public event for the held release",
  );
  assert.ok(securityEvents().some((e) => /Bitcoin Core 31\.3 passed all/.test(e.text)));
});

test("a libsecp256k1 program that fails holds the whole release and names libsecp256k1's contact", () => {
  const before = readFileSync(labFile(), "utf8");
  const events = securityEvents().length;
  const held = embargoFiles().length;
  const failing = run({
    at: "2026-11-23T03:00:00Z",
    tests: [{ name: "feature_dersig.py", ok: true, seconds: 7 }, ...library(false)],
  });
  const g = lab.gateRun(
    { ...record(failing), tail: "secp256k1/tests (exit 134): test condition failed" },
    { publish: true },
  );
  assert.equal(g.published, false);
  assert.match(g.held?.title ?? "", /Bitcoin Core 32\.1, 1 failed/);
  assert.deepEqual(g.held?.reasons, ["failed: secp256k1/tests"]);
  assert.deepEqual(
    g.held?.contacts.map((c) => c.email),
    ["security@bitcoincore.org", "secp256k1-security@bitcoincore.org"],
  );
  assert.equal(readFileSync(labFile(), "utf8"), before, "lab.json unchanged");
  assert.equal(securityEvents().length, events, "no public event");
  assert.equal(embargoFiles().length, held + 1);
  // A program that did not build is a failure too: held, never published.
  const unbuilt = run({
    at: "2026-11-23T04:00:00Z",
    tests: [{ name: "secp256k1/tests", ok: false, seconds: 0 }],
  });
  assert.ok(lab.gateRun(record(unbuilt), { publish: true }).held);
  assert.equal(readFileSync(labFile(), "utf8"), before);
  // A functional test failing alone is not sent to libsecp256k1.
  const core = run({
    at: "2026-11-23T05:00:00Z",
    tests: [{ name: "feature_dersig.py", ok: false, seconds: 7 }, ...library(true)],
  });
  assert.deepEqual(
    lab.gateRun(record(core), { publish: true }).held?.contacts.map((c) => c.email),
    ["security@bitcoincore.org"],
  );
  // The same run passing publishes with its libsecp256k1 programs.
  const passing = run({
    at: "2026-11-23T06:00:00Z",
    tests: [{ name: "feature_dersig.py", ok: true, seconds: 7 }, ...library(true)],
  });
  assert.equal(lab.gateRun(record(passing), { publish: true }).published, true);
  const runs = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  assert.deepEqual(
    runs[0]?.tests.map((t) => t.name),
    [
      "feature_dersig.py",
      "secp256k1/exhaustive_tests",
      "secp256k1/noverify_tests",
      "secp256k1/tests",
    ],
  );
});
