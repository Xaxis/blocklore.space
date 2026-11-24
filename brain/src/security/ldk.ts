// LDK in the lab (BACKLOG 40): the second Lightning implementation, after LND. For LDK's newest
// release the lab checks the signed release tag against the maintainers LDK's own SECURITY.md
// lists, builds the `lightning` crate's own tests from the commit that tag names with Rust stable,
// and runs the modules whose tests exercise a defense the threat map lists. Each module is one lab
// test, `ldk/<module>` (its file under lightning/src), in LDK's own run, through the disclosure
// gate like any other.
//
// Verification. LDK publishes no release files of its own: GitHub lists no release assets, so there
// is no checksum file or tarball signature to check. What it does sign is the release tag: v0.2.8
// is an annotated tag by Matt Corallo carrying an OpenPGP signature, made by the signing subkey
// (5499E9A62EF84A647DEC27968D7DC107EE01F294) of his key 07DF3E57A548CCFB7530709189BBB8663E2E65CE,
// which LDK's SECURITY.md lists ("the following keys", for reporting vulnerabilities) with five
// other maintainers'. So the lab:
//   clones the repository at the tag (git checks every object's hash as it arrives);
//   reads SECURITY.md's fingerprints at the tag, and at the release before it, and counts only a
//     key both list, so a release cannot vouch for a key it adds itself;
//   fetches each such key by its fingerprint (SECURITY.md says the keys are on keyservers) from
//     keys.openpgp.org, or keyserver.ubuntu.com when that has none (Jeffrey Czyz's, on
//     2026-11-24), into a keyring of its own, then exports only the key with that fingerprint
//     into the keyring the signature is checked against, as LND's verify-install.sh does, so no
//     keyserver can put another key in its place;
//   checks the tag's signature over the tag object's own bytes, as `git verify-tag` does: good
//     when gpg's status says GOODSIG and VALIDSIG names a counted key as the primary key;
//   checks the tag names itself (`tag v0.2.8`) and points at the commit checked out, with nothing
//     in the working tree changed.
// The release verifies when all of that holds. It is one signature (the tag carries one), so
// `signatures` is 0 or 1 and `signers` the counted keys it was checked against (those a keyserver
// had). What this does not check: that the key is Matt Corallo's beyond SECURITY.md saying so;
// anything about crates.io's `lightning` 0.2.8, which the lab does not use; and the dependencies'
// authors. LDK commits no Cargo.lock, so the crates are resolved from crates.io at the release's
// first run, each `.crate` checked by cargo against the index's SHA-256, and the lockfile kept, so
// every later run of that release builds the same crates (its SHA-256 is in the run's record).
//
// The build. LDK pins no toolchain (no rust-toolchain file). Its CI tests on stable, beta and its
// MSRV 1.63.0, where ci/ci-tests.sh pins a dozen crates by hand to versions 1.63 can build; the lab
// takes Rust stable, as CI's stable leg does, from static.rust-lang.org's channel manifest: rustc,
// cargo and rust-std for this machine, each `.tar.xz` checked against its published `.sha256` and
// the manifest's `xz_hash`, which must agree, unpacked under the lab's own folder. CARGO_HOME, the
// target folder and HOME are all the lab's; nothing goes to ~/.cargo or ~/.rustup. The crates are
// fetched once online (`cargo fetch --locked`); the build and the tests run `--locked --offline`.
// The tests run as CI's `cargo test` does for the crate, one module at a time:
// `cargo test -p lightning --lib --locked --offline -j<jobs> <module>:: -- --test-threads=<jobs>`,
// with RUST_BACKTRACE=1 as ci-tests.sh sets it, under `heavy`.
//
// Which modules, from LDK's source at v0.2.8:
//   ln/monitor_tests      old-state: test_revoked_counterparty_commitment_balances,
//                         test_revoked_counterparty_htlc_tx_balances and
//                         test_revoked_counterparty_aggregated_claims confirm a revoked commitment
//                         and check the ChannelMonitor claims every revoked output and what it
//                         reports as claimable while it does; revoked_output_htlc_resolution_timing
//                         the timing of the justice claims.
//                         pinning: LDK claims outputs its counterparty can also spend apart from
//                         those only it can (chain/package.rs, AggregationCluster: "avoiding
//                         unnecessarily exposing ourselves to pinning attacks"), and an output
//                         becomes pinnable COUNTERPARTY_CLAIMABLE_WITHIN_BLOCKS_PINNABLE (12)
//                         blocks before the counterparty can claim it; these tests check the
//                         revoked commitment is "claimed in two batches based on pinnability",
//                         one justice transaction on the unpinnable to_self output and one on the
//                         pinnable HTLC outputs.
//   ln/functional_tests   old-state: revoked_output_claim, test_justice_tx_htlc_timeout,
//                         test_justice_tx_htlc_success, the
//                         test_static_spendable_outputs_justice_tx_revoked_* tests and
//                         test_bump_penalty_txn_on_revoked_commitment and _htlcs broadcast an old
//                         state and check the justice transactions and their fee bumps;
//                         test_forming_justice_tx_from_monitor_updates builds the justice
//                         transaction a watchtower would from monitor updates alone.
//   chain/package         pinning: test_merge_package_holder_htlc_output_clusters checks pinnable
//                         and unpinnable claims are never merged into one transaction, and
//                         test_package_split_malleable that a claim splits apart again.
//   ln/onion_route_tests  lightning-bugs, as every module here: each module's tests are LDK's own
//                         checks against bugs in that code. test_onion_failure sends payments
//                         whose onions fail in each way the spec lists (a bad realm, a bad HMAC,
//                         an unknown next peer, a bad CLTV) and checks each failure reaches the
//                         sender as the spec says; the test_phantom_* tests do the same for
//                         phantom node payments.
//   Every test named here ran and passed in the lab's first run on v0.2.8.
//
// Not mapped, because no test in the crate exercises the defense:
//   channel-jamming      the crate has no jamming defense to test: its source has no HTLC
//                        endorsement or accountability signal, and its HTLC limits are the
//                        protocol's, which slot jamming fills rather than defends against.
//   replacement-cycling  LDK sees the chain through chain::Listen and chain::Confirm, blocks and
//                        confirmed transactions only, so it can never read a preimage from a
//                        mempool spend; its response to the 2023 cycling disclosures, more frequent
//                        re-broadcasting and fee bumping of claims, is fee bumping in general,
//                        which no test puts under a cycling attack.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  compareVersions,
  type LabTest,
  LDK_MODULES,
  LDK_PREFIX,
  type LdkModule,
  RELEASE_VERSION,
  type Threat,
} from "@blocklore/core";
import { signatureState } from "./lnd.ts";
import { download, extract, parseSums, sha256File } from "./release.ts";
import { step } from "./secp256k1.ts";

