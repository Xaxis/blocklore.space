import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  ECLAIR_SUITES,
  Lab,
  type LabRun,
  LabRun as LabRunSchema,
  RELEASE_CHECK,
} from "@blocklore/core";

// Eclair in the lab, against real data from Eclair 0.14.6 (brain/test/data/eclair-0.14.6):
// Eclair's tags, the release's notes, what SHA256SUMS.asc signs (as gpg -d writes it), gpg's own
// status output for that signature (and for a changed file and a keyring without the key), the
// listing of the signed eclair-node zip and its jar's manifest, the Maven wrapper's properties at
// the tag, and real Maven and scalatest output from the lab's first run. Every path the lab writes
// points into a temporary folder, set before the modules load.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-eclair-"));
process.env.BLOCKLORE_EMBARGO_DIR = path.join(tmp, "embargo");
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_LAB_DIR = path.join(tmp, "lab");
process.env.BLOCKLORE_LAB_FILE = path.join(tmp, "knowledge", "security", "lab.json");
after(() => rmSync(tmp, { recursive: true, force: true }));

const eclair = await import("../src/security/eclair.ts");
const lab = await import("../src/security/lab.ts");
const { signatureState } = await import("../src/security/lnd.ts");
const { parseSums } = await import("../src/security/release.ts");
const { embargoView, listEmbargo } = await import("../src/security/embargo.ts");
const { securityEvents } = await import("../src/security/events.ts");

const DATA = path.join(import.meta.dirname, "data", "eclair-0.14.6");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);
const COMMIT = "50e046ef6f3a83afb4e5df84783ea87014f0beab";
const DROUIN = "55092314AD0547C59BDB7AE8E04E48E72C205463";
const ZIP_SHA = "898fa274bb1fc7d673005a4d171f0a14512c33107dd6adc2c6e123ec1b7cf007";
const status = JSON.parse(read("gpg-status.json")) as Record<
  "good" | "changed" | "nokey",
  { exit: number; status: string }
>;

test("Eclair's newest release is its newest final tag, never an alpha, rc or patch tag", () => {
  const ls = read("ls-remote.txt");
  assert.equal(eclair.newestEclairRelease(ls), "0.14.6");
  const all = eclair.eclairReleases(ls);
  assert.deepEqual(all.slice(0, 3), ["0.14.6", "0.14.5", "0.14.4"]);
  assert.ok(all.every((v) => /^\d+\.\d+\.\d+$/.test(v)));
  assert.ok(!all.includes("0.7.0-patch-disconnect"));
  assert.equal(eclair.newestEclairRelease(""), null);
});

test("the notes name the signing key and the JDK; only a pinned key's id counts", () => {
  const notes = eclair.readNotes(read("notes.md.txt"));
  assert.deepEqual(notes, { keyId: "E04E48E72C205463", jdk: "21.0.12.1" });
  assert.equal(eclair.pinnedKey(notes.keyId)?.fingerprint, DROUIN);
  assert.equal(eclair.pinnedKey("E434ED292E85643A")?.name, "Pierre-Marie Padiou");
  // An id no pinned key ends with, a short id, or none names no key.
  assert.equal(eclair.pinnedKey("0123456789ABCDEF"), null);
  assert.equal(eclair.pinnedKey("2C205463"), null);
  assert.equal(eclair.pinnedKey(null), null);
  assert.deepEqual(eclair.readNotes("no key here"), { keyId: null, jdk: null });
  for (const k of eclair.ECLAIR_KEYS) {
    assert.match(k.fingerprint, /^[0-9A-F]{40}$/);
    assert.match(k.url, /^https:\/\/acinq\.co\/pgp\/[a-z0-9]+\.asc$/);
  }
});

test("the signature over SHA256SUMS counts only when gpg says good by the pinned key", () => {
  assert.equal(signatureState(status.good.status, DROUIN, status.good.exit), "good");
  assert.equal(signatureState(status.changed.status, DROUIN, status.changed.exit), "bad");
  assert.equal(signatureState(status.nokey.status, DROUIN, status.nokey.exit), "bad");
  // Good, but by a key other than the one the notes name, never counts.
  const other = eclair.ECLAIR_KEYS[1].fingerprint;
  assert.equal(signatureState(status.good.status, other, status.good.exit), "bad");
});

