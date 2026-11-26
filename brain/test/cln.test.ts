import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  CLN_GROUPS,
  LabRun as LabRunSchema,
  labEmbargo,
  labTestLabel,
  labTestProject,
  RELEASE_CHECK,
} from "@blocklore/core";

// Core Lightning in the lab, against real data from Core Lightning 26.06.10 and its build's
// dependencies (brain/test/data/cln-26.06.10): its SECURITY.md and SHA256SUMS at the tag, gpg's
// own status output for SHA256SUMS-v26.06.10.asc against the keyring the lab built on 2026-11-26,
// the uv.lock blocks the build's Python comes from, libsodium 1.0.22's minisign signature, and the
// penalties group's output from the run the lab published that day. Every path the lab writes
// points into a temporary folder, set before the modules load.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-cln-"));
process.env.BLOCKLORE_EMBARGO_DIR = path.join(tmp, "embargo");
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_LAB_DIR = path.join(tmp, "lab");
process.env.BLOCKLORE_LAB_FILE = path.join(tmp, "knowledge", "security", "lab.json");
after(() => rmSync(tmp, { recursive: true, force: true }));

const cln = await import("../src/security/cln.ts");
const lab = await import("../src/security/lab.ts");
const { countedMaintainers } = await import("../src/security/ldk.ts");
const { parseSums } = await import("../src/security/release.ts");
const { embargoView, listEmbargo } = await import("../src/security/embargo.ts");

const DATA = path.join(import.meta.dirname, "data", "cln-26.06.10");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);
const CLN_KEY = "616C52F99D0612B2A151B1074129A994AA7E9852";

test("Core Lightning's releases: final ones by year and month, newest first", () => {
  const ls = [
    "aaa\trefs/tags/v0.12.1",
    "bbb\trefs/tags/v25.12.1",
    "ccc\trefs/tags/v26.06",
    "ddd\trefs/tags/v26.06rc2",
    "eee\trefs/tags/v26.06.9",
    "fff\trefs/tags/v26.06.10",
    "fff\trefs/tags/v26.06.10^{}",
    "ggg\trefs/tags/v26.12rc1",
    "hhh\trefs/tags/v26.03.2",
  ].join("\n");
  assert.deepEqual(cln.clnReleases(ls), ["26.06.10", "26.06.9", "26.06", "26.03.2", "25.12.1"]);
  assert.equal(cln.newestClnRelease(ls), "26.06.10");
  assert.equal(cln.previousClnRelease(ls, "26.06.10"), "26.06.9");
  assert.equal(cln.previousClnRelease(ls, "26.06"), "26.03.2");
  assert.equal(cln.previousClnRelease(ls, "25.12.1"), null);
  assert.equal(cln.newestClnRelease(""), null);
  const files = cln.clnFiles("26.06.10");
  assert.deepEqual(files, {
    zip: "clightning-v26.06.10.zip",
    sums: "SHA256SUMS-v26.06.10",
    sig: "SHA256SUMS-v26.06.10.asc",
  });
  // The release's own sums list the source zip under that name.
  assert.equal(
    parseSums(read(files.sums)).get(files.zip),
    "4914561e6d108dacca0183d7e6b3b1c224c580597ddcbb397299ef5b0fcc3230",
  );
});

