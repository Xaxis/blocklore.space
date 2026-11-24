import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  Lab,
  type LabRun,
  LabRun as LabRunSchema,
  LDK_MODULES,
  RELEASE_CHECK,
} from "@blocklore/core";

// LDK in the lab, against real data from LDK 0.2.8 and static.rust-lang.org
// (brain/test/data/ldk-0.2.8): LDK's tags, its SECURITY.md and the v0.2.8 tag object as
// `git cat-file tag` prints it, gpg's own status output for the tag's signature (and for a changed
// tag and a keyring without the key), Rust's channel manifest of 2026-11-12, and real `cargo test`
// output from the lab's first run. Every path the lab writes points into a temporary folder, set
// before the modules load.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-ldk-"));
process.env.BLOCKLORE_EMBARGO_DIR = path.join(tmp, "embargo");
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_LAB_DIR = path.join(tmp, "lab");
process.env.BLOCKLORE_LAB_FILE = path.join(tmp, "knowledge", "security", "lab.json");
after(() => rmSync(tmp, { recursive: true, force: true }));

const ldk = await import("../src/security/ldk.ts");
const lab = await import("../src/security/lab.ts");
const { embargoView, listEmbargo } = await import("../src/security/embargo.ts");
const { securityEvents } = await import("../src/security/events.ts");

const DATA = path.join(import.meta.dirname, "data", "ldk-0.2.8");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);
const MATT = {
  fingerprint: "07DF3E57A548CCFB7530709189BBB8663E2E65CE",
  name: "Matt Corallo",
};
const COMMIT = "254bc9687dd190375956ad790f87239b97ebd058";

test("LDK's newest release is its newest final tag; the one before it is the previous final", () => {
  const tags = read("ls-remote.txt");
  assert.equal(ldk.newestLdkRelease(tags), "0.2.8");
  assert.equal(ldk.previousLdkRelease(tags, "0.2.8"), "0.2.7");
  // Release candidates and betas never count, nor peeled lines; a line's first release may be v0.2.
  const more = `${tags}0000000000000000000000000000000000000000\trefs/tags/v0.3.0-rc1\n0000000000000000000000000000000000000000\trefs/tags/v0.3.0-beta2^{}\n`;
  assert.equal(ldk.newestLdkRelease(more), "0.2.8");
  assert.ok(ldk.ldkReleases(tags).includes("0.2"));
  assert.equal(ldk.previousLdkRelease(tags, "0.2.1"), "0.2");
  assert.equal(
    ldk.newestLdkRelease(`${tags}abc\trefs/tags/v0.3\n`),
    "0.3",
    "a new line's first release, tagged without a patch number, is the newest",
  );
  assert.equal(ldk.newestLdkRelease("abc\trefs/tags/lightning-v0.9.9\n"), null);
});

test("SECURITY.md lists six maintainers, one key each; only keys the release before also lists count", () => {
  const listed = ldk.ldkMaintainers(read("SECURITY.md.txt"));
  assert.equal(listed.length, 6);
  assert.deepEqual(listed[0], MATT);
  assert.ok(listed.every((m) => /^[0-9A-F]{40}$/.test(m.fingerprint)));
  // A key added in the release it would sign does not count; one dropped since is gone too.
  const before = listed.slice(1);
  assert.deepEqual(
    ldk.countedMaintainers(listed, before).map((m) => m.name),
    listed.slice(1).map((m) => m.name),
  );
  assert.equal(ldk.countedMaintainers(listed, listed).length, 6);
  assert.throws(() => ldk.ldkMaintainers("# Security Policy\n\nEmail us.\n"), /lists no key/);
  const twice = `${read("SECURITY.md.txt")} * ${MATT.fingerprint} (Someone Else)\n`;
  assert.throws(() => ldk.ldkMaintainers(twice), /fingerprint twice/);
});

test("each key is asked for by its full fingerprint, keys.openpgp.org first, then keyserver.ubuntu.com", () => {
  assert.deepEqual(ldk.keyUrls(MATT.fingerprint), [
    `https://keys.openpgp.org/vks/v1/by-fingerprint/${MATT.fingerprint}`,
    `https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x${MATT.fingerprint}`,
  ]);
  // Never a short id, a lowercase one or anything else a URL could carry.
  for (const bad of ["8D7DC107EE01F294", MATT.fingerprint.toLowerCase(), `${MATT.fingerprint}&x=1`])
    assert.throws(() => ldk.keyUrls(bad), /not a v4 fingerprint/);
});