export const LDK_REPO = "https://github.com/lightningdevkit/rust-lightning";
/**
 * Where a maintainer's key is fetched by its fingerprint (SECURITY.md: "available on keyservers"),
 * in order, until one has it. Only the key with that fingerprint is ever used, whichever answered.
 */
export function keyUrls(fingerprint: string): string[] {
  if (!/^[0-9A-F]{40}$/.test(fingerprint)) throw new Error(`not a v4 fingerprint: ${fingerprint}`);
  return [
    `https://keys.openpgp.org/vks/v1/by-fingerprint/${fingerprint}`,
    `https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x${fingerprint}`,
  ];
}
const RUST_DIST = "https://static.rust-lang.org/dist";
/** The crate whose tests the lab runs; every module in LDK_MODULES is under its src/. */
const CRATE = "lightning";
const BUILD_LIMIT_S = 60 * 60;
const MODULE_LIMIT_S = 45 * 60;
/** The Rust components a test build needs: the compiler, cargo and the standard library. */
export const RUST_COMPONENTS = ["rustc", "cargo", "rust-std"] as const;
type RustComponent = (typeof RUST_COMPONENTS)[number];

// ---------------------------------------------------------------------------------------------
// Pure pieces (tested in brain/test/ldk.test.ts)

/**
 * LDK's final releases from `git ls-remote --tags`, newest first: v0.2.8, and v0.2 for a line's
 * first release; never an rc or beta, never a peeled `^{}` line.
 */
export function ldkReleases(lsRemote: string): string[] {
  const versions = new Set(
    [...lsRemote.matchAll(/refs\/tags\/v(\d+\.\d+(?:\.\d+)?)$/gm)].map((m) => m[1] as string),
  );
  return [...versions].sort((a, b) => compareVersions(b, a) || b.length - a.length);
}

/** The newest final LDK release, "0.2.8", or null. */
export const newestLdkRelease = (lsRemote: string): string | null =>
  ldkReleases(lsRemote)[0] ?? null;

/** The final release before `version`, whose SECURITY.md the keys must already be listed in. */
export function previousLdkRelease(lsRemote: string, version: string): string | null {
  return ldkReleases(lsRemote).find((v) => compareVersions(v, version) < 0) ?? null;
}

export interface LdkMaintainer {
  fingerprint: string;
  name: string;
}