test("the release keys are SECURITY.md's table, fingerprints joined, and only those listed before count", () => {
  const md = read("SECURITY.md");
  const keys = cln.clnReleaseKeys(md);
  assert.equal(keys.length, 14);
  assert.deepEqual(keys[0], {
    fingerprint: "1176542DA98E71E133722EF74AC8CC886844A2D6",
    name: "Blockstream Security Reporting",
  });
  assert.deepEqual(keys.at(-1), { fingerprint: CLN_KEY, name: "Blockstream CLN Release" });
  for (const k of keys) assert.match(k.fingerprint, /^[0-9A-F]{40}$/);
  // A key the release adds itself, absent from the release before, does not count.
  const before = md.replace(/^\| Blockstream CLN Release .*\n/m, "");
  const counted = countedMaintainers(keys, cln.clnReleaseKeys(before));
  assert.equal(counted.length, 13);
  assert.ok(!counted.some((k) => k.fingerprint === CLN_KEY));
  // A file that lists none the way the lab reads them is an error, never "no keys".
  assert.throws(() => cln.clnReleaseKeys("# Security Policy\n"), /no Signatures For Releases/);
  assert.throws(() => cln.clnReleaseKeys("## Signatures For Releases\n\nask us\n"), /lists no key/);
  const twice = md.replace(/^(\| Rusty Russell .*)$/m, "$1\n$1");
  assert.throws(() => cln.clnReleaseKeys(twice), /twice/);
});

test("each signature in the sums file is read from gpg's status: good, expired, unknown or bad", () => {
  const status = read("gpg-status.txt");
  const sigs = cln.sumsSignatures(status);
  const good = sigs.filter((s) => s.state === "good");
  assert.ok(good.length >= 1);
  assert.ok(good.some((s) => s.fingerprint === CLN_KEY));
  for (const s of good) assert.match(s.fingerprint ?? "", /^[0-9A-F]{40}$/);
  assert.ok(!sigs.some((s) => s.state === "bad"));
  // Made up around the real lines: each NEWSIG starts the next signature.
  const made = [
    "[GNUPG:] NEWSIG",
    "[GNUPG:] ERRSIG 1111111111111111 1 10 00 1784220026 9 -",
    "[GNUPG:] NO_PUBKEY 1111111111111111",
    "[GNUPG:] NEWSIG",
    "[GNUPG:] BADSIG 2222222222222222 Someone",
    "[GNUPG:] NEWSIG",
    "[GNUPG:] EXPKEYSIG 3333333333333333 Expired",
    `[GNUPG:] VALIDSIG ${"3".repeat(40)} 2026-11-01 1 0 4 0 1 10 00 ${"3".repeat(40)}`,
    "[GNUPG:] NEWSIG",
    "[GNUPG:] ERRSIG 4444444444444444 22 10 00 1784220026 4 -",
  ].join("\n");
  assert.deepEqual(
    cln.sumsSignatures(made).map((s) => s.state),
    ["unknown", "bad", "expired", "bad"],
  );
  assert.deepEqual(cln.sumsSignatures("gpg: no valid OpenPGP data found.\n"), []);
});

test("a release verifies when the zip matches, nothing is bad, and a counted key signed", () => {
  const counted = [{ fingerprint: CLN_KEY, name: "Blockstream CLN Release" }];
  const good = { keyid: "4129A994AA7E9852", fingerprint: CLN_KEY, state: "good" as const };
  const other = { keyid: "1", fingerprint: null, state: "unknown" as const };
  const ok = cln.clnVerified({ sha256: true, signatures: [good, other], counted });
  assert.deepEqual(ok, { good: counted, verified: true });
  assert.equal(cln.clnVerified({ sha256: false, signatures: [good], counted }).verified, false);
  const bad = { keyid: "2", fingerprint: null, state: "bad" as const };
  assert.equal(cln.clnVerified({ sha256: true, signatures: [good, bad], counted }).verified, false);
  // Good, but by a key SECURITY.md does not list both times: not counted.
  assert.equal(cln.clnVerified({ sha256: true, signatures: [good], counted: [] }).verified, false);
  const expired = { ...good, state: "expired" as const };
  assert.equal(cln.clnVerified({ sha256: true, signatures: [expired], counted }).verified, false);
  // The real run's status against the real keys.
  const keys = cln.clnReleaseKeys(read("SECURITY.md"));
  const real = cln.clnVerified({
    sha256: true,
    signatures: cln.sumsSignatures(read("gpg-status.txt")),
    counted: keys,
  });
  assert.equal(real.verified, true);
  assert.ok(real.good.some((k) => k.name === "Blockstream CLN Release"));
});