test("the signed sums name one eclair-node zip, and its jar names the commit it was built from", () => {
  const sums = parseSums(read("SHA256SUMS.stripped"));
  assert.equal(sums.size, 3);
  const zip = eclair.nodeZip(sums, "0.14.6");
  assert.deepEqual(zip, {
    file: "eclair-node-0.14.6-50e046e-bin.zip",
    sha256: ZIP_SHA,
    short: "50e046e",
  });
  assert.equal(eclair.nodeZip(sums, "0.14.5"), null);
  // eclair-front's zips are never taken for the node's.
  assert.equal(
    eclair.nodeZip(new Map([...sums].filter(([f]) => f.includes("front"))), "0.14.6"),
    null,
  );
  const jar = eclair.nodeJar(read("zip-listing.txt"), zip?.file ?? "", "0.14.6");
  assert.equal(jar, "eclair-node-0.14.6-50e046e/lib/eclair-node_2.13-0.14.6.jar");
  assert.equal(eclair.nodeJar(read("zip-listing.txt"), zip?.file ?? "", "0.14.5"), null);
  const m = eclair.manifestFields(read("MANIFEST.MF.txt"));
  assert.equal(m["Specification-Version"], COMMIT);
  assert.equal(m["Implementation-Title"], "eclair-node");
  assert.equal(m["Implementation-Version"], "0.14.6");
  // A 72-column continuation line joins the one before it.
  assert.ok(m["Class-Path"]?.includes("eclair-core_2.13-0.14.6.jar scala-collection-contrib"));
  assert.ok(m["Class-Path"]?.endsWith("scala-library-2.13.11.jar"));
});

test("a release verifies only when the zip matched, names the clean checkout, and the signature is good", () => {
  const manifest = eclair.manifestFields(read("MANIFEST.MF.txt"));
  const zip = { sha256: ZIP_SHA, got: ZIP_SHA, short: "50e046e" };
  const base = {
    version: "0.14.6",
    signature: "good" as const,
    zip,
    manifest,
    head: COMMIT,
    clean: true,
  };
  assert.deepEqual(eclair.eclairVerified(base), { checkout: true, verified: true });
  assert.deepEqual(eclair.eclairVerified({ ...base, signature: "bad" }), {
    checkout: true,
    verified: false,
  });
  assert.deepEqual(eclair.eclairVerified({ ...base, signature: "expired" }), {
    checkout: true,
    verified: false,
  });
  for (const over of [
    { zip: { ...zip, got: ZIP_SHA.replace("898", "899") } },
    { zip: null },
    { manifest: null },
    { manifest: { ...manifest, "Specification-Version": COMMIT.replace("50e", "50f") } },
    { manifest: { ...manifest, "Implementation-Version": "0.14.5" } },
    { manifest: { ...manifest, "Implementation-Title": "eclair-front" } },
    { head: "50e046e" },
    { clean: false },
    { version: "0.14.5" },
  ])
    assert.deepEqual(eclair.eclairVerified({ ...base, ...over }), {
      checkout: false,
      verified: false,
    });
});

test("Maven is the version Eclair's wrapper pins; the JDK is this machine's Temurin", () => {
  assert.equal(eclair.wrapperMaven(read("maven-wrapper.properties.txt")), "3.9.9");
  assert.equal(eclair.wrapperMaven(read("maven-wrapper.properties.txt")), eclair.MAVEN.version);
  assert.equal(eclair.wrapperMaven("distributionUrl=https://example.org/other.zip"), null);
  assert.match(eclair.MAVEN.sha512, /^[0-9a-f]{128}$/);
  assert.match(eclair.MAVEN.key, /^[0-9A-F]{40}$/);
  assert.match(eclair.TEMURIN.key, /^[0-9A-F]{40}$/);
  assert.equal(
    eclair.temurinFile("x64").file,
    "OpenJDK21U-jdk_x64_linux_hotspot_21.0.12.1_1.tar.gz",
  );
  assert.match(eclair.temurinFile("arm64").file, /aarch64/);
  assert.throws(() => eclair.temurinFile("ia32"), /no Temurin build for ia32/);
  // The JDK the notes name is the one pinned.
  assert.ok(eclair.TEMURIN.version.startsWith(`${eclair.readNotes(read("notes.md.txt")).jdk}+`));
});