/**
 * The keys SECURITY.md lists, each as ` * <40 hex digits> (<name>)`, in its order. Each key and
 * each name once; a file that lists none the way the lab reads them is an error, never "no keys".
 */
export function ldkMaintainers(securityMd: string): LdkMaintainer[] {
  const list = [...securityMd.matchAll(/^ \* ([0-9A-F]{40}) \(([^()\n]+)\)\s*$/gm)].map((m) => ({
    fingerprint: m[1] as string,
    name: (m[2] as string).trim(),
  }));
  if (!list.length) throw new Error("SECURITY.md lists no key the way the lab reads them");
  for (const k of ["fingerprint", "name"] as const)
    if (new Set(list.map((s) => s[k])).size !== list.length)
      throw new Error(`SECURITY.md lists a ${k} twice`);
  return list;
}

/** The keys both readings of SECURITY.md list: a key only the release itself adds never counts. */
export function countedMaintainers(
  atTag: readonly LdkMaintainer[],
  before: readonly LdkMaintainer[],
): LdkMaintainer[] {
  const earlier = new Set(before.map((m) => m.fingerprint));
  return atTag.filter((m) => earlier.has(m.fingerprint));
}

export interface SignedTag {
  /** The commit (or other object) the tag names. */
  object: string;
  type: string;
  tag: string;
  tagger: string;
  /** The bytes the signature covers: the tag object up to its signature. */
  payload: Buffer;
  signature: string;
}

const SIG_START = "-----BEGIN PGP SIGNATURE-----";

/**
 * An annotated tag object (`git cat-file tag <tag>`) split as `git verify-tag` splits it: the
 * payload up to the OpenPGP signature, and the signature. A tag with no OpenPGP signature, or with
 * text after it, is an error.
 */
export function splitSignedTag(raw: Buffer): SignedTag {
  const text = raw.toString("utf8");
  const at = text.lastIndexOf(`\n${SIG_START}`);
  if (at < 0) throw new Error("the tag carries no OpenPGP signature");
  const signature = text.slice(at + 1);
  if (
    !/^-----END PGP SIGNATURE-----\s*$/m.test(signature) ||
    !signature.trimEnd().endsWith("-----")
  )
    throw new Error("the tag's signature does not end where an OpenPGP signature ends");
  const header = text.slice(0, text.indexOf("\n\n"));
  const field = (k: string) => new RegExp(`^${k} (.+)$`, "m").exec(header)?.[1] ?? "";
  return {
    object: field("object"),
    type: field("type"),
    tag: field("tag"),
    tagger: field("tagger"),
    payload: raw.subarray(0, Buffer.byteLength(text.slice(0, at + 1), "utf8")),
    signature,
  };
}

/**
 * What gpg's status says of the tag's signature against the counted keys: the maintainer whose key
 * made it (VALIDSIG naming it as the primary key) and its state, as LND's signatures are read
 * (`signatureState`): good, expired (EXPKEYSIG, never counted good here) or bad.
 */
export function tagSigner(
  status: string,
  exit: number | null,
  counted: readonly LdkMaintainer[],
): { state: "good" | "expired" | "bad"; signer: LdkMaintainer | null } {
  for (const m of counted) {
    const state = signatureState(status, m.fingerprint, exit);
    if (state !== "bad") return { state, signer: m };
  }
  return { state: "bad", signer: null };
}

/**
 * Whether a release verifies: the tag names itself and the commit checked out, the working tree
 * is unchanged, and the tag's signature is good by a counted key.
 */
export function ldkVerified(input: {
  version: string;
  tag: Pick<SignedTag, "object" | "type" | "tag">;
  head: string;
  clean: boolean;
  signature: "good" | "expired" | "bad";
}): { checkout: boolean; verified: boolean } {
  const checkout =
    input.tag.tag === `v${input.version}` &&
    input.tag.type === "commit" &&
    /^[0-9a-f]{40}$/.test(input.head) &&
    input.tag.object === input.head &&
    input.clean;
  return { checkout, verified: checkout && input.signature === "good" };
}

/** Rust's name for this machine. */
export function rustTriple(arch = process.arch): string {
  if (arch === "x64") return "x86_64-unknown-linux-gnu";
  if (arch === "arm64") return "aarch64-unknown-linux-gnu";
  throw new Error(`no Rust release for ${arch}`);
}

/**
 * From static.rust-lang.org's channel manifest (channel-rust-stable.toml): the stable version
 * ("1.100.0") and, for each component, its `.tar.xz` file name and the manifest's SHA-256 of it.
 */
