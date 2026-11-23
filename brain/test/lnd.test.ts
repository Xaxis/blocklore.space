import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Lab, type LabRun, RELEASE_CHECK } from "@blocklore/core";

// LND in the lab, against real data from LND 0.21.8-beta and go.dev (brain/test/data/lnd-0.21.8-beta):
// the release's manifest, verify-install.sh, go.mod and make/testing_flags.mk at the tag, gpg's
// own status output for each maintainer's signature (and for a changed manifest and a wrong key),
// go.dev's list of Go releases, LND's tags, and real `go test -json` output. Every path the lab
// writes points into a temporary folder, set before the modules load.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-lnd-"));
process.env.BLOCKLORE_EMBARGO_DIR = path.join(tmp, "embargo");
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_LAB_DIR = path.join(tmp, "lab");
process.env.BLOCKLORE_LAB_FILE = path.join(tmp, "knowledge", "security", "lab.json");
after(() => rmSync(tmp, { recursive: true, force: true }));

const lnd = await import("../src/security/lnd.ts");
const lab = await import("../src/security/lab.ts");
const release = await import("../src/security/release.ts");
const { embargoView, listEmbargo } = await import("../src/security/embargo.ts");
const { securityEvents } = await import("../src/security/events.ts");

const DATA = path.join(import.meta.dirname, "data", "lnd-0.21.8-beta");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);

test("LND's newest release is its newest final tag, never a release candidate", () => {
  const tags = read("ls-remote.txt");
  assert.equal(lnd.newestLndRelease(tags), "0.21.8-beta");
  const rc = `${tags}0000000000000000000000000000000000000000\trefs/tags/v0.22.0-beta.rc1\n`;
  assert.equal(lnd.newestLndRelease(rc), "0.21.8-beta");
  // Other modules in LND's repository tag themselves too (kvdb/v1.4.1): never a release.
  assert.equal(lnd.newestLndRelease("abc\trefs/tags/kvdb/v1.4.1\n"), null);
});

test("the source tarball matches only when its SHA-256 is the one the signed manifest lists", async () => {
  const manifest = read("manifest-v0.21.8-beta.txt");
  const files = lnd.lndFiles("0.21.8-beta");
  assert.equal(files.manifest, "manifest-v0.21.8-beta.txt");
  assert.equal(files.source, "lnd-source-v0.21.8-beta.tar.gz");
  assert.equal(files.signature("roasbeef"), "manifest-roasbeef-v0.21.8-beta.sig");
  const want = "bc856189952a35e916f8549f5bfa606debcdce544810ba4f526962a756fd9d6a";
  assert.equal(release.parseSums(manifest).get(files.source), want);
  assert.equal(lnd.manifestMatch(manifest, files.source, want), true);
  assert.equal(lnd.manifestMatch(manifest, files.source, "0".repeat(64)), false);
  assert.equal(lnd.manifestMatch(manifest, "lnd-source-v0.21.7-beta.tar.gz", want), false);
  // Listed twice, differently: nothing matches.
  const twice = `${manifest}${"0".repeat(64)}  ${files.source}\n`;
  assert.equal(lnd.manifestMatch(twice, files.source, want), false);
  // The hash the lab compares is the file's own.
  const file = path.join(tmp, "tarball");
  writeFileSync(file, "not LND");
  const sha = createHash("sha256").update("not LND").digest("hex");
  assert.equal(await release.sha256File(file), sha);
  assert.equal(lnd.manifestMatch(manifest, files.source, await release.sha256File(file)), false);
});

test("verify-install.sh at the tag names 16 maintainers, one key each, and requires 5", () => {
  const script = read("verify-install.sh.txt");
  const { signers, required } = lnd.lndSigners(script);
  assert.equal(required, 5);
  assert.equal(signers.length, 16);
  assert.deepEqual(
    signers.find((s) => s.user === "roasbeef"),
    { fingerprint: "A5B61896952D9FDA83BC054CDC42612E89237182", user: "roasbeef" },
  );
  const line = script.split("\n").find((l) => l.startsWith('KEYS+=("')) as string;
  assert.throws(() => lnd.lndSigners(`${script}\n${line}\n`), /twice/);
  assert.throws(() => lnd.lndSigners("MIN_REQUIRED_SIGNATURES=5\n"), /does not name its keys/);
});