test("Maven runs with every folder and every JVM's home under the lab's, whatever the user set", () => {
  const dirs = { jdk: "/lab/java/jdk", maven: "/lab/java/mvn", home: "/lab/home", tmp: "/lab/tmp" };
  const env = eclair.mavenEnv(dirs, {
    PATH: "/usr/bin",
    HOME: "/home/me",
    JAVA_HOME: "/usr/lib/jvm/other",
    JAVA_TOOL_OPTIONS: "-javaagent:/evil.jar",
    _JAVA_OPTIONS: "-Xmx1m",
    MAVEN_OPTS: "-Dx=y",
    MAVEN_ARGS: "-s /home/me/settings.xml",
    M2_HOME: "/opt/maven",
    CLASSPATH: "/home/me/lib",
    SBT_OPTS: "-Dsbt.global.base=/home/me/.sbt",
    LANG: "C.UTF-8",
  });
  assert.equal(env.PATH, "/lab/java/jdk/bin:/lab/java/mvn/bin:/usr/bin");
  assert.equal(env.JAVA_HOME, "/lab/java/jdk");
  assert.equal(env.HOME, "/lab/home");
  assert.equal(env.TMPDIR, "/lab/tmp");
  assert.equal(env.JAVA_TOOL_OPTIONS, "-Duser.home=/lab/home -Djava.io.tmpdir=/lab/tmp");
  for (const k of ["_JAVA_OPTIONS", "MAVEN_OPTS", "MAVEN_ARGS", "M2_HOME", "CLASSPATH", "SBT_OPTS"])
    assert.equal(env[k], undefined, k);
  assert.equal(env.LANG, "C.UTF-8");
});

test("each group runs as BUILD.md runs tests, in eclair-core, offline once its dependencies are kept", () => {
  assert.deepEqual(eclair.testArgv("/lab/m2", "channel/states", 3, true), [
    "mvn",
    "-B",
    "-ntp",
    "--strict-checksums",
    "-o",
    "-Dmaven.repo.local=/lab/m2",
    "-pl",
    "eclair-core",
    "test",
    "-DthreadCount=3",
    "-DwildcardSuites=fr.acinq.eclair.channel.states",
  ]);
  assert.ok(!eclair.testArgv("/lab/m2", "router", 2, false).includes("-o"));
  // A group named for a class is that one suite; any other is its package's every suite.
  assert.equal(
    eclair.suiteArg("blockchain/bitcoind/ZmqWatcherSpec"),
    "-Dsuites=fr.acinq.eclair.blockchain.bitcoind.ZmqWatcherSpec",
  );
  assert.equal(
    eclair.suitePath("blockchain/bitcoind/ZmqWatcherSpec"),
    "eclair-core/src/test/scala/fr/acinq/eclair/blockchain/bitcoind/ZmqWatcherSpec.scala",
  );
  assert.equal(eclair.suitePath("crypto"), "eclair-core/src/test/scala/fr/acinq/eclair/crypto");
  assert.deepEqual(eclair.mavenArgv("/m", false, ["clean", "install", "-DskipTests"]).slice(-3), [
    "clean",
    "install",
    "-DskipTests",
  ]);
});

test("scalatest's own summary decides a group: every test it ran, each one it marked FAILED", () => {
  // Eclair's crypto package, all 12 suites passing, then ShaChainSpec with one assertion turned
  // around in a scratch copy of the source (the lab never edits a release it tests).
  const pass = eclair.parseScalatest(read("scalatest-pass.txt"));
  assert.deepEqual(
    [
      pass.summary,
      pass.passed,
      pass.failed,
      pass.canceled,
      pass.ignored,
      pass.suites,
      pass.aborted,
    ],
    [true, 90, 0, 0, 0, 12, 0],
  );
  assert.equal(pass.seconds, 16.7);
  assert.deepEqual(pass.failedNames, []);
  const fail = eclair.parseScalatest(read("scalatest-fail.txt"));
  assert.deepEqual(
    [fail.summary, fail.passed, fail.failed, fail.suites, fail.aborted],
    [true, 12, 1, 1, 0],
  );
  assert.equal(fail.seconds, 1.7);
  // Scalatest repeats a failure after its summary; it is one failure.
  assert.deepEqual(fail.failedNames, ["generate and receive hashes"]);
  assert.match(fail.output[0] ?? "", /generate and receive hashes \*\*\* FAILED \*\*\*/);
  // Colours change nothing; output that never reached a summary is no result.
  const esc = String.fromCharCode(27);
  const coloured = read("scalatest-pass.txt").replace(/^(Tests: .*)$/m, `${esc}[32m$1${esc}[0m`);
  assert.equal(eclair.parseScalatest(coloured).passed, 90);
  const cut = read("scalatest-pass.txt").split("Run completed")[0] as string;
  assert.equal(eclair.parseScalatest(cut).summary, false);
  const aborted = eclair.parseScalatest(
    "*** RUN ABORTED ***\nAn exception or error caused a run to abort.\n" +
      "Exception encountered when invoking run on a nested suite with class name: fr.acinq.eclair.router.RouterSpec *** ABORTED ***\n" +
      "Run completed in 3 minutes, 2 seconds.\nSuites: completed 4, aborted 1\n" +
      "Tests: succeeded 40, failed 0, canceled 0, ignored 0, pending 0\n",
  );
  assert.deepEqual(aborted.failedNames, ["fr.acinq.eclair.router.RouterSpec (aborted)"]);
  assert.equal(aborted.seconds, 182);
  assert.equal(aborted.aborted, 1);
});