export function rustStable(
  toml: string,
  triple = rustTriple(),
): {
  version: string;
  date: string;
  files: Record<RustComponent, { file: string; sha256: string }>;
} {
  const date = /^date = "(\d{4}-\d{2}-\d{2})"$/m.exec(toml)?.[1];
  const version = /^\[pkg\.rustc\]\nversion = "(\d+\.\d+\.\d+) \(/m.exec(toml)?.[1];
  if (!date || !version) throw new Error("the channel manifest names no rustc version");
  const files = {} as Record<RustComponent, { file: string; sha256: string }>;
  for (const c of RUST_COMPONENTS) {
    const head = `[pkg.${c}.target.${triple}]\n`;
    const at = toml.indexOf(head);
    if (at < 0) throw new Error(`the channel manifest has no ${c} for ${triple}`);
    const section = toml.slice(at + head.length).split("\n\n")[0] ?? "";
    const url = /^xz_url = "([^"]+)"$/m.exec(section)?.[1] ?? "";
    const sha256 = /^xz_hash = "([0-9a-f]{64})"$/m.exec(section)?.[1];
    const file = `${c}-${version}-${triple}.tar.xz`;
    if (!sha256 || !/^available = true$/m.test(section) || !url.endsWith(`/${file}`))
      throw new Error(`the channel manifest lists no ${file}`);
    files[c] = { file, sha256 };
  }
  return { version, date, files };
}

/** The threat map's LDK modules (or the owner's list), in the order the lab knows them. */
export function selectLdkModules(
  threats: Pick<Threat, "lab">[],
  override?: string[],
): { modules: LdkModule[]; unknown: string[] } {
  const wanted = new Set<string>();
  const unknown: string[] = [];
  for (const raw of override?.length ? override : threats.flatMap((t) => t.lab)) {
    const t = raw.trim();
    if (!t.startsWith(LDK_PREFIX)) continue;
    const m = t.slice(LDK_PREFIX.length);
    if ((LDK_MODULES as readonly string[]).includes(m)) wanted.add(m);
    else unknown.push(t);
  }
  return { modules: LDK_MODULES.filter((m) => wanted.has(m)), unknown };
}

/**
 * The environment cargo runs in: the toolchain, CARGO_HOME, the target folder, HOME and TMPDIR all
 * the lab's, and nothing from the user's own. Any cargo or Rust setting the base environment
 * carries (RUSTFLAGS, CARGO_HOME, RUSTUP_TOOLCHAIN, a registry token) is dropped.
 */
export function cargoEnv(
  dirs: { rust: string; cargoHome: string; target: string; home: string; tmp: string },
  base: NodeJS.ProcessEnv,
  online: boolean,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(base).filter(([k]) => !k.startsWith("CARGO") && !k.startsWith("RUST")),
    ),
    PATH: `${path.join(dirs.rust, "bin")}:${base.PATH ?? "/usr/bin:/bin"}`,
    HOME: dirs.home,
    XDG_CONFIG_HOME: path.join(dirs.home, ".config"),
    XDG_CACHE_HOME: path.join(dirs.home, ".cache"),
    TMPDIR: dirs.tmp,
    CARGO_HOME: dirs.cargoHome,
    CARGO_TARGET_DIR: dirs.target,
    CARGO_TERM_COLOR: "never",
    CARGO_INCREMENTAL: "0",
    RUST_BACKTRACE: "1",
    // Online only to resolve and fetch the crates; the build and the tests never fetch.
    CARGO_NET_OFFLINE: online ? "false" : "true",
  };
}

/** The test filter of a module: its path in the crate, `ln::monitor_tests::`. */
export const moduleFilter = (m: LdkModule): string => `${m.replaceAll("/", "::")}::`;

/** `cargo test` for one module of the crate, as CI's `cargo test` runs it, offline. */
export function cargoTestArgv(m: LdkModule, jobs: number): string[] {
  return [
    "cargo",
    "test",
    "-p",
    CRATE,
    "--lib",
    "--locked",
    "--offline",
    `-j${jobs}`,
    moduleFilter(m),
    "--",
    `--test-threads=${jobs}`,
  ];
}

export interface LibtestResult {
  /** libtest's own verdict, from its `test result:` line; null when there was none. */
  result: "ok" | "FAILED" | null;
  passed: number;
  failed: number;
  ignored: number;
  /** The test binary's own time, without the build. */
  seconds: number;
  /** Tests that failed, by name. */
  failedNames: string[];
  /** What the failing tests printed, then the end of the output. */
  output: string[];
}

/**
 * One module's result from `cargo test`'s output: libtest's `test result:` line (one test binary,
 * since only --lib runs), each test that FAILED, and what the failures printed. No `test result:`
 * line means the build failed or the run was cut off, which is not a pass.
 */