test("the tag object splits as git verify-tag splits it: the payload it signs and the signature", () => {
  const raw = readFileSync(path.join(DATA, "tag-v0.2.8.txt"));
  const t = ldk.splitSignedTag(raw);
  assert.equal(t.object, COMMIT);
  assert.equal(t.type, "commit");
  assert.equal(t.tag, "v0.2.8");
  assert.match(t.tagger, /^Matt Corallo <git@bluematt\.me> \d+ \+0000$/);
  assert.ok(t.signature.startsWith("-----BEGIN PGP SIGNATURE-----\n"));
  assert.ok(t.signature.trimEnd().endsWith("-----END PGP SIGNATURE-----"));
  // Payload and signature are the whole object, byte for byte, in order.
  assert.equal(Buffer.concat([t.payload, Buffer.from(t.signature)]).equals(raw), true);
  assert.ok(t.payload.toString().endsWith("\n"));
  assert.throws(
    () => ldk.splitSignedTag(Buffer.from("object abc\ntype commit\ntag v1\n\nunsigned\n")),
    /no OpenPGP signature/,
  );
  assert.throws(
    () => ldk.splitSignedTag(Buffer.concat([raw, Buffer.from("trailing text\n")])),
    /does not end/,
  );
});

test("the tag's signature counts only when gpg says good by a counted key, as the primary key", () => {
  const s = JSON.parse(read("gpg-status.json")) as Record<string, { exit: number; status: string }>;
  const good = s.good as { exit: number; status: string };
  assert.deepEqual(ldk.tagSigner(good.status, good.exit, [MATT]), { state: "good", signer: MATT });
  // The same good signature, with Matt's key not counted: no signer.
  const others = ldk.ldkMaintainers(read("SECURITY.md.txt")).slice(1);
  assert.deepEqual(ldk.tagSigner(good.status, good.exit, others), { state: "bad", signer: null });
  // A tag changed by one byte, and a keyring without the key.
  for (const k of ["changed", "nokey"]) {
    const v = s[k] as { exit: number; status: string };
    assert.notEqual(v.exit, 0);
    assert.deepEqual(ldk.tagSigner(v.status, v.exit, [MATT]), { state: "bad", signer: null });
  }
  // gpg exiting non-zero is never good, whatever its status says.
  assert.equal(ldk.tagSigner(good.status, 2, [MATT]).state, "bad");
});

test("a release verifies only when its tag names itself and the clean checkout, signed by a counted key", () => {
  const tag = { object: COMMIT, type: "commit", tag: "v0.2.8" };
  const ok = { version: "0.2.8", tag, head: COMMIT, clean: true, signature: "good" as const };
  assert.deepEqual(ldk.ldkVerified(ok), { checkout: true, verified: true });
  assert.deepEqual(ldk.ldkVerified({ ...ok, signature: "bad" }), {
    checkout: true,
    verified: false,
  });
  assert.deepEqual(ldk.ldkVerified({ ...ok, signature: "expired" }), {
    checkout: true,
    verified: false,
  });
  for (const bad of [
    { ...ok, clean: false },
    { ...ok, head: "0".repeat(40) },
    { ...ok, tag: { ...tag, tag: "v0.2.7" } },
    { ...ok, tag: { ...tag, type: "tree" } },
  ])
    assert.deepEqual(ldk.ldkVerified(bad), { checkout: false, verified: false });
});

test("Rust stable is the channel manifest's, each component's archive with the manifest's SHA-256", () => {
  const m = ldk.rustStable(read("channel-rust-stable.toml"), "x86_64-unknown-linux-gnu");
  assert.equal(m.version, "1.100.0");
  assert.equal(m.date, "2026-11-12");
  assert.deepEqual(m.files.rustc, {
    file: "rustc-1.100.0-x86_64-unknown-linux-gnu.tar.xz",
    sha256: "f1d0b1dec81dab6f523cd098507763487b0d4bd7fd2c87582f154128719be03b",
  });
  assert.deepEqual(Object.keys(m.files), ["rustc", "cargo", "rust-std"]);
  assert.equal(
    ldk.rustStable(read("channel-rust-stable.toml"), "aarch64-unknown-linux-gnu").files.cargo.file,
    "cargo-1.100.0-aarch64-unknown-linux-gnu.tar.xz",
  );
  assert.throws(
    () => ldk.rustStable(read("channel-rust-stable.toml"), "riscv64gc-unknown-linux-gnu"),
    /no rustc for riscv64gc/,
  );
  assert.equal(ldk.rustTriple("x64"), "x86_64-unknown-linux-gnu");
  assert.throws(() => ldk.rustTriple("ia32"), /no Rust release/);
});