test("minisign signatures check as minisign does, prehashed or not", () => {
  // libsodium 1.0.22's real signature, against the key doc.libsodium.org publishes and the
  // tarball's BLAKE2b-512 (the tarball itself is 2 MB, so the test keeps only its digest).
  const key = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
  const digest = Buffer.from(
    "e96118006f50f56787ea38859362a6f5f4b340d74500fdc011da1cb7d2fcda0eeefd21e121034ca28d19e9a921c073ab650943bdebd43e48c5f53863eb89f4d3",
    "hex",
  );
  const sig = read("libsodium-1.0.22.tar.gz.minisig");
  const real = cln.minisignVerify(key, { blake2b512: digest }, sig, "libsodium-1.0.22.tar.gz");
  assert.equal(real.ok, true, real.reason);
  assert.match(real.trusted, /file:libsodium-1\.0\.22\.tar\.gz/);
  const flipped = Buffer.from(digest);
  flipped[0] = (flipped[0] as number) ^ 1;
  assert.equal(cln.minisignVerify(key, { blake2b512: flipped }, sig).ok, false);
  assert.match(
    cln.minisignVerify(key, { blake2b512: digest }, sig, "libsodium-1.0.21.tar.gz").reason,
    /signed as libsodium-1\.0\.22/,
  );
  const lines = sig.split("\n");
  lines[2] = "trusted comment: timestamp:1775774745\tfile:other.tar.gz\thashed";
  assert.match(
    cln.minisignVerify(key, { blake2b512: digest }, lines.join("\n")).reason,
    /trusted comment/,
  );
  // Another key id, and not a key at all.
  const other = Buffer.from(key, "base64");
  other[3] = (other[3] as number) ^ 1;
  assert.match(
    cln.minisignVerify(other.toString("base64"), { blake2b512: digest }, sig).reason,
    /another key/,
  );
  assert.equal(cln.minisignVerify("not a key", { blake2b512: digest }, sig).ok, false);

  // A signature over the file itself ("Ed"), made here with a fresh key in minisign's format.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const id = Buffer.from("0102030405060708", "hex");
  const pk = Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64");
  const data = Buffer.from("a file\n");
  const s = sign(null, data, privateKey);
  const trusted = "timestamp:1\tfile:a.txt";
  const global = sign(null, Buffer.concat([s, Buffer.from(trusted)]), privateKey);
  const file = [
    "untrusted comment: test",
    Buffer.concat([Buffer.from("Ed"), id, s]).toString("base64"),
    `trusted comment: ${trusted}`,
    global.toString("base64"),
    "",
  ].join("\n");
  assert.equal(cln.minisignVerify(pk, data, file, "a.txt").ok, true);
  assert.equal(cln.minisignVerify(pk, Buffer.from("another file\n"), file).ok, false);
  assert.equal(cln.minisignVerify(pk, { blake2b512: Buffer.alloc(64) }, file).ok, false);
});

test("SQLite's and lowdown's published digests are taken as their pages list them", () => {
  const data = Buffer.from("abc");
  assert.equal(
    cln.digestOf("sha3-256", data),
    "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
  );
  assert.equal(cln.digestOf("sha512", data), createHash("sha512").update(data).digest("hex"));
});