export function parseLibtest(output: string): LibtestResult {
  const lines = output.split("\n");
  const summary = [
    ...output.matchAll(
      /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; \d+ measured; \d+ filtered out; finished in ([\d.]+)s$/gm,
    ),
  ];
  const failedNames = [
    ...new Set(
      lines
        .map((l) => /^test (\S+) \.\.\. FAILED$/.exec(l)?.[1])
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const last = summary.at(-1);
  const failures = output.indexOf("\nfailures:\n");
  return {
    result: summary.length === 1 && last ? (last[1] as "ok" | "FAILED") : null,
    passed: Number(last?.[2] ?? 0),
    failed: Number(last?.[3] ?? 0),
    ignored: Number(last?.[4] ?? 0),
    seconds: Math.round(Number(last?.[5] ?? 0) * 10) / 10,
    failedNames,
    output: failures >= 0 ? output.slice(failures + 1).split("\n") : lines,
  };
}

// ---------------------------------------------------------------------------------------------
// Verify, build, test

/** What the owner sees of an LDK run, privately. */
export interface LdkRecord {
  tag: string;
  /** The commit checked out, which the tag must name. */
  commit: string | null;
  tagger: string | null;
  /** The release before it, whose SECURITY.md the counted keys are also listed in. */
  previous: { tag: string; maintainers: number } | null;
  maintainers: (LdkMaintainer & {
    counted: boolean;
    /** Where its key came from, or null when the keyserver had none the lab could import. */
    key: string | null;
  })[];
  signature: {
    state: "good" | "expired" | "bad";
    signer: string | null;
    exit: number | null;
    status: string;
  } | null;
  checkout: boolean;
  rust: { version: string; date: string; files: { file: string; sha256: string }[] } | null;
  lock: { sha256: string; packages: number; resolved: string } | null;
  commands: string[];
  build: { exit: number | null; seconds: number; tail: string } | null;
  modules: {
    name: string;
    ok: boolean;
    exit: number | null;
    seconds: number;
    wall: number;
    passed: number;
    failed: string[];
    ignored: number;
    tail: string;
  }[];
}

export interface LdkRun {
  /** The source checked out is the commit the signed tag names. */
  sha256: boolean;
  signatures: number | null;
  signers: number | null;
  verified: boolean;
  tests: LabTest[];
  missing: string[];
  record: LdkRecord;
}

const tailOf = (text: string[] | string, lines: number) =>
  (Array.isArray(text) ? text : text.split("\n")).slice(-lines).join("\n");

const git = (args: string[], cwd?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", timeout: 600_000 });

/** The repository at the tag, fresh, and the release before it's SECURITY.md. */
function checkout(tag: string, previous: string | null, src: string): string | null {
  rmSync(src, { recursive: true, force: true });
  git(["clone", "-q", "--depth", "1", "--branch", tag, LDK_REPO, src]);
  if (!previous) return null;
  git(["fetch", "-q", "--depth", "1", "origin", "tag", previous], src);
  return git(["show", `${previous}:SECURITY.md`], src);
}

/**
 * Each counted maintainer's key from the first keyserver that has it, into a keyring of its own;
 * then only the key with that fingerprint into the keyring the tag is checked against.
 */
async function importKeys(
  counted: readonly LdkMaintainer[],
  gnupg: string,
  dl: string,
): Promise<Map<string, string>> {
  const from = new Map<string, string>();
  const gpg = (args: string[], stdin?: Buffer) =>
    spawnSync("gpg", ["--homedir", gnupg, "--batch", "--no-tty", ...args], {
      input: stdin,
      timeout: 120_000,
    });
  for (const m of counted) {
    for (const [i, url] of keyUrls(m.fingerprint).entries()) {
      const file = path.join(dl, `${m.fingerprint}.${i}.asc`);
      const untrusted = path.join(gnupg, `${m.fingerprint}.${i}.pgp-untrusted`);
      rmSync(file, { force: true });
      rmSync(untrusted, { force: true });
      if (!(await download(url, file, { optional: true }))) continue;
      gpg(["--no-default-keyring", "--keyring", untrusted, "--import", file]);
      const key = gpg([
        "--no-default-keyring",
        "--keyring",
        untrusted,
        "--export",
        m.fingerprint,
      ]).stdout;
      if (key?.length && gpg(["--import"], key).status === 0) {
        from.set(m.fingerprint, url);
        break;
      }
    }
  }
  return from;
}

/** The tag's signature over its own bytes, checked with the counted keys alone. */
function verifyTag(tag: SignedTag, gnupg: string, dir: string) {
  const payload = path.join(dir, "tag.payload");
  const sig = path.join(dir, "tag.sig");
  writeFileSync(payload, tag.payload);
  writeFileSync(sig, tag.signature);
  const v = spawnSync(
    "gpg",
    ["--homedir", gnupg, "--batch", "--no-tty", "--status-fd", "1", "--verify", sig, payload],
    { timeout: 120_000 },
  );
  return { status: v.stdout?.toString("utf8") ?? "", exit: v.status };
}

/**
 * Rust stable from static.rust-lang.org: each component's archive checked against both its
 * `.sha256` and the channel manifest, unpacked into <rustDir>/<version>; reused when intact.
 */
async function toolchain(
  rustDir: string,
  log: (line: string) => void,
): Promise<{
  root: string;
  version: string;
  date: string;
  files: { file: string; sha256: string }[];
}> {
  const dl = path.join(rustDir, "dl");
  mkdirSync(dl, { recursive: true });
  const manifest = path.join(dl, "channel-rust-stable.toml");
  rmSync(manifest, { force: true });
  await download(`${RUST_DIST}/channel-rust-stable.toml`, manifest);
  const stable = rustStable(readFileSync(manifest, "utf8"));
  const files = RUST_COMPONENTS.map((c) => stable.files[c]);
  const root = path.join(rustDir, stable.version);
  const stampFile = path.join(root, ".sha256");
  const stampText = `${files.map((f) => `${f.sha256}  ${f.file}`).join("\n")}\n`;
  if (
    existsSync(path.join(root, "bin", "cargo")) &&
    existsSync(stampFile) &&
    readFileSync(stampFile, "utf8") === stampText
  ) {
    log(`lab: Rust ${stable.version} already unpacked (${files.map((f) => f.file).join(", ")})`);
    return { root, version: stable.version, date: stable.date, files };
  }
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const f of files) {
    const sumsFile = path.join(dl, `${f.file}.sha256`);
    rmSync(sumsFile, { force: true });
    await download(`${RUST_DIST}/${f.file}.sha256`, sumsFile);
    const published = parseSums(readFileSync(sumsFile, "utf8")).get(f.file);
    if (published !== f.sha256)
      throw new Error(`${f.file}: its .sha256 and the channel manifest disagree`);
    const archive = path.join(dl, f.file);
    if (!existsSync(archive) || (await sha256File(archive)) !== f.sha256) {
      log(`lab: downloading ${f.file}`);
      await download(`${RUST_DIST}/${f.file}`, archive);
    }
    const got = await sha256File(archive);
    if (got !== f.sha256) {
      rmSync(archive, { force: true });
      throw new Error(`${f.file} did not match its published SHA-256 (${got})`);
    }
    // Each archive holds one folder with a `components` file naming the folders to install, as its
    // own install.sh reads it; their contents merge into one prefix, as install.sh merges them.
    const top = extract(archive, path.join(rustDir, "x", f.file));
    const names = readFileSync(path.join(top, "components"), "utf8").split("\n").filter(Boolean);
    for (const n of names) {
      if (!/^[a-z0-9_-]+$/.test(n) || !existsSync(path.join(top, n)))
        throw new Error(`${f.file} names a component it does not hold: ${n}`);
      cpSync(path.join(top, n), root, { recursive: true, verbatimSymlinks: true });
    }
    rmSync(path.join(rustDir, "x", f.file), { recursive: true, force: true });
  }
  rmSync(path.join(rustDir, "x"), { recursive: true, force: true });
  rmSync(path.join(root, "manifest.in"), { force: true });
  writeFileSync(stampFile, stampText);
  log(`lab: Rust ${stable.version} unpacked; each archive matched its .sha256 and the manifest`);
  return { root, version: stable.version, date: stable.date, files };
}

/**
 * One LDK release: verify the signed tag, and only then get Rust, resolve and fetch the crates,
 * build the crate's tests and run each module. Throws when the lab itself cannot run (a clone,
 * the keyserver, a download or cargo's fetch failing); what LDK's release does is in what it
 * returns.
 */
export async function runLdk(input: {
  version: string;
  previous: string | null;
  /** <lab>/ldk/<version>: the source, the keys, the lockfile, the target folder, each run. */
  dir: string;
  /** <lab>/rust: the toolchains and CARGO_HOME, shared by every release. */
  rustDir: string;
  home: string;
  modules: readonly LdkModule[];
  jobs: number;
  env: NodeJS.ProcessEnv;
  runId: string;
  log: (line: string) => void;
}): Promise<LdkRun> {
  const { version, dir, log } = input;
  if (!RELEASE_VERSION.ldk.test(version)) throw new Error(`${version} is not an LDK release`);
  const tag = `v${version}`;
  const record: LdkRecord = {
    tag,
    commit: null,
    tagger: null,
    previous: null,
    maintainers: [],
    signature: null,
    checkout: false,
    rust: null,
    lock: null,
    commands: [],
    build: null,
    modules: [],
  };
  mkdirSync(dir, { recursive: true });

  // The source at the tag, and the keys SECURITY.md lists there and at the release before it.
  const src = path.join(dir, "src");
  const before = checkout(tag, input.previous ? `v${input.previous}` : null, src);
  record.commit = git(["rev-parse", "HEAD"], src).trim();
  const atTag = ldkMaintainers(readFileSync(path.join(src, "SECURITY.md"), "utf8"));
  const earlier = before === null ? atTag : ldkMaintainers(before);
  if (input.previous) record.previous = { tag: `v${input.previous}`, maintainers: earlier.length };
  const counted = countedMaintainers(atTag, earlier);
  log(
    `lab: LDK's SECURITY.md at ${tag} (commit ${record.commit}) lists ${atTag.length} keys; ${counted.length} also listed at ${input.previous ? `v${input.previous}` : "no earlier release"}`,
  );

  const gnupg = path.join(dir, "gnupg");
  const keys = path.join(dir, "keys");
  // Each run fetches the keys afresh: nothing an earlier run left is ever read.
  for (const d of [gnupg, keys]) rmSync(d, { recursive: true, force: true });
  mkdirSync(gnupg, { recursive: true, mode: 0o700 });
  mkdirSync(keys, { recursive: true });
  const tagObject = splitSignedTag(execFileSync("git", ["cat-file", "tag", tag], { cwd: src }));
  record.tagger = tagObject.tagger.replace(/\s+\d+ [+-]\d{4}$/, "");
  let v: { status: string; exit: number | null };
  let from: Map<string, string>;
  try {
    from = await importKeys(counted, gnupg, keys);
    v = verifyTag(tagObject, gnupg, dir);
  } finally {
    // The imports start an agent for this folder; it is not left running on the shared machine.
    spawnSync("gpgconf", ["--homedir", gnupg, "--kill", "all"], {
      stdio: "ignore",
      timeout: 30_000,
    });
  }
  record.maintainers = atTag.map((m) => ({
    ...m,
    counted: counted.some((c) => c.fingerprint === m.fingerprint),
    key: from.get(m.fingerprint) ?? null,
  }));
  // The keys the tag was checked against: the counted ones some keyserver had.
  const checked = counted.filter((m) => from.has(m.fingerprint));
  const lacking = counted.filter((m) => !from.has(m.fingerprint)).map((m) => m.name);
  log(
    `lab: ${checked.length} of ${counted.length} counted keys fetched by fingerprint${lacking.length ? `; no keyserver had ${lacking.join(", ")}'s` : ""}`,
  );
  const signer = tagSigner(v.status, v.exit, checked);
  record.signature = {
    state: signer.state,
    signer: signer.signer ? `${signer.signer.name} ${signer.signer.fingerprint}` : null,
    exit: v.exit,
    status: v.status,
  };
  const clean = git(["status", "--porcelain"], src).trim() === "";
  const check = ldkVerified({
    version,
    tag: tagObject,
    head: record.commit,
    clean,
    signature: signer.state,
  });
  record.checkout = check.checkout;
  log(
    `lab: the tag ${check.checkout ? "names the commit checked out" : "DOES NOT name the commit checked out"}; its signature is ${signer.state}${signer.signer ? `, by ${signer.signer.name} (${signer.signer.fingerprint})` : ""}`,
  );
  const out = {
    sha256: check.checkout,
    signatures: signer.state === "good" ? 1 : 0,
    signers: checked.length,
    record,
  };
  if (!check.verified) return { ...out, verified: false, tests: [], missing: [] };

  // Verified: the modules this release has, Rust stable, then the crates, resolved once per release.
  const crateSrc = path.join(src, CRATE, "src");
  const missing = input.modules
    .filter((m) => !existsSync(path.join(crateSrc, `${m}.rs`)))
    .map((m) => `${LDK_PREFIX}${m}`);
  const modules = input.modules.filter((m) => !missing.includes(`${LDK_PREFIX}${m}`));
  if (!modules.length) return { ...out, verified: true, tests: [], missing };

  const rust = await toolchain(input.rustDir, log);
  record.rust = { version: rust.version, date: rust.date, files: rust.files };
  const tmp = path.join(dir, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  for (const d of [tmp, input.home]) mkdirSync(d, { recursive: true });
  const dirs = {
    rust: rust.root,
    cargoHome: path.join(input.rustDir, "cargo-home"),
    target: path.join(dir, "target"),
    home: input.home,
    tmp,
  };
  const cargo = (args: string[], online: boolean) => {
    record.commands.push(["cargo", ...args].join(" "));
    return spawnSync(path.join(rust.root, "bin", "cargo"), args, {
      cwd: src,
      env: cargoEnv(dirs, input.env, online),
      encoding: "utf8",
      timeout: 30 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  };
  const kept = path.join(dir, "Cargo.lock");
  const lockFile = path.join(src, "Cargo.lock");
  let resolved = "kept from this release's first run";
  if (existsSync(kept)) copyFileSync(kept, lockFile);
  else {
    const g = cargo(["generate-lockfile"], true);
    if (g.status !== 0)
      throw new Error(`cargo could not resolve LDK's crates: ${tailOf(g.stderr ?? "", 8)}`);
    copyFileSync(lockFile, kept);
    resolved = `resolved at this run with Rust ${rust.version}`;
  }
  const lockText = readFileSync(lockFile, "utf8");
  record.lock = {
    sha256: await sha256File(lockFile),
    packages: (lockText.match(/^\[\[package\]\]$/gm) ?? []).length,
    resolved,
  };
  const fetched = cargo(["fetch", "--locked"], true);
  if (fetched.status !== 0)
    throw new Error(`cargo could not fetch LDK's crates: ${tailOf(fetched.stderr ?? "", 8)}`);
  log(
    `lab: ${record.lock.packages} crates in Cargo.lock (${resolved}), fetched and checked by cargo`,
  );

  // The crate's test binary once, then each module's tests from it.
  const runs = path.join(dir, "runs");
  mkdirSync(runs, { recursive: true });
  const buildArgv = [
    "cargo",
    "test",
    "-p",
    CRATE,
    "--lib",
    "--locked",
    "--offline",
    `-j${input.jobs}`,
    "--no-run",
  ];
  record.commands.push(buildArgv.join(" "));
  const b = await step(buildArgv, {
    cwd: src,
    log: path.join(runs, `${input.runId}.build.log`),
    limit: BUILD_LIMIT_S,
    env: cargoEnv(dirs, input.env, false),
  });
  record.build = {
    exit: b.exit,
    seconds: b.seconds,
    tail: b.exit === 0 ? "" : tailOf(b.output, 60),
  };
  log(
    `lab: the ${CRATE} crate's tests ${b.exit === 0 ? "built" : `FAILED to build (exit ${b.exit})`} in ${b.seconds} s`,
  );

  const tests: LabTest[] = [];
  for (const m of modules) {
    const argv = cargoTestArgv(m, input.jobs);
    record.commands.push(argv.join(" "));
    const name = `${LDK_PREFIX}${m}`;
    const r =
      b.exit === 0
        ? await step(argv, {
            cwd: src,
            log: path.join(runs, `${input.runId}.${m.replaceAll("/", "_")}.log`),
            limit: MODULE_LIMIT_S,
            env: cargoEnv(dirs, input.env, false),
          })
        : { exit: b.exit, seconds: 0, output: b.output };
    const parsed = parseLibtest(r.output);
    if (r.exit === 0 && parsed.result === "ok" && parsed.passed === 0 && parsed.failed === 0) {
      missing.push(name);
      continue;
    }
    const ok = r.exit === 0 && parsed.result === "ok" && parsed.failed === 0;
    tests.push({ name, ok, seconds: parsed.seconds });
    record.modules.push({
      name,
      ok,
      exit: r.exit,
      seconds: parsed.seconds,
      wall: r.seconds,
      passed: parsed.passed,
      failed: parsed.failedNames,
      ignored: parsed.ignored,
      tail: ok ? "" : tailOf(parsed.output, 60),
    });
    log(
      `lab: ${name} ${ok ? "passed" : `FAILED (exit ${r.exit}${parsed.failedNames.length ? `; ${parsed.failedNames.slice(0, 5).join(", ")}` : ""})`}: ${parsed.passed} tests passed, ${parsed.ignored} ignored, in ${parsed.seconds} s (${r.seconds} s with cargo)`,
    );
  }
  return { ...out, verified: true, tests, missing };
}

/** Removes what a run leaves that the next one does not need: the target folder is kept. */
export function tidyLdk(dir: string): void {
  for (const d of ["tmp", "gnupg"]) rmSync(path.join(dir, d), { recursive: true, force: true });
  for (const f of readdirSync(dir).filter((f) => f.startsWith("tag."))) rmSync(path.join(dir, f));
}