test("the dependencies kept are every file Maven resolved, bitcoind's archive too, never Eclair's own", () => {
  const m2 = path.join(tmp, "m2-files");
  const put = (rel: string) => {
    mkdirSync(path.dirname(path.join(m2, rel)), { recursive: true });
    writeFileSync(path.join(m2, rel), rel);
  };
  for (const rel of [
    "org/scala-lang/scala-library/2.13.11/scala-library-2.13.11.jar",
    "org/scala-lang/scala-library/2.13.11/scala-library-2.13.11.pom",
    "org/scala-lang/scala-library/2.13.11/scala-library-2.13.11.jar.sha1",
    "org/scala-lang/scala-library/2.13.11/_remote.repositories",
    ".cache/download-maven-plugin/bitcoin-31.1-x86_64-linux-gnu.tar.gz_af262a4fc564a4724bd56bfad788a68d",
    ".cache/download-maven-plugin/index.ser",
    "fr/acinq/eclair/eclair-core_2.13/0.14.6/eclair-core_2.13-0.14.6.jar",
    "fr/acinq/bitcoin/bitcoin-kmp-jvm/0.29.0/bitcoin-kmp-jvm-0.29.0.jar",
  ])
    put(rel);
  assert.deepEqual(eclair.resolvedFiles(m2), [
    ".cache/download-maven-plugin/bitcoin-31.1-x86_64-linux-gnu.tar.gz_af262a4fc564a4724bd56bfad788a68d",
    "fr/acinq/bitcoin/bitcoin-kmp-jvm/0.29.0/bitcoin-kmp-jvm-0.29.0.jar",
    "org/scala-lang/scala-library/2.13.11/scala-library-2.13.11.jar",
    "org/scala-lang/scala-library/2.13.11/scala-library-2.13.11.pom",
  ]);
  assert.deepEqual(eclair.resolvedFiles(path.join(tmp, "no-such-m2")), []);
});

test("the threat map's Eclair groups go to Eclair's run, and Core's run leaves them alone", () => {
  const threats = [
    { lab: ["mempool_package_rbf.py", "eclair/channel/states", "ldk/chain/package"] },
    { lab: ["eclair/router", "eclair/nope", "eclair/channel/states", RELEASE_CHECK] },
  ];
  assert.deepEqual(eclair.selectEclairSuites(threats), {
    suites: ["channel/states", "router"],
    unknown: ["eclair/nope"],
  });
  assert.deepEqual(eclair.selectEclairSuites(threats, ["eclair/crypto", "lnd/sweep"]), {
    suites: ["crypto"],
    unknown: [],
  });
  const core = lab.selectTests(threats, new Set(["mempool_package_rbf.py"]));
  assert.deepEqual(core, { run: ["mempool_package_rbf.py"], secp256k1: [], missing: [] });
  // Eclair's version looks like one of Bitcoin Core's, so Eclair's is named with its project.
  assert.deepEqual(
    lab.splitVersions(["0.14.6", "eclair:0.14.6", "eclair:v0.14.6", "eclair:0.14"]),
    {
      releases: [
        { project: "bitcoin-core", version: "0.14.6" },
        { project: "eclair", version: "0.14.6" },
        { project: "eclair", version: "0.14.6" },
      ],
      bad: ["eclair:0.14"],
    },
  );
  // Every group the lab knows is one the threat map lists.
  const listed = new Set(
    ["old-state", "replacement-cycling", "lightning-bugs"].flatMap((id) => {
      const y = readFileSync(
        path.join(
          import.meta.dirname,
          "..",
          "..",
          "knowledge",
          "security",
          "threats",
          `${id}.yaml`,
        ),
        "utf8",
      );
      return /^lab: \[(.*)\]$/m.exec(y)?.[1]?.split(", ") ?? [];
    }),
  );
  for (const s of ECLAIR_SUITES)
    assert.ok(listed.has(`eclair/${s}`), `eclair/${s} is on the threat map`);
});

const eclairRun = (over: Partial<LabRun> = {}): LabRun =>
  LabRunSchema.parse({
    at: "2026-11-26T10:00:00Z",
    project: "eclair",
    version: "0.14.6",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 1, signers: 1 },
    jobs: 3,
    seconds: 600,
    tests: [
      { name: "eclair/channel/states", ok: true, seconds: 500 },
      { name: "eclair/router", ok: true, seconds: 100 },
    ],
    ...over,
  });