test("cargo runs with every folder under the lab's, offline once the crates are in, whatever the user set", () => {
  const dirs = {
    rust: "/lab/rust/1.100.0",
    cargoHome: "/lab/rust/cargo-home",
    target: "/lab/ldk/0.2.8/target",
    home: "/lab/home",
    tmp: "/lab/ldk/0.2.8/tmp",
  };
  const base = {
    PATH: "/usr/bin",
    USER: "x",
    RUSTFLAGS: "--cfg=evil",
    CARGO_HOME: "/home/x/.cargo",
    CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "git",
    RUSTUP_TOOLCHAIN: "nightly",
  };
  const offline = ldk.cargoEnv(dirs, base, false);
  assert.equal(offline.PATH, "/lab/rust/1.100.0/bin:/usr/bin");
  assert.equal(offline.CARGO_HOME, "/lab/rust/cargo-home");
  assert.equal(offline.CARGO_TARGET_DIR, "/lab/ldk/0.2.8/target");
  assert.equal(offline.HOME, "/lab/home");
  assert.equal(offline.CARGO_NET_OFFLINE, "true");
  assert.equal(offline.RUST_BACKTRACE, "1");
  assert.equal(offline.USER, "x");
  for (const k of ["RUSTFLAGS", "RUSTUP_TOOLCHAIN", "CARGO_REGISTRIES_CRATES_IO_PROTOCOL"])
    assert.equal(offline[k], undefined, `${k} is dropped`);
  assert.equal(ldk.cargoEnv(dirs, base, true).CARGO_NET_OFFLINE, "false");
});

test("each module runs as CI's cargo test does, filtered to its own path, offline and locked", () => {
  assert.deepEqual(ldk.cargoTestArgv("ln/monitor_tests", 3), [
    "cargo",
    "test",
    "-p",
    "lightning",
    "--lib",
    "--locked",
    "--offline",
    "-j3",
    "ln::monitor_tests::",
    "--",
    "--test-threads=3",
  ]);
  // A filter ends with ::, so ln::functional_tests never takes ln::functional_test_utils.
  assert.equal(ldk.moduleFilter("ln/functional_tests"), "ln::functional_tests::");
  assert.equal(ldk.moduleFilter("chain/package"), "chain::package::");
});

test("libtest's output comes to one verdict per module, its own time, and what failed", () => {
  const pass = ldk.parseLibtest(read("cargo-test-package.txt"));
  assert.equal(pass.result, "ok");
  assert.equal(pass.passed, 12);
  assert.equal(pass.failed, 0);
  assert.deepEqual(pass.failedNames, []);
  assert.ok(pass.seconds >= 0);

  const fail = ldk.parseLibtest(read("cargo-test-fail.txt"));
  assert.equal(fail.result, "FAILED");
  assert.equal(fail.failed, 1);
  assert.deepEqual(fail.failedNames, ["tests::refuses_a_revoked_state"]);
  assert.ok(fail.output.some((l) => l.includes("panicked at")));

  // A filter that matches nothing passes zero tests: the run counts it missing, not passed.
  const none = ldk.parseLibtest(read("cargo-test-nomatch.txt"));
  assert.equal(none.result, "ok");
  assert.equal(none.passed, 0);

  // A build that fails prints no test result at all: never a pass.
  const broken = ldk.parseLibtest(
    "error[E0425]: cannot find value `x` in this scope\nerror: could not compile `lightning`\n",
  );
  assert.equal(broken.result, null);
});