test("every dependency is pinned with a SHA-256 and checked its publisher's way", () => {
  const names = cln.CLN_DEPS.map((d) => d.name);
  assert.deepEqual(names, [
    "m4",
    "autoconf",
    "automake",
    "libtool",
    "gettext",
    "libsodium",
    "sqlite",
    "zlib",
    "lowdown",
  ]);
  for (const d of cln.CLN_DEPS) {
    assert.match(d.sha256, /^[0-9a-f]{64}$/, d.name);
    assert.match(d.url, /^https:\/\//, d.name);
    assert.ok(d.url.includes(d.name === "sqlite" ? "3540100" : d.version), d.name);
    if (d.check.kind === "gpg") assert.match(d.check.fingerprint, /^[0-9A-F]{40}$/);
    // libsodium and zlib install static only; SQLite shared too, loaded from the lab's prefix.
    if (d.name === "libsodium") assert.ok(d.configure("/p").includes("--disable-shared"));
    if (d.name === "zlib") assert.ok(d.configure("/p").includes("--static"));
  }
  const kinds = Object.fromEntries(cln.CLN_DEPS.map((d) => [d.name, d.check.kind]));
  assert.deepEqual(kinds, {
    m4: "gpg",
    autoconf: "gpg",
    automake: "gpg",
    libtool: "gpg",
    gettext: "gpg",
    libsodium: "minisign",
    sqlite: "sha3-256",
    zlib: "gpg",
    lowdown: "sha512",
  });
});

test("the prefix rebuilds only what changed, and from empty when anything installed is stale", () => {
  const p = "/lab/cln-deps/prefix";
  const all = cln.CLN_DEPS;
  const line = (d: (typeof all)[number]) =>
    [d.sha256, d.url.split("/").at(-1), ...d.configure(p), JSON.stringify(d.env ?? {})].join(" ");
  // Nothing built: everything, into an empty prefix.
  assert.deepEqual(cln.depsToBuild(all, p, []), { fresh: true, todo: [...all] });
  // All built: nothing.
  assert.deepEqual(cln.depsToBuild(all, p, all.map(line)), { fresh: false, todo: [] });
  // A dependency added since: only it, beside what is there.
  const without = all.filter((d) => d.name !== "gettext");
  assert.deepEqual(
    cln.depsToBuild(all, p, without.map(line)).todo.map((d) => d.name),
    ["gettext"],
  );
  assert.equal(cln.depsToBuild(all, p, without.map(line)).fresh, false);
  // An archive or a configure changed, or a dependency dropped: all of it again, from empty.
  const changed = all.map(line);
  changed[5] = changed[5]?.replace("--prefix", "--prefix-other") as string;
  assert.deepEqual(cln.depsToBuild(all, p, changed), { fresh: true, todo: [...all] });
  assert.deepEqual(cln.depsToBuild(without, p, all.map(line)).fresh, true);
  // The same prefix elsewhere is another prefix.
  assert.equal(cln.depsToBuild(all, "/elsewhere", all.map(line)).fresh, true);
});

test("the build's compiler is the system's cc with the lab's headers, libraries and run path", () => {
  const p = "/lab/cln-deps/prefix";
  const script = cln.clnCompiler(p);
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(
    script,
    /\nexec cc -I\/lab\/cln-deps\/prefix\/include -L\/lab\/cln-deps\/prefix\/lib -Wl,-rpath,\/lab\/cln-deps\/prefix\/lib "\$@"\n$/,
  );
  assert.deepEqual(cln.clnConfigure("/lab/cln/26.06.10/lab-cc"), [
    "CC=/lab/cln/26.06.10/lab-cc",
    "PYTEST=",
  ]);
  for (const bad of ["/my lab/prefix", "lab/prefix", "/p'x", "/p;rm"]) {
    assert.throws(() => cln.clnCompiler(bad), /cannot go in a compiler line/, bad);
    assert.throws(() => cln.clnConfigure(bad), /cannot go in CC/, bad);
  }
});

test("the build's Python is mako and what uv.lock says it needs, at the lock's versions and hashes", () => {
  const lock = read("uv.lock.excerpt");
  const pkgs = cln.lockedRequirements(lock, ["mako"]);
  assert.deepEqual(
    pkgs.map((p) => `${p.name} ${p.version}`),
    ["mako 1.3.11", "markupsafe 3.0.3"],
  );
  assert.ok(
    pkgs[0]?.hashes.includes("071eb4ab4c5010443152255d77db7faa6ce5916f35226eb02dc34479b6858069"),
  );
  assert.ok((pkgs[1]?.hashes.length ?? 0) > 10);
  const text = cln.requirementsText(pkgs);
  assert.match(text, /^mako==1\.3\.11 --hash=sha256:[0-9a-f]{64}/);
  assert.match(text, /\nmarkupsafe==3\.0\.3 --hash=sha256:/);
  assert.throws(() => cln.lockedRequirements(lock, ["flask"]), /not at all/);
  const twice = `${lock}\n[[package]]\nname = "mako"\nversion = "1.0.0"\n`;
  assert.throws(() => cln.lockedRequirements(twice, ["mako"]), /more than once/);
});

test("the groups take the release's own test programs, and the threat map picks the groups", () => {
  const sources = [
    "channeld/test/run-commit_tx.c",
    "channeld/test/run-full_channel.c",
    "common/test/run-key_derive.c",
    "common/test/run-sphinx.c",
    "common/test/run-onion-test-vector.c",
    "common/test/run-json.c",
    "common/test/run-derive_basepoints.c",
    "gossipd/test/run-txout_failure.c",
    "onchaind/test/run-grind_feerate-bug.c",
    "wallet/test/run-wallet.c",
    "../escape/test/run-x.c",
  ];
  assert.deepEqual(cln.clnPrograms(sources), {
    channels: ["channeld/test/run-commit_tx", "common/test/run-derive_basepoints"],
    htlcs: ["channeld/test/run-full_channel", "onchaind/test/run-grind_feerate-bug"],
    onions: ["common/test/run-onion-test-vector", "common/test/run-sphinx"],
    gossip: ["gossipd/test/run-txout_failure"],
    penalties: ["common/test/run-key_derive", "wallet/test/run-wallet"],
  });
  const threats = [
    { lab: ["cln/penalties", "lnd/sweep"] },
    { lab: ["cln/onions", "cln/penalties", "cln/nope"] },
  ];
  assert.deepEqual(cln.selectClnGroups(threats), {
    groups: ["onions", "penalties"],
    unknown: ["cln/nope"],
  });
  assert.deepEqual(cln.selectClnGroups(threats, ["cln/gossip"]).groups, ["gossip"]);
  // The groups belong to Core Lightning, and Bitcoin Core's run never takes them.
  assert.equal(labTestProject("cln/penalties"), "cln");
  assert.equal(labTestLabel("cln/htlcs"), "Core Lightning htlcs");
  assert.deepEqual(lab.selectTests(threats, new Set(), undefined).run, []);
  assert.deepEqual([...CLN_GROUPS], ["channels", "htlcs", "onions", "gossip", "penalties"]);
});

test("a group's programs run as the Makefile's unittest rule runs them, read back one by one", () => {
  const argv = cln.groupArgv(["common/test/run-key_derive", "wallet/test/run-wallet"]);
  assert.deepEqual(argv.slice(0, 2), ["sh", "-c"]);
  assert.match(argv[2] as string, /BOLTDIR=\.tmp\.lightningrfc "\.\/\$p" > \/dev\/null/);
  assert.deepEqual(argv.slice(3), ["sh", "common/test/run-key_derive", "wallet/test/run-wallet"]);
  const out = read("penalties.log");
  const programs = ["common/test/run-key_derive", "wallet/test/run-wallet"];
  const results = cln.parseGroup(out, programs);
  assert.deepEqual(
    results.map((r) => [r.name, r.exit]),
    programs.map((p) => [p, 0]),
  );
  for (const r of results) assert.ok(r.seconds >= 0);
  // Cut off after the first: the second never finished, which is not a pass.
  const cut = out
    .split("\n")
    .filter((l) => !l.includes("run-wallet exit"))
    .join("\n");
  assert.equal(cln.parseGroup(cut, programs)[1]?.exit, null);
});

test("the build's environment is the lab's alone", () => {
  const env = cln.clnEnv(
    {
      prefix: "/lab/cln-deps/prefix",
      python: "/lab/cln/26.06.10/python",
      home: "/lab/home",
      tmp: "/lab/tmp",
    },
    {
      PATH: "/usr/bin:/bin",
      CFLAGS: "-O0",
      LD_LIBRARY_PATH: "/evil",
      PYTHONPATH: "/evil",
      UV_INDEX_URL: "https://evil.example",
      LANG: "C.UTF-8",
    },
  );
  assert.equal(env.PATH, "/lab/cln/26.06.10/python/bin:/lab/cln-deps/prefix/bin:/usr/bin:/bin");
  assert.equal(env.CPATH, "/lab/cln-deps/prefix/include");
  assert.equal(env.LIBRARY_PATH, "/lab/cln-deps/prefix/lib");
  assert.equal(env.HOME, "/lab/home");
  assert.equal(env.TMPDIR, "/lab/tmp");
  assert.equal(env.LANG, "C.UTF-8");
  for (const k of ["CFLAGS", "LD_LIBRARY_PATH", "PYTHONPATH", "UV_INDEX_URL"])
    assert.equal(env[k], undefined, k);
});

test("a Core Lightning run that passes publishes, and one that fails is held for Core Lightning alone", () => {
  const run = LabRunSchema.parse({
    at: "2026-11-26T02:00:00Z",
    project: "cln",
    version: "26.06.10",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 5, signers: 14 },
    jobs: 6,
    seconds: 40,
    tests: CLN_GROUPS.map((g) => ({ name: `cln/${g}`, ok: true, seconds: 8 })),
  });
  assert.deepEqual(labEmbargo(run), []);
  const line = lab.labLine(run);
  assert.equal(
    line,
    "Lab: Core Lightning 26.06.10 passed all 5 groups of its own unit tests, built from its verified source",
  );
  assert.ok(line.length <= 160 && !DASH.test(line));
  const g = lab.gateRun({ run, missing: [], skipped: [], tail: "" }, { publish: true });
  assert.deepEqual(g, { held: null, published: true });
  const published = JSON.parse(readFileSync(process.env.BLOCKLORE_LAB_FILE as string, "utf8"));
  assert.equal(published.runs[0].project, "cln");

  // A version Core Lightning never tagged, and a test that is not its own.
  assert.throws(() => LabRunSchema.parse({ ...run, version: "0.2.8" }), /not how Core Lightning/);
  assert.throws(
    () =>
      LabRunSchema.parse({ ...run, tests: [{ name: "ldk/chain/package", ok: true, seconds: 1 }] }),
    /not a test of Core Lightning/,
  );
  assert.deepEqual(lab.splitVersions(["cln:26.06.10", "v26.06.10"]).releases, [
    { project: "cln", version: "26.06.10" },
    { project: "bitcoin-core", version: "26.06.10" },
  ]);

  const failed = LabRunSchema.parse({
    ...run,
    verified: { sha256: true, signatures: 0, signers: 14 },
    tests: [{ name: RELEASE_CHECK, ok: false, seconds: 0 }],
  });
  assert.deepEqual(labEmbargo(failed), [
    "no signature over Core Lightning's SHA256SUMS by a key its SECURITY.md lists was good",
    `failed: ${RELEASE_CHECK}`,
  ]);
  const held = lab.gateRun({ run: failed, missing: [], skipped: [], tail: "" }, { publish: true });
  assert.ok(held.held);
  assert.deepEqual(
    held.held.contacts.map((c) => c.project),
    ["Core Lightning"],
  );
  const view = embargoView(listEmbargo()[0] as NonNullable<(typeof held)["held"]>);
  assert.match(view.summary, /Core Lightning 26\.06\.10: failed release-signatures/);
  assert.match(view.summary, /0 good signatures by keys Core Lightning's SECURITY\.md lists/);
});