const eclairRecord = (run: LabRun) => ({
  run,
  missing: [],
  skipped: [],
  tail: "private output",
  eclair: {
    tag: "v0.14.6",
    commit: COMMIT,
    notes: { keyId: "E04E48E72C205463", jdk: "21.0.12.1" },
    key: { fingerprint: DROUIN, name: "Fabrice Drouin", from: "https://acinq.co/pgp/drouinf2.asc" },
    signature: { state: "good" as const, exit: 0, status: "" },
    zip: { file: "eclair-node-0.14.6-50e046e-bin.zip", sha256: ZIP_SHA, got: ZIP_SHA },
    manifest: null,
    checkout: true,
    jdk: null,
    maven: null,
    resolved: null,
    commands: [],
    build: null,
    reproduced: null,
    groups: [],
  },
});
const labFile = () => process.env.BLOCKLORE_LAB_FILE as string;

test("an Eclair run's version is Eclair's, and its tests are Eclair's groups", () => {
  assert.equal(eclairRun().project, "eclair");
  assert.throws(() => eclairRun({ version: "0.21.8-beta" }), /not how Eclair tags a release/);
  assert.throws(() => eclairRun({ version: "0.14" }), /not how Eclair tags a release/);
  assert.throws(
    () => eclairRun({ tests: [{ name: "ldk/chain/package", ok: true, seconds: 1 }] }),
    /ldk\/chain\/package is not a test of Eclair/,
  );
  assert.throws(() => eclairRun({ tests: [{ name: "eclair/nope", ok: true, seconds: 1 }] }));
});

test("a failing Eclair group holds Eclair's run privately and names Eclair's contact alone", () => {
  const failing = eclairRun({
    tests: [
      { name: "eclair/channel/states", ok: false, seconds: 500 },
      { name: "eclair/router", ok: true, seconds: 100 },
    ],
  });
  const g = lab.gateRun(eclairRecord(failing), { publish: true });
  assert.equal(g.published, false);
  assert.equal(g.held?.title, "Lab: Eclair 0.14.6, 1 failed");
  assert.deepEqual(g.held?.reasons, ["failed: eclair/channel/states"]);
  assert.deepEqual(
    g.held?.contacts.map((c) => [c.project, c.email]),
    [["Eclair", "security@acinq.fr"]],
  );
  assert.equal(existsSync(labFile()), false, "lab.json must not be written");
  assert.equal(securityEvents().length, 0, "no public event");
  const view = embargoView(g.held as NonNullable<typeof g.held>);
  assert.match(view.summary, /^Eclair 0\.14\.6: failed eclair\/channel\/states\./);
  assert.match(
    view.summary,
    /The eclair-node zip matched the signed SHA256SUMS and names the commit checked out\./,
  );
  assert.match(view.summary, /SHA256SUMS\.asc's signature was good, by Fabrice Drouin \(55092314/);

  // Sums no pinned key signed: nothing was built, the release check failed, Eclair's contact again.
  const unverified = eclairRun({
    at: "2026-11-26T11:00:00Z",
    verified: { sha256: false, signatures: 0, signers: 1 },
    tests: [{ name: RELEASE_CHECK, ok: false, seconds: 0 }],
  });
  const u = lab.gateRun(eclairRecord(unverified), { publish: true });
  assert.equal(u.held?.title, "Lab: Eclair 0.14.6, 1 failed, release did not verify");
  assert.ok(
    u.held?.reasons.includes(
      "no signature over SHA256SUMS by the key Eclair's release notes name was good",
    ),
  );
  assert.ok(
    u.held?.reasons.includes(
      "the eclair-node zip did not match Eclair's signed SHA256SUMS, or does not name the commit checked out",
    ),
  );
  assert.deepEqual(
    u.held?.contacts.map((c) => c.email),
    ["security@acinq.fr"],
  );
  assert.equal(existsSync(labFile()), false);
  assert.equal(listEmbargo().length, 2);
});

test("a passing Eclair run publishes beside the other projects' runs, as Eclair's", () => {
  const line = lab.labLine(eclairRun());
  assert.equal(
    line,
    "Lab: Eclair 0.14.6 passed all 2 of its own test groups, built from the commit its signed release names",
  );
  assert.ok(line.length <= 160);
  assert.doesNotMatch(line, DASH);
  const g = lab.gateRun(eclairRecord(eclairRun()), { publish: true });
  assert.equal(g.published, true);
  const runs = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  assert.deepEqual(
    runs.map((r) => [r.project, r.version]),
    [["eclair", "0.14.6"]],
  );
  assert.ok(securityEvents().some((e) => e.text === line));
});