interface GpgCase {
  case: string;
  user: string;
  fingerprint: string;
  exit: number;
  status: string;
}

test("each signature counts as LND's own script counts it, and the published count is GOODSIG alone", () => {
  const cases = JSON.parse(read("gpg-status.json")) as GpgCase[];
  const state = (c: GpgCase) => lnd.signatureState(c.status, c.fingerprint, c.exit);
  const by = Object.fromEntries(cases.map((c) => [c.case, state(c)]));
  assert.deepEqual(by, {
    // roasbeef's signing subkey expired on 2026-10-29; he signed on 2026-11-11. gpg says "Good
    // signature" and exits 0, so verify-install.sh counts it.
    roasbeef: "expired",
    suheb: "good",
    ziggie1984: "good",
    "ViktorT-11": "good",
    gijswijs: "good",
    "tampered manifest": "bad",
    "another maintainer's key": "bad",
  });
  // A good signature by someone else's key is not this maintainer's.
  const suheb = cases.find((c) => c.case === "suheb") as GpgCase;
  assert.equal(
    lnd.signatureState(suheb.status, "A5B61896952D9FDA83BC054CDC42612E89237182", 0),
    "bad",
  );
  // gpg exiting non-zero is a failure whatever it printed.
  assert.equal(lnd.signatureState(suheb.status, suheb.fingerprint, 2), "bad");

  const real = [...cases.slice(0, 5).map(state), ...Array(11).fill("absent")];
  assert.equal(
    lnd.lndVerified(true, real, 5),
    true,
    "5 by LND's count: 4 good, 1 by an expired key",
  );
  assert.equal(lnd.lndVerified(false, real, 5), false, "the tarball must match");
  assert.equal(lnd.lndVerified(true, real.slice(1), 5), false, "4 is short of 5");
  assert.equal(lnd.lndVerified(true, [...real, "bad"], 5), false, "a bad signature stops it");
  assert.equal(lnd.lndVerified(true, Array(5).fill("expired"), 5), false, "none good by GOODSIG");
});

test("the Go toolchain is the one go.mod names, from go.dev's list, with go.dev's SHA-256", () => {
  assert.equal(lnd.goVersionFromMod(read("go.mod.txt")), "go1.26.10");
  assert.equal(lnd.goVersionFromMod("module m\n\ngo 1.25\n\ntoolchain go1.25.4\n"), "go1.25.4");
  assert.equal(lnd.goVersionFromMod("go 1.26.10\ntoolchain go1.26.2\n"), "go1.26.10");
  assert.equal(lnd.goVersionFromMod("go 1.22\n"), "go1.22.0");
  assert.throws(() => lnd.goVersionFromMod("module m\n"), /no go version/);

  const releases = JSON.parse(read("go-dl.json"));
  assert.deepEqual(lnd.goArchive(releases, "go1.26.10", "linux", "amd64"), {
    filename: "go1.26.10.linux-amd64.tar.gz",
    sha256: "ccfe7ae822d2c2f41f4fe7c956199967a4dac22d0ee0d2b2bfdb440aab3b20c5",
    size: 66936659,
  });
  assert.equal(
    lnd.goArchive(releases, "go1.26.10", "linux", "arm64").sha256,
    "3f4227ce7b206a513e794f1393adb473a07b46e94d18bd15d1c684bbb7319797",
  );
  assert.throws(
    () => lnd.goArchive(releases, "go1.26.11", "linux", "amd64"),
    /lists no go1\.26\.11/,
  );
  assert.equal(lnd.goArch("x64"), "amd64");
});