test("the threat map's LDK modules go to LDK's run, and Core's run leaves them alone", () => {
  const threats = [
    { lab: ["mempool_truc.py", "ldk/chain/package", "lnd/contractcourt"] },
    { lab: ["ldk/ln/monitor_tests", "ldk/ln/nope", "ldk/chain/package", RELEASE_CHECK] },
  ];
  assert.deepEqual(ldk.selectLdkModules(threats), {
    modules: ["chain/package", "ln/monitor_tests"],
    unknown: ["ldk/ln/nope"],
  });
  assert.deepEqual(ldk.selectLdkModules(threats, ["ldk/ln/onion_route_tests", "lnd/sweep"]), {
    modules: ["ln/onion_route_tests"],
    unknown: [],
  });
  const core = lab.selectTests(threats, new Set(["mempool_truc.py"]));
  assert.deepEqual(core, { run: ["mempool_truc.py"], secp256k1: [], missing: [] });
  // LDK's version looks like one of Bitcoin Core's, so LDK's is named with its project.
  assert.deepEqual(
    lab.splitVersions([
      "0.2.8",
      "ldk:0.2.8",
      "ldk:v0.2",
      "lnd:0.21.8-beta",
      "ldk:0.2.8-beta",
      "cln:1.0",
    ]),
    {
      releases: [
        { project: "bitcoin-core", version: "0.2.8" },
        { project: "ldk", version: "0.2.8" },
        { project: "ldk", version: "0.2" },
        { project: "lnd", version: "0.21.8-beta" },
      ],
      bad: ["ldk:0.2.8-beta", "cln:1.0"],
    },
  );
  // Every module the lab knows is one the threat map lists, and each is a file in the crate.
  const listed = new Set(
    ["old-state", "pinning", "lightning-bugs"].flatMap((id) => {
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
  for (const m of LDK_MODULES) assert.ok(listed.has(`ldk/${m}`), `ldk/${m} is on the threat map`);
});

const ldkRun = (over: Partial<LabRun> = {}): LabRun =>
  LabRunSchema.parse({
    at: "2026-11-24T10:00:00Z",
    project: "ldk",
    version: "0.2.8",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 1, signers: 6 },
    jobs: 3,
    seconds: 90,
    tests: [
      { name: "ldk/chain/package", ok: true, seconds: 0.1 },
      { name: "ldk/ln/monitor_tests", ok: true, seconds: 40 },
    ],
    ...over,
  });
const ldkRecord = (run: LabRun) => ({
  run,
  missing: [],
  skipped: [],
  tail: "private output",
  ldk: {
    tag: "v0.2.8",
    commit: COMMIT,
    tagger: "Matt Corallo <git@bluematt.me>",
    previous: { tag: "v0.2.7", maintainers: 6 },
    maintainers: [],
    signature: {
      state: "good" as const,
      signer: `Matt Corallo ${MATT.fingerprint}`,
      exit: 0,
      status: "",
    },
    checkout: true,
    rust: null,
    lock: null,
    commands: [],
    build: null,
    modules: [],
  },
});
const labFile = () => process.env.BLOCKLORE_LAB_FILE as string;

test("an LDK run's version is LDK's, and its tests are LDK's modules", () => {
  assert.equal(ldkRun().project, "ldk");
  assert.throws(() => ldkRun({ version: "0.21.8-beta" }), /not how LDK tags a release/);
  assert.throws(
    () => ldkRun({ tests: [{ name: "lnd/sweep", ok: true, seconds: 1 }] }),
    /lnd\/sweep is not a test of LDK/,
  );
  assert.throws(() => ldkRun({ tests: [{ name: "ldk/ln/nope", ok: true, seconds: 1 }] }));
});

test("a failing LDK module holds LDK's run privately and names LDK's contact alone", () => {
  const failing = ldkRun({
    tests: [
      { name: "ldk/chain/package", ok: true, seconds: 0.1 },
      { name: "ldk/ln/monitor_tests", ok: false, seconds: 40 },
    ],
  });
  const g = lab.gateRun(ldkRecord(failing), { publish: true });
  assert.equal(g.published, false);
  assert.equal(g.held?.title, "Lab: LDK 0.2.8, 1 failed");
  assert.deepEqual(g.held?.reasons, ["failed: ldk/ln/monitor_tests"]);
  assert.deepEqual(
    g.held?.contacts.map((c) => [c.project, c.email]),
    [["LDK", "security@lightningdevkit.org"]],
  );
  assert.equal(existsSync(labFile()), false, "lab.json must not be written");
  assert.equal(securityEvents().length, 0, "no public event");
  const view = embargoView(g.held as NonNullable<typeof g.held>);
  assert.match(view.summary, /^LDK 0\.2\.8: failed ldk\/ln\/monitor_tests\./);
  assert.match(view.summary, /The source checked out is the commit the release tag names\./);
  assert.match(view.summary, /The tag's signature was good, by Matt Corallo 07DF3E57/);

  // A tag no counted key signed: nothing was built, the release check failed, LDK's contact again.
  const unverified = ldkRun({
    at: "2026-11-24T11:00:00Z",
    verified: { sha256: true, signatures: 0, signers: 6 },
    tests: [{ name: RELEASE_CHECK, ok: false, seconds: 0 }],
  });
  const u = lab.gateRun(ldkRecord(unverified), { publish: true });
  assert.equal(u.held?.title, "Lab: LDK 0.2.8, 1 failed, release did not verify");
  assert.ok(
    u.held?.reasons.includes(
      "no signature on LDK's release tag by a maintainer its SECURITY.md lists was good",
    ),
  );
  assert.deepEqual(
    u.held?.contacts.map((c) => c.email),
    ["security@lightningdevkit.org"],
  );
  assert.equal(existsSync(labFile()), false);
  assert.equal(listEmbargo().length, 2);
});

test("a passing LDK run publishes beside the other projects' runs, as LDK's", () => {
  const line = lab.labLine(ldkRun());
  assert.equal(
    line,
    "Lab: LDK 0.2.8 passed all 2 of its own test modules, built from its signed release tag",
  );
  assert.ok(line.length <= 160);
  assert.doesNotMatch(line, DASH);
  const g = lab.gateRun(ldkRecord(ldkRun()), { publish: true });
  assert.equal(g.published, true);
  const runs = Lab.parse(JSON.parse(readFileSync(labFile(), "utf8"))).runs;
  assert.deepEqual(
    runs.map((r) => [r.project, r.version]),
    [["ldk", "0.2.8"]],
  );
  assert.ok(securityEvents().some((e) => e.text === line));
});