test("Go runs with every folder under the lab's, offline once the modules are in, whatever the user set", () => {
  const dirs = { goroot: "/lab/go/go1.26.10/go", go: "/lab/go", home: "/lab/home", tmp: "/lab/t" };
  const base = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/someone",
    GOPATH: "/home/someone/go",
    GOSUMDB: "off",
    GOPROXY: "direct",
    GOFLAGS: "-mod=mod",
    GOINSECURE: "*",
  };
  const env = lnd.goEnv(dirs, base, false);
  assert.equal(env.GOROOT, "/lab/go/go1.26.10/go");
  assert.equal(env.GOPATH, "/lab/go/path");
  assert.equal(env.GOMODCACHE, "/lab/go/mod");
  assert.equal(env.GOCACHE, "/lab/go/cache");
  assert.equal(env.HOME, "/lab/home");
  assert.equal(env.TMPDIR, "/lab/t");
  assert.equal(env.GOTOOLCHAIN, "local");
  assert.equal(env.GOFLAGS, "-mod=readonly");
  assert.equal(env.GOPROXY, "off");
  assert.equal(env.GOSUMDB, undefined, "the checksum database stays on");
  assert.equal(env.GOINSECURE, undefined);
  assert.ok(env.PATH?.startsWith("/lab/go/go1.26.10/go/bin:"));
  for (const [k, v] of Object.entries(env))
    if (k !== "PATH") assert.ok(!String(v).startsWith("/home/someone"), `${k} is the user's`);
  // Online only to fetch what go.sum pins, through Go's default proxy and checksum database.
  const online = lnd.goEnv(dirs, base, true);
  assert.equal(online.GOPROXY, undefined);
  assert.equal(online.GOSUMDB, undefined);
});

test("the tests run as LND's `make unit` does, one package at a time", () => {
  const tags = lnd.unitTags(read("testing_flags.mk"));
  assert.deepEqual(tags, [
    "dev",
    "autopilotrpc",
    "chainrpc",
    "invoicesrpc",
    "neutrinorpc",
    "peersrpc",
    "signrpc",
    "walletrpc",
    "watchtowerrpc",
    "nolog",
  ]);
  assert.deepEqual(lnd.goTestArgv("watchtower/lookout", tags, 3), [
    "go",
    "test",
    "-json",
    "-count=1",
    "-timeout=20m",
    "-p=3",
    `-tags=${tags.join(" ")}`,
    "./watchtower/lookout",
  ]);
  assert.throws(() => lnd.unitTags("UNIT := go test\n"), /does not say/);
});

test("go test's JSON comes to one verdict per package, its own time, and what failed", () => {
  const fail = lnd.parseGoTest(read("go-test-fail.jsonl"), "example.com/lab/fail");
  assert.equal(fail.action, "fail");
  assert.deepEqual(fail.failed, ["TestFails/sub", "TestFails"]);
  assert.ok(fail.output.some((l) => /justice transaction not built/.test(l)));
  assert.ok(
    !fail.output.some((l) => /RUN {3}TestPasses/.test(l)),
    "a passing test's output stays out",
  );

  const broken = lnd.parseGoTest(read("go-test-broken.jsonl"), "example.com/lab/broken");
  assert.equal(broken.action, "fail");
  assert.ok(
    broken.output.some((l) => /cannot use "no"/.test(l)),
    "the build error is kept",
  );

  assert.equal(
    lnd.parseGoTest(read("go-test-notests.jsonl"), "example.com/lab/notests").action,
    "skip",
  );
  // Another package's verdict is not this one's.
  assert.equal(lnd.parseGoTest(read("go-test-fail.jsonl"), "example.com/lab/other").action, null);

  const pass = lnd.parseGoTest(
    read("go-test-lookout.jsonl"),
    `${lnd.LND_MODULE}/watchtower/lookout`,
  );
  assert.equal(pass.action, "pass");
  assert.deepEqual(pass.failed, []);
  assert.ok(pass.seconds > 0);
});

test("the threat map's LND packages go to LND's run, and Core's run leaves them alone", () => {
  const threats = [
    { lab: ["mempool_truc.py", "lnd/contractcourt", "lnd/sweep"] },
    { lab: ["lnd/contractcourt", "lnd/nope", RELEASE_CHECK] },
  ];
  assert.deepEqual(lnd.selectLndPackages(threats), {
    packages: ["contractcourt", "sweep"],
    unknown: ["lnd/nope"],
  });
  assert.deepEqual(lnd.selectLndPackages(threats, ["lnd/htlcswitch", "feature_block.py"]), {
    packages: ["htlcswitch"],
    unknown: [],
  });
  const core = lab.selectTests(threats, new Set(["mempool_truc.py"]));
  assert.deepEqual(core, { run: ["mempool_truc.py"], secp256k1: [], missing: [] });
  assert.deepEqual(lab.splitVersions(["31.3", "v0.21.8-beta", "0.21.8-beta.rc1"]), {
    releases: [
      { project: "bitcoin-core", version: "31.3" },
      { project: "lnd", version: "0.21.8-beta" },
    ],
    bad: ["0.21.8-beta.rc1"],
  });
});

const lndRun = (over: Partial<LabRun> = {}): LabRun => ({
  at: "2026-11-23T10:00:00Z",
  project: "lnd",
  version: "0.21.8-beta",
  platform: "x86_64-linux-gnu",
  verified: { sha256: true, signatures: 4, signers: 16 },
  jobs: 3,
  seconds: 120,
  tests: [
    { name: "lnd/contractcourt", ok: true, seconds: 35 },
    { name: "lnd/sweep", ok: true, seconds: 20 },
  ],
  ...over,
});
const lndRecord = (run: LabRun) => ({
  run,
  missing: [],
  skipped: [],
  tail: "private output",
  lnd: {
    tag: "v0.21.8-beta",
    commit: "59dd7908b33710b511c960d848ecb24c47916c3a",
    manifest: "manifest-v0.21.8-beta.txt",
    source: "lnd-source-v0.21.8-beta.tar.gz",
    required: 5,
    signatures: [],
    go: null,
    tags: [],
    commands: [],
    packages: [],
    error: null,
  },
});
const labFile = () => process.env.BLOCKLORE_LAB_FILE as string;

test("a failing LND package holds LND's run privately and names LND's contact alone", () => {
  const failing = lndRun({
    tests: [
      { name: "lnd/contractcourt", ok: false, seconds: 35 },
      { name: "lnd/sweep", ok: true, seconds: 20 },
    ],
  });
  const g = lab.gateRun(lndRecord(failing), { publish: true });
  assert.equal(g.published, false);
  assert.equal(g.held?.title, "Lab: LND 0.21.8-beta, 1 failed");
  assert.deepEqual(g.held?.reasons, ["failed: lnd/contractcourt"]);
  assert.deepEqual(
    g.held?.contacts.map((c) => [c.project, c.email]),
    [["LND", "security@lightning.engineering"]],
  );
  assert.equal(existsSync(labFile()), false, "lab.json must not be written");
  assert.equal(securityEvents().length, 0, "no public event");
  const view = embargoView(g.held as NonNullable<typeof g.held>);
  assert.match(view.summary, /^LND 0\.21\.8-beta: failed lnd\/contractcourt\./);
  assert.match(
    view.summary,
    /The signed manifest matched\. 4 good maintainer signatures; LND requires 5\./,
  );

  // A release that did not verify: nothing ran, the release check failed, LND's contact again.
  const unverified = lndRun({
    at: "2026-11-23T11:00:00Z",
    verified: { sha256: false, signatures: 4, signers: 16 },
    tests: [{ name: RELEASE_CHECK, ok: false, seconds: 0 }],
  });
  const u = lab.gateRun(lndRecord(unverified), { publish: true });
  assert.equal(u.held?.title, "Lab: LND 0.21.8-beta, 1 failed, release did not verify");
  assert.ok(u.held?.reasons.includes("the source tarball did not match LND's signed manifest"));
  assert.deepEqual(
    u.held?.contacts.map((c) => c.email),
    ["security@lightning.engineering"],
  );
  assert.equal(existsSync(labFile()), false);
  assert.equal(listEmbargo().length, 2);
});

test("a passing LND run publishes beside Bitcoin Core's runs, as LND's", () => {
  const line = lab.labLine(lndRun());
  assert.equal(
    line,
    "Lab: LND 0.21.8-beta passed all 2 of its own unit test packages, built from its verified source",
  );
  assert.ok(line.length <= 160);
  assert.doesNotMatch(line, DASH);
  const g = lab.gateRun(lndRecord(lndRun()), { publish: true });
  assert.equal(g.published, true);
  const runs = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  assert.deepEqual(
    runs.map((r) => [r.project, r.version]),
    [["lnd", "0.21.8-beta"]],
  );
  assert.ok(securityEvents().some((e) => e.text === line));
});
