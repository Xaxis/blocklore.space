// The lab (ARCHITECTURE.md, "The security watch"): weekly, fully local. For the newest point
// release of each major version Bitcoin Core maintains (three: MAINTAINED_MAJORS), one after
// another, it downloads the release, verifies it (SHA256SUMS, and the builders' gpg signatures
// when gpg is installed), then runs that release's own upstream functional tests that replay known
// attack classes (the `lab` tests the threat map names, as far as that release has them) in regtest
// against its binaries, under the machine's shared `heavy` pool at a modest number of jobs. Then it
// builds libsecp256k1's own test programs from the copy that release ships (src/secp256k1, in the
// verified source tarball) with the modules Core's build turns on, and runs them
// (brain/src/security/secp256k1.ts). Then LND's newest release: verified against its signed
// manifest, its own Go unit tests built from its source with the Go its go.mod names, the packages
// the threat map lists run one after another (brain/src/security/lnd.ts). Then LDK's newest
// release: its signed tag checked against the maintainers its SECURITY.md lists, the `lightning`
// crate's own tests built from that commit with Rust stable, the modules the threat map lists run
// one after another (brain/src/security/ldk.ts). Each release is its own run, through the
// disclosure gate on its own.
//
// Nothing touches a live node or service: Core's binaries only ever run inside the upstream test
// framework, in regtest, in temporary data directories, and LND's and LDK's unit tests use mocks
// in temporary folders. A run that fails a test or does not verify is embargoed by the disclosure gate
// (core/src/disclosure.ts): it goes privately to the owner and never reaches knowledge/, the feed
// or the site until the owner releases it.
//
//   var/security/lab/<v>/dl/<file>          the downloads, untrusted until their hashes match
//   var/security/lab/<v>/release/, src/     the verified tarballs, extracted
//   var/security/lab/<v>/build/             bin/ and test/ linked where the test runner looks
//   var/security/lab/<v>/secp256k1/         libsecp256k1's test programs, built and run there
//   var/security/lab/<v>/runs/<time>.json   each run, private: the full output and failure logs
//   var/security/lab/guix.sigs, gnupg/      the builders' keys and an isolated keyring
//   var/security/lab/lnd/<v>/keys/          LND's keys and verify-install.sh at the release tag
//   var/security/lab/lnd/<v>/dl/, src/      LND's manifest, signatures and source; extracted
//   var/security/lab/lnd/<v>/gnupg/         a keyring per maintainer
//   var/security/lab/lnd/<v>/runs/          each run, private, and each package's go test -json
//   var/security/lab/go/                    the Go toolchain, GOPATH and the module and build caches
//   var/security/lab/ldk/<v>/src/           LDK's repository at the release tag, checked out
//   var/security/lab/ldk/<v>/keys/, gnupg/  the maintainers' keys from the keyserver; a keyring
//   var/security/lab/ldk/<v>/Cargo.lock     the crates resolved at the release's first run, kept
//   var/security/lab/ldk/<v>/target/        cargo's build of the crate's tests
//   var/security/lab/ldk/<v>/runs/          each run, private, the build's and each module's output
//   var/security/lab/rust/                  Rust stable's toolchains and CARGO_HOME (the crates)
//   knowledge/security/lab.json             the runs that passed (or the owner released)
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareVersions,
  keepLabRuns,
  LAB_PROJECT_LABEL,
  LAB_PROJECTS,
  Lab,
  type LabProject,
  LabRun,
  type LabTest,
  LDK_PREFIX,
  LND_PREFIX,
  labEmbargo,
  labRelease,
  labReleaseList,
  MAINTAINED_MAJORS,
  RELEASE_CHECK,
  RELEASE_VERSION,
  releaseMajor,
  SECP256K1_PREFIX,
  SECP256K1_PROGRAMS,
  type Secp256k1Program,
  type Threat,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { KNOWLEDGE, ROOT, VAR } from "../env.ts";
import { commitAsOwner } from "../git.ts";
import { type EmbargoItem, hold, onRelease } from "./embargo.ts";
import { logEvent } from "./events.ts";
import {
  LDK_REPO,
  type LdkRecord,
  newestLdkRelease,
  previousLdkRelease,
  runLdk,
  selectLdkModules,
  tidyLdk,
} from "./ldk.ts";
import { LND_REPO, type LndRecord, newestLndRelease, runLnd, selectLndPackages } from "./lnd.ts";
import { download, extract, parseSums, sha256File } from "./release.ts";
import { runSecp256k1, type SecpRecord } from "./secp256k1.ts";

export interface LabOptions {
  /**
   * The releases to test, one after another, each project's by how it tags them ("31.3",
   * "0.21.8-beta", "ldk:0.2.8"); when absent, the newest of each maintained Core major, LND's
   * newest and LDK's newest.
   */
  versions?: string[];
  /** Only these projects' newest releases, when no versions are named. */
  projects?: LabProject[];
  jobs?: number;
  tests?: string[];
  publish: boolean;
  commit: boolean;
  push: boolean;
}

export const LAB_DIR = process.env.BLOCKLORE_LAB_DIR || path.join(VAR, "security", "lab");
/** Where published runs go; tests point it at a temporary file. */
export const LAB_FILE = () =>
  process.env.BLOCKLORE_LAB_FILE || path.join(KNOWLEDGE, "security", "lab.json");
const RELEASES = "https://bitcoincore.org/bin";
const CORE_REPO = "https://github.com/bitcoin/bitcoin";
const GUIX_SIGS = "https://github.com/bitcoin-core/guix.sigs";
const HEAVY = path.join(os.homedir(), ".claude", "claude-core", "bin", "heavy");
const DEFAULT_JOBS = 3;
const RUN_TIMEOUT_MS = 90 * 60_000;

// ---------------------------------------------------------------------------------------------
// Pure pieces (tested in brain/test/lab.test.ts)

/**
 * The releases the lab tests, from `git ls-remote --tags` lines: the newest final release (vX.Y or
 * vX.Y.Z, never an rc) of each of the newest `majors` major versions that have one, newest first.
 * A major with only release candidates is not out yet, so it does not count.
 */
export function maintainedReleases(lsRemote: string, majors = MAINTAINED_MAJORS): string[] {
  const versions = new Set<string>();
  for (const m of lsRemote.matchAll(/refs\/tags\/v(\d+\.\d+(?:\.\d+)?)$/gm))
    versions.add(m[1] as string);
  const newest = new Map<number, string>();
  for (const v of [...versions].sort((a, b) => compareVersions(b, a)))
    if (!newest.has(releaseMajor(v))) newest.set(releaseMajor(v), v);
  return [...newest.values()].slice(0, majors);
}

/** The release tarball's platform triple for this machine. */
export function platformTriple(arch = process.arch, platform = process.platform): string {
  if (platform !== "linux") throw new Error(`the lab runs on Linux, not ${platform}`);
  if (arch === "x64") return "x86_64-linux-gnu";
  if (arch === "arm64") return "aarch64-linux-gnu";
  throw new Error(`no Bitcoin Core release tarball for ${arch}`);
}

/**
 * The tests a Bitcoin Core run takes: the threat map's lab tests (or the owner's list), without the
 * release check, which is the verification itself, without LND's packages and LDK's modules, which
 * their own runs take,
 * and without functional tests this release does not have. libsecp256k1's programs
 * (`secp256k1/tests`) come apart, in the order they run; a program the lab does not know is
 * missing.
 */
export function selectTests(
  threats: Pick<Threat, "lab">[],
  available: ReadonlySet<string>,
  override?: string[],
): { run: string[]; secp256k1: Secp256k1Program[]; missing: string[] } {
  const wanted = new Set<string>();
  const programs = new Set<string>();
  const unknown: string[] = [];
  for (const raw of override?.length ? override : threats.flatMap((t) => t.lab)) {
    const t = raw.trim();
    if (!t || t === RELEASE_CHECK || t.startsWith(LND_PREFIX) || t.startsWith(LDK_PREFIX)) continue;
    if (!t.startsWith(SECP256K1_PREFIX)) wanted.add(t.endsWith(".py") ? t : `${t}.py`);
    else if ((SECP256K1_PROGRAMS as readonly string[]).includes(t.slice(SECP256K1_PREFIX.length)))
      programs.add(t.slice(SECP256K1_PREFIX.length));
    else unknown.push(t);
  }
  const sorted = [...wanted].sort();
  return {
    run: sorted.filter((t) => available.has(t)),
    secp256k1: SECP256K1_PROGRAMS.filter((p) => programs.has(p)),
    missing: [...sorted.filter((t) => !available.has(t)), ...unknown].sort(),
  };
}

/**
 * The test runner's results file (test,status,duration). A script the runner splits into variants
 * ("p2p_ibd_stalling.py --v2transport") counts once: it passes only when every variant passed, and
 * its time is their sum. Skipped scripts are listed apart, not counted as passes. `total` is the
 * runner's own time for the whole run (its ALL row), which leaves out any wait for a slot.
 */
export function parseResults(csv: string): {
  tests: LabTest[];
  skipped: string[];
  total: number | null;
} {
  const byName = new Map<string, LabTest>();
  const skipped = new Set<string>();
  let total: number | null = null;
  for (const line of csv.split("\n").slice(1)) {
    const cells = line.split(",");
    if (cells.length < 3) continue;
    const [raw, status, secs] = cells as [string, string, string];
    if (raw === "ALL") {
      total = Number(secs) || null;
      continue;
    }
    const name = raw.trim().split(/\s+/)[0] as string;
    if (!/^[a-z0-9_]+\.py$/.test(name)) continue;
    if (status === "Skipped") {
      skipped.add(name);
      continue;
    }
    const prev = byName.get(name);
    const seconds = Number(secs) || 0;
    byName.set(name, {
      name,
      ok: (prev?.ok ?? true) && status === "Passed",
      seconds: Math.round(((prev?.seconds ?? 0) + seconds) * 10) / 10,
    });
  }
  const tests = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { tests, skipped: [...skipped].filter((s) => !byName.has(s)).sort(), total };
}

/** TCP ports something on this machine listens on, from /proc/net/tcp and /proc/net/tcp6. */
export function listeningPorts(...tables: string[]): Set<number> {
  const out = new Set<number>();
  for (const table of tables)
    for (const line of table.split("\n").slice(1)) {
      const cells = line.trim().split(/\s+/);
      const port = Number.parseInt(cells[1]?.split(":").at(-1) ?? "", 16);
      if (cells[3] === "0A" && Number.isInteger(port)) out.add(port);
    }
  return out;
}

/**
 * Where Bitcoin Core's test framework starts its ports (TEST_RUNNER_PORT_MIN, 11000 by default):
 * each test's nodes listen 12 ports apart from there for p2p, 5000 higher for RPC and 10000 higher
 * for the proxy. On a shared machine another project can hold one of them: on 2026-11-23 a web
 * server held 11600, so 31.3's 51st test could not start its node, failed, and was held as a
 * finding. The first base from 11000 up, in steps of 1000 and below the kernel's ephemeral ports,
 * whose three windows nothing listens on; the default when every base is taken.
 */
export function portBase(listening: ReadonlySet<number>, tests: number): number {
  // A script the runner splits into variants takes a seed each; two per test leaves room.
  const span = 12 * (2 * tests + 2);
  const taken = (from: number) => [...listening].some((p) => p >= from && p < from + span);
  for (let base = 11000; base + 10000 + span <= 32768; base += 1000)
    if (![0, 5000, 10000].some((off) => taken(base + off))) return base;
  return 11000;
}

/** Good builder signatures in gpg's status output. */
export function goodSignatures(status: string): number {
  return status.split("\n").filter((l) => l.startsWith("[GNUPG:] GOODSIG ")).length;
}

export interface Components {
  wallet: boolean;
  cli: boolean;
  bitcoind: boolean;
  tx: boolean;
  util: boolean;
  chainstate: boolean;
  walletTool: boolean;
  zmq: boolean;
  embeddedAsmap: boolean;
  externalSigner: boolean;
}

/**
 * test/config.ini from the release's config.ini.in, pointing at the release binaries. Releases
 * write a component two ways: 32.0 and later as `ENABLE_ZMQ=@ENABLE_ZMQ_VALUE@`, earlier ones as
 * `@ENABLE_ZMQ_TRUE@ENABLE_ZMQ=true`, where the prefix is empty when the component is built and
 * `#` (the line commented out) when it is not. A `_TRUE` prefix the lab does not know comments
 * its line out, so nothing is claimed that the release may not have.
 */
export function configIni(
  template: string,
  dirs: { src: string; build: string },
  c: Components,
): string {
  const yes = (b: boolean) => (b ? "true" : "false");
  const values: Record<string, string> = {
    CLIENT_NAME: "Bitcoin Core",
    CLIENT_BUGREPORT: "https://github.com/bitcoin/bitcoin/issues",
    abs_top_srcdir: dirs.src,
    abs_top_builddir: dirs.build,
    EXEEXT: "",
    ENABLE_WALLET_VALUE: yes(c.wallet),
    BUILD_BENCH_VALUE: "false",
    BUILD_BITCOIN_CLI_VALUE: yes(c.cli),
    BUILD_BITCOIN_TX_VALUE: yes(c.tx),
    BUILD_BITCOIN_UTIL_VALUE: yes(c.util),
    BUILD_BITCOIN_CHAINSTATE_VALUE: yes(c.chainstate),
    BUILD_BITCOIN_WALLET_VALUE: yes(c.walletTool),
    BUILD_BITCOIND_VALUE: yes(c.bitcoind),
    ENABLE_FUZZ_BINARY_VALUE: "false",
    ENABLE_ZMQ_VALUE: yes(c.zmq),
    ENABLE_EMBEDDED_ASMAP_VALUE: yes(c.embeddedAsmap),
    ENABLE_EXTERNAL_SIGNER_VALUE: yes(c.externalSigner),
    ENABLE_USDT_TRACEPOINTS_VALUE: "false",
    ENABLE_IPC_VALUE: "false",
    BUILD_GUI_VALUE: "false",
  };
  return template.replace(/@([A-Za-z_]+)@/g, (m, k: string) =>
    k.endsWith("_TRUE")
      ? values[`${k.slice(0, -"_TRUE".length)}_VALUE`] === "true"
        ? ""
        : "#"
      : (values[k] ?? m),
  );
}

/** What readers see of a passing run, at most 160 characters, in plain words. */
export function labLine(run: LabRun): string {
  const count = (tests: LabTest[]) => {
    const passed = tests.filter((t) => t.ok).length;
    return passed === tests.length ? `all ${tests.length}` : `${passed} of ${tests.length}`;
  };
  if (run.project === "lnd")
    return `Lab: ${labRelease(run)} passed ${count(run.tests)} of its own unit test packages, built from its verified source`;
  if (run.project === "ldk")
    return `Lab: ${labRelease(run)} passed ${count(run.tests)} of its own test modules, built from its signed release tag`;
  const lib = run.tests.filter((t) => t.name.startsWith(SECP256K1_PREFIX));
  const core = run.tests.filter((t) => !t.name.startsWith(SECP256K1_PREFIX));
  const parts = [
    ...(core.length ? [`${count(core)} tests that replay known attacks, in regtest`] : []),
    ...(lib.length ? [`${count(lib)} of libsecp256k1's own test programs`] : []),
  ];
  return `Lab: ${labRelease(run)} passed ${parts.join(", and ")}`;
}

// ---------------------------------------------------------------------------------------------
// Publishing, behind the disclosure gate

export interface LabRecord {
  run: LabRun;
  /** Scripts or packages this release lacks, and scripts the runner skipped. */
  missing: string[];
  skipped: string[];
  /**
   * The tail of the runner's output, then any libsecp256k1 program or LND package that failed,
   * kept private.
   */
  tail: string;
  /** How libsecp256k1 was built and what each program printed last, when the run had them. */
  secp256k1?: SecpRecord;
  /** An LND run: its signatures one by one, the Go it was built with, each package's output. */
  lnd?: LndRecord;
  /** An LDK run: the tag's signature and the keys, the Rust and crates built with, each module. */
  ldk?: LdkRecord;
}

/**
 * Adds a run to lab.json beside the other releases' runs and their history (`keepLabRuns`: newest
 * first, at most LAB_KEEP of each major of each project) and logs its public event.
 */
export function publishRun(run: LabRun, file = LAB_FILE()): void {
  const parsed = LabRun.parse(run);
  const old = existsSync(file) ? Lab.parse(JSON.parse(readFileSync(file, "utf8"))).runs : [];
  const lab = Lab.parse({ runs: keepLabRuns([parsed, ...old]) });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(lab, null, 1)}\n`);
  logEvent({ at: parsed.at, kind: "lab", text: labLine(parsed), outcome: "ok" });
}

/**
 * The disclosure gate on a finished run: a failure or a release that did not verify is held for
 * the owner and nothing public changes; otherwise the run publishes (when asked to).
 */
export function gateRun(
  rec: LabRecord,
  opts: { publish: boolean; file?: string },
): { held: EmbargoItem | null; published: boolean } {
  const reasons = labEmbargo(rec.run);
  if (reasons.length) {
    const { run } = rec;
    const failed = run.tests
      .filter((t) => !t.ok)
      .map((t) => t.name)
      .sort();
    const lib = failed.some((n) => n.startsWith(SECP256K1_PREFIX));
    const unverified = !run.verified.sha256 || failed.includes(RELEASE_CHECK);
    const item = hold({
      kind: "lab",
      // Bitcoin Core's runs keep the key they always had, so a finding held before is the same one.
      key: `${run.project === "bitcoin-core" ? "" : `${run.project} `}${run.version}\n${failed.join(",")}\n${run.verified.sha256}\n${run.verified.signatures}`,
      title: `Lab: ${labRelease(run)}, ${failed.length} failed${unverified ? ", release did not verify" : ""}`,
      reasons,
      // Bitcoin Core's run goes to its team, and libsecp256k1's too when its tests failed; LND's
      // and LDK's own releases and tests are theirs alone to hear about (their SECURITY.md).
      text: `${labRelease(run)}${lib ? " and the libsecp256k1 it ships" : ""}, own tests: ${failed.join(", ")}`,
      ...(run.project === "bitcoin-core" ? {} : { projects: [LAB_PROJECT_LABEL[run.project]] }),
      detail: rec,
      at: run.at,
    });
    return { held: item, published: false };
  }
  if (!opts.publish) return { held: null, published: false };
  publishRun(rec.run, opts.file);
  return { held: null, published: true };
}

onRelease("lab", async (item) => {
  const run = LabRun.parse((item.detail as LabRecord).run);
  publishRun(run);
  return `released: the run on ${labRelease(run)} is now in knowledge/security/lab.json`;
});

// ---------------------------------------------------------------------------------------------
// Download, verify, extract

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

async function fetchRelease(version: string, triple: string) {
  const base = `${RELEASES}/bitcoin-core-${version}`;
  const dl = path.join(LAB_DIR, version, "dl");
  mkdirSync(dl, { recursive: true });
  const files = {
    sums: "SHA256SUMS",
    asc: "SHA256SUMS.asc",
    bin: `bitcoin-${version}-${triple}.tar.gz`,
    src: `bitcoin-${version}.tar.gz`,
  };
  // The checksum file first: tarballs already on disk are kept only when they still match it.
  for (const f of [files.sums, files.asc])
    if (!existsSync(path.join(dl, f))) await download(`${base}/${f}`, path.join(dl, f));
  const sums = parseSums(readFileSync(path.join(dl, files.sums), "utf8"));
  let sha256 = true;
  for (const f of [files.bin, files.src]) {
    const want = sums.get(f);
    if (!want) throw new Error(`SHA256SUMS for ${version} does not list ${f}`);
    const file = path.join(dl, f);
    if (existsSync(file) && (await sha256File(file)) === want) continue;
    console.log(`lab: downloading ${f}`);
    await download(`${base}/${f}`, file);
    if ((await sha256File(file)) !== want) sha256 = false;
  }
  return { dl, files, sha256 };
}

function hasGpg(): boolean {
  return spawnSync("gpg", ["--version"], { stdio: "ignore" }).status === 0;
}

/** The builders' keys from guix.sigs, in a keyring of the lab's own; then the signatures' check. */
function verifySignatures(dl: string): { signatures: number | null; signers: number | null } {
  if (!hasGpg()) {
    console.log("lab: gpg is not installed; builder signatures not checked");
    return { signatures: null, signers: null };
  }
  const sigs = path.join(LAB_DIR, "guix.sigs");
  const git = (args: string[], cwd?: string) =>
    execFileSync("git", args, { cwd, stdio: "pipe", timeout: 120_000 });
  if (!existsSync(path.join(sigs, ".git"))) {
    git(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", GUIX_SIGS, sigs]);
    git(["sparse-checkout", "set", "builder-keys"], sigs);
  } else {
    git(["fetch", "-q", "--depth", "1", "origin"], sigs);
    git(["reset", "-q", "--hard", "FETCH_HEAD"], sigs);
  }
  const keyDir = path.join(sigs, "builder-keys");
  const keys = readdirSync(keyDir)
    .filter((f) => f.endsWith(".gpg"))
    .map((f) => path.join(keyDir, f));
  const home = path.join(LAB_DIR, "gnupg");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const gpg = (args: string[]) =>
    spawnSync("gpg", ["--homedir", home, "--batch", "--no-tty", ...args], {
      encoding: "utf8",
      timeout: 120_000,
    });
  gpg(["--import", ...keys]);
  const listed = gpg(["--list-keys", "--with-colons"]).stdout ?? "";
  const signers = listed.split("\n").filter((l) => l.startsWith("pub:")).length;
  // gpg exits non-zero when any signature cannot be checked; the count is what matters.
  const v = gpg([
    "--status-fd",
    "1",
    "--verify",
    path.join(dl, "SHA256SUMS.asc"),
    path.join(dl, "SHA256SUMS"),
  ]);
  // The import starts an agent for this keyring; it is not left running on the shared machine.
  spawnSync("gpgconf", ["--homedir", home, "--kill", "all"], { stdio: "ignore", timeout: 30_000 });
  return { signatures: goodSignatures(v.stdout ?? ""), signers };
}

/**
 * What the release was built with, from bitcoind's help text and the binaries present. Each option
 * below is printed only when its feature is compiled in (src/init.cpp); the help wraps lines, so
 * whitespace is folded first.
 */
export function componentsFromHelp(help: string, bins: ReadonlySet<string>): Components {
  const text = help.replace(/\s+/g, " ");
  return {
    wallet: /-wallet=/.test(text),
    cli: bins.has("bitcoin-cli"),
    bitcoind: bins.has("bitcoind"),
    tx: bins.has("bitcoin-tx"),
    util: bins.has("bitcoin-util"),
    chainstate: bins.has("bitcoin-chainstate"),
    walletTool: bins.has("bitcoin-wallet"),
    zmq: /-zmqpubhashblock/.test(text),
    embeddedAsmap: /the embedded mapping data in the binary will be used/.test(text),
    externalSigner: /-signer=/.test(text),
  };
}

/** Runs the release's bitcoind for its help text only (offline, no data directory). */
function components(release: string): Components {
  const bins = new Set(readdirSync(path.join(release, "bin")));
  const help = bins.has("bitcoind")
    ? (spawnSync(path.join(release, "bin", "bitcoind"), ["-help"], {
        encoding: "utf8",
        timeout: 30_000,
        env: { PATH: process.env.PATH ?? "", HOME: path.join(LAB_DIR, "home") },
      }).stdout ?? "")
    : "";
  return componentsFromHelp(help, bins);
}

/** The folder the test runner treats as the build: bin/ from the release, test/ from the source. */
function buildDir(version: string, release: string, src: string): string {
  const build = path.join(LAB_DIR, version, "build");
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  symlinkSync(path.join(release, "bin"), path.join(build, "bin"));
  if (existsSync(path.join(release, "libexec")))
    symlinkSync(path.join(release, "libexec"), path.join(build, "libexec"));
  symlinkSync(path.join(src, "test"), path.join(build, "test"));
  return build;
}

// ---------------------------------------------------------------------------------------------
// Running the tests

/** The ports listening on this machine now (none known off Linux). */
function portsInUse(): Set<number> {
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  return listeningPorts(read("/proc/net/tcp"), read("/proc/net/tcp6"));
}

function runnerEnv(home: string, portMin?: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    LANG: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    ...(portMin === undefined ? {} : { TEST_RUNNER_PORT_MIN: String(portMin) }),
  };
  for (const k of ["PATH", "USER", "LOGNAME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"])
    if (process.env[k]) env[k] = process.env[k];
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("BOX_") && v) env[k] = v;
  return env;
}

function runTests(input: {
  src: string;
  tests: string[];
  jobs: number;
  results: string;
  tmp: string;
  log: string;
  cwd: string;
  portMin: number;
}): Promise<number> {
  const python = "/usr/bin/python3";
  const runner = path.join(input.src, "test", "functional", "test_runner.py");
  const args = [
    runner,
    `--jobs=${input.jobs}`,
    `--resultsfile=${input.results}`,
    `--tmpdirprefix=${input.tmp}`,
    "--combinedlogslen=120",
    ...input.tests,
  ];
  const [cmd, argv] = existsSync(HEAVY) ? [HEAVY, [python, ...args]] : [python, args];
  return new Promise((resolve, reject) => {
    const out = createWriteStream(input.log);
    const child = spawn(cmd, argv, {
      cwd: input.cwd,
      env: runnerEnv(path.join(LAB_DIR, "home"), input.portMin),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), RUN_TIMEOUT_MS);
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end(() => resolve(code ?? 1));
    });
  });
}

const tail = (text: string, lines: number) => text.split("\n").slice(-lines).join("\n");

/** What one release's run came to. */
export interface LabOutcome {
  project: LabProject;
  version: string;
  result: "published" | "held" | "passed" | "error";
  /** Tests passed and run, once the tests ran. */
  passed: number | null;
  run: number | null;
  /** The tests' own time (the runner's), and the whole run's: downloads, checks, a slot's wait. */
  seconds: number | null;
  wall: number;
  note: string;
}

const since = (t: number) => Math.round((Date.now() - t) / 1000);

/** The names a release may be given its project by on the command line: `ldk:0.2.8`. */
const NAMED: Record<string, LabProject> = { core: "bitcoin-core", lnd: "lnd", ldk: "ldk" };

/**
 * The releases named on the command line, by project: Bitcoin Core's as "31.3", LND's as
 * "0.21.8-beta", LDK's as "ldk:0.2.8", since a bare "0.2.8" is how Bitcoin Core tagged its own
 * (a leading v is dropped; "core:" and "lnd:" are taken too); anything else is not a release the
 * lab knows.
 */
export function splitVersions(versions: readonly string[]): {
  releases: { project: LabProject; version: string }[];
  bad: string[];
} {
  const releases: { project: LabProject; version: string }[] = [];
  const bad: string[] = [];
  for (const raw of versions) {
    const m = /^(?:([a-z]+):)?v?(.+)$/.exec(raw.trim());
    const version = m?.[2] ?? "";
    const named = m?.[1] === undefined ? undefined : NAMED[m[1]];
    const project =
      m?.[1] === undefined
        ? LAB_PROJECTS.find((p) => RELEASE_VERSION[p].test(version))
        : named && RELEASE_VERSION[named].test(version)
          ? named
          : undefined;
    if (project) releases.push({ project, version });
    else bad.push(raw);
  }
  return { releases, bad };
}

const lsRemote = (repo: string) =>
  execFileSync("git", ["ls-remote", "--tags", repo], { encoding: "utf8", timeout: 60_000 });

/**
 * The lab: each release in turn (the newest of each maintained Core major, then LND's newest, then
 * LDK's, unless the owner names them or one project), then one commit of what published. A release that
 * cannot run (a download that fails, a runner that reports nothing) does not stop the others; the
 * lab fails at the end, naming it.
 */
export async function lab(opts: LabOptions): Promise<number> {
  const triple = platformTriple();
  const projects = opts.projects?.length ? opts.projects : LAB_PROJECTS;
  const named = splitVersions(opts.versions ?? []);
  const releases = opts.versions?.length
    ? named.releases
    : [
        ...(projects.includes("bitcoin-core")
          ? maintainedReleases(lsRemote(CORE_REPO)).map((version) => ({
              project: "bitcoin-core" as const,
              version,
            }))
          : []),
        ...(projects.includes("lnd")
          ? [newestLndRelease(lsRemote(LND_REPO))]
              .filter((v): v is string => v !== null)
              .map((version) => ({ project: "lnd" as const, version }))
          : []),
        ...(projects.includes("ldk")
          ? [newestLdkRelease(lsRemote(LDK_REPO))]
              .filter((v): v is string => v !== null)
              .map((version) => ({ project: "ldk" as const, version }))
          : []),
      ];
  if (!releases.length || named.bad.length)
    throw new Error(`no release to test (${named.bad.join(", ") || "none found"})`);
  const jobs = Math.max(1, Math.min(opts.jobs ?? DEFAULT_JOBS, 6));
  console.log(`lab: ${labReleaseList(releases)} (${triple}), one after another, ${jobs} jobs each`);
  const outcomes: LabOutcome[] = [];
  for (const { project, version } of releases) {
    const started = Date.now();
    try {
      outcomes.push(
        project === "lnd"
          ? await labLndRelease(version, triple, jobs, opts, started)
          : project === "ldk"
            ? await labLdkRelease(version, triple, jobs, opts, started)
            : await labCoreRelease(version, triple, jobs, opts, started),
      );
    } catch (e) {
      const note = (e as Error).message;
      console.log(`lab: ${labRelease({ project, version })} could not run: ${note}`);
      outcomes.push({
        project,
        version,
        result: "error",
        passed: null,
        run: null,
        seconds: null,
        wall: since(started),
        note,
      });
    }
  }
  for (const o of outcomes)
    console.log(
      `lab: ${labRelease(o)} ${o.result}${o.run === null ? "" : `, ${o.passed} of ${o.run} passed`}; tests ${o.seconds ?? "none"} s, whole run ${o.wall} s`,
    );

  const published = outcomes.filter((o) => o.result === "published");
  if (published.length) {
    console.log(`lab: published to ${path.relative(ROOT, LAB_FILE())}`);
    if (opts.commit) {
      const one = published.length === 1;
      const committed = commitAsOwner(
        [path.relative(ROOT, LAB_FILE())],
        `Publish the lab's ${one ? "run" : "runs"} on ${labReleaseList(published)}, so readers on ${one ? "that release" : "each"} can see it still passes its own tests of the attacks and defenses the threat map lists.`,
        opts.push,
      );
      if (!committed) console.log("lab: nothing to commit");
    }
  }
  const failed = outcomes.filter((o) => o.result === "error");
  if (failed.length)
    throw new Error(
      `the lab could not run ${failed.map((o) => `${labRelease(o)} (${o.note})`).join("; ")}`,
    );
  return 0;
}

/**
 * LND's release: verified against its signed manifest before anything is extracted, then its own
 * unit tests of the packages the threat map lists (lnd.ts), then the disclosure gate.
 */
async function labLndRelease(
  version: string,
  triple: string,
  jobs: number,
  opts: LabOptions,
  started: number,
): Promise<LabOutcome> {
  const at = stamp();
  const project = "lnd" as const;
  console.log(`lab: ${labRelease({ project, version })}`);
  const dir = path.join(LAB_DIR, "lnd", version);
  const runsDir = path.join(dir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const runId = at.replace(/[:]/g, "");
  const chosen = selectLndPackages(loadStore().store.security?.threats ?? [], opts.tests);
  if (chosen.unknown.length)
    console.log(`lab: not LND packages the lab knows, left out: ${chosen.unknown.join(", ")}`);
  if (!chosen.packages.length) throw new Error("no LND package to test");
  const r = await runLnd({
    version,
    dir,
    goDir: path.join(LAB_DIR, "go"),
    home: path.join(LAB_DIR, "home"),
    packages: chosen.packages,
    // One package at a time; each builds with this many jobs and runs its own tests in parallel.
    jobs,
    env: runnerEnv(path.join(LAB_DIR, "home")),
    runId,
    log: (line) => console.log(line),
  });
  const verified = { sha256: r.sha256, signatures: r.signatures, signers: r.signers };
  if (r.missing.length)
    console.log(`lab: not in LND ${version}, left out: ${r.missing.join(", ")}`);
  const tests = r.verified ? r.tests : [{ name: RELEASE_CHECK, ok: false, seconds: 0 }];
  if (!tests.length) throw new Error(`no LND package the lab knows has tests in ${version}`);
  const run = LabRun.parse({
    at,
    project,
    version,
    platform: triple,
    verified,
    jobs,
    seconds: Math.round(tests.reduce((sum, t) => sum + t.seconds, 0) * 10) / 10,
    tests: [...tests].sort((a, b) => a.name.localeCompare(b.name)),
  });
  const rec: LabRecord = {
    run,
    missing: [...chosen.unknown, ...r.missing],
    skipped: [],
    tail: r.record.packages
      .filter((p) => !p.ok)
      .map((p) => `${p.name} (exit ${p.exit ?? "none"}):\n${p.tail}`)
      .join("\n"),
    lnd: r.record,
  };
  writeFileSync(path.join(runsDir, `${runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  const passed = run.tests.filter((t) => t.ok).length;
  if (r.verified) console.log(`lab: ${passed} of ${run.tests.length} passed in ${run.seconds} s`);
  else console.log("lab: the release did not verify; nothing was extracted or built");
  const g = gateRun(rec, { publish: opts.publish });
  const outcome = {
    project,
    version,
    passed: r.verified ? passed : null,
    run: r.verified ? run.tests.length : null,
    seconds: r.verified ? run.seconds : null,
    wall: since(started),
  };
  if (g.held) {
    console.log(
      `lab: embargoed for the owner (${g.held.id}): ${g.held.reasons.join("; ")}. Nothing public changed. See pnpm brain embargo show ${g.held.id}`,
    );
    return { ...outcome, result: "held", note: g.held.id };
  }
  if (!g.published) console.log("lab: passed; not published (--no-publish)");
  return { ...outcome, result: g.published ? "published" : "passed", note: "" };
}

/**
 * LDK's release: its signed tag checked against the maintainers its SECURITY.md lists before
 * anything is built, then the `lightning` crate's own tests of the modules the threat map lists
 * (ldk.ts), then the disclosure gate.
 */
async function labLdkRelease(
  version: string,
  triple: string,
  jobs: number,
  opts: LabOptions,
  started: number,
): Promise<LabOutcome> {
  const at = stamp();
  const project = "ldk" as const;
  console.log(`lab: ${labRelease({ project, version })}`);
  const dir = path.join(LAB_DIR, "ldk", version);
  const runsDir = path.join(dir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const runId = at.replace(/[:]/g, "");
  const chosen = selectLdkModules(loadStore().store.security?.threats ?? [], opts.tests);
  if (chosen.unknown.length)
    console.log(`lab: not LDK modules the lab knows, left out: ${chosen.unknown.join(", ")}`);
  if (!chosen.modules.length) throw new Error("no LDK module to test");
  const r = await runLdk({
    version,
    previous: previousLdkRelease(lsRemote(LDK_REPO), version),
    dir,
    rustDir: path.join(LAB_DIR, "rust"),
    home: path.join(LAB_DIR, "home"),
    modules: chosen.modules,
    // One module at a time; the build and each module's tests use this many jobs.
    jobs,
    env: runnerEnv(path.join(LAB_DIR, "home")),
    runId,
    log: (line) => console.log(line),
  });
  tidyLdk(dir);
  const verified = { sha256: r.sha256, signatures: r.signatures, signers: r.signers };
  if (r.missing.length)
    console.log(`lab: not in LDK ${version}, left out: ${r.missing.join(", ")}`);
  const tests = r.verified ? r.tests : [{ name: RELEASE_CHECK, ok: false, seconds: 0 }];
  if (!tests.length) throw new Error(`no LDK module the lab knows has tests in ${version}`);
  const run = LabRun.parse({
    at,
    project,
    version,
    platform: triple,
    verified,
    jobs,
    seconds: Math.round(tests.reduce((sum, t) => sum + t.seconds, 0) * 10) / 10,
    tests: [...tests].sort((a, b) => a.name.localeCompare(b.name)),
  });
  const rec: LabRecord = {
    run,
    missing: [...chosen.unknown, ...r.missing],
    skipped: [],
    tail: [
      ...(r.record.build && r.record.build.exit !== 0
        ? [`build (exit ${r.record.build.exit ?? "none"}):\n${r.record.build.tail}`]
        : []),
      ...r.record.modules
        .filter((m) => !m.ok)
        .map((m) => `${m.name} (exit ${m.exit ?? "none"}):\n${m.tail}`),
    ].join("\n"),
    ldk: r.record,
  };
  writeFileSync(path.join(runsDir, `${runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  const passed = run.tests.filter((t) => t.ok).length;
  if (r.verified) console.log(`lab: ${passed} of ${run.tests.length} passed in ${run.seconds} s`);
  else console.log("lab: the release did not verify; nothing was built");
  const g = gateRun(rec, { publish: opts.publish });
  const outcome = {
    project,
    version,
    passed: r.verified ? passed : null,
    run: r.verified ? run.tests.length : null,
    seconds: r.verified ? run.seconds : null,
    wall: since(started),
  };
  if (g.held) {
    console.log(
      `lab: embargoed for the owner (${g.held.id}): ${g.held.reasons.join("; ")}. Nothing public changed. See pnpm brain embargo show ${g.held.id}`,
    );
    return { ...outcome, result: "held", note: g.held.id };
  }
  if (!g.published) console.log("lab: passed; not published (--no-publish)");
  return { ...outcome, result: g.published ? "published" : "passed", note: "" };
}

/** One release: download, verify, extract, test, then the disclosure gate decides what is public. */
async function labCoreRelease(
  version: string,
  triple: string,
  jobs: number,
  opts: LabOptions,
  started: number,
): Promise<LabOutcome> {
  const at = stamp();
  console.log(`lab: Bitcoin Core ${version}`);
  const { dl, files, sha256 } = await fetchRelease(version, triple);
  const signed = verifySignatures(dl);
  console.log(
    `lab: SHA256SUMS ${sha256 ? "matched" : "DID NOT MATCH"}; ${signed.signatures ?? "no"} good builder signatures of ${signed.signers ?? "unknown"} known keys`,
  );
  const verified = { sha256, ...signed };
  const dir = path.join(LAB_DIR, version);
  const runsDir = path.join(dir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const runId = at.replace(/[:]/g, "");

  if (!sha256) {
    // Never extract or run what did not verify: hold the bare verification for the owner.
    const rec: LabRecord = {
      run: LabRun.parse({
        at,
        project: "bitcoin-core",
        version,
        platform: triple,
        verified,
        jobs,
        seconds: since(started),
        tests: [{ name: RELEASE_CHECK, ok: false, seconds: 0 }],
      }),
      missing: [],
      skipped: [],
      tail: "",
    };
    writeFileSync(path.join(runsDir, `${runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
    const g = gateRun(rec, { publish: opts.publish });
    console.log(`lab: the release did not verify; held privately for the owner (${g.held?.id})`);
    return {
      project: "bitcoin-core",
      version,
      result: "held",
      passed: null,
      run: null,
      seconds: null,
      wall: since(started),
      note: `did not verify (${g.held?.id})`,
    };
  }

  const release = extract(path.join(dl, files.bin), path.join(dir, "release"));
  const src = extract(path.join(dl, files.src), path.join(dir, "src"));
  const comp = components(release);
  writeFileSync(
    path.join(src, "test", "config.ini"),
    configIni(
      readFileSync(path.join(src, "test", "config.ini.in"), "utf8"),
      { src, build: path.join(dir, "build") },
      comp,
    ),
  );
  buildDir(version, release, src);

  const available = new Set(
    readdirSync(path.join(src, "test", "functional")).filter((f) => /^[a-z0-9_]+\.py$/.test(f)),
  );
  const threats = loadStore().store.security?.threats ?? [];
  const chosen = selectTests(threats, available, opts.tests);
  const { run: tests, secp256k1: programs } = chosen;
  if (chosen.missing.length)
    console.log(`lab: not in Bitcoin Core ${version}, left out: ${chosen.missing.join(", ")}`);
  if (!tests.length && !programs.length) throw new Error("no lab tests to run");
  mkdirSync(path.join(LAB_DIR, "home"), { recursive: true });

  // Bitcoin Core's own functional tests, in regtest against the release's binaries.
  const log = path.join(runsDir, `${runId}.log`);
  let code: number | null = null;
  let parsed: ReturnType<typeof parseResults> = { tests: [], skipped: [], total: null };
  let functional: LabTest[] = [];
  let seconds = 0;
  if (tests.length) {
    console.log(`lab: running ${tests.length} functional tests in regtest`);
    const tmp = path.join(dir, "tmp");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const work = path.join(dir, "work");
    mkdirSync(work, { recursive: true });
    const results = path.join(runsDir, `${runId}.csv`);
    const portMin = portBase(portsInUse(), tests.length);
    console.log(`lab: test ports from ${portMin}`);
    code = await runTests({ src, tests, jobs, results, tmp, log, cwd: work, portMin });
    if (existsSync(results)) parsed = parseResults(readFileSync(results, "utf8"));
    // A test the runner never reported (killed, crashed, timed out) counts as failed.
    const reported = new Set([...parsed.tests.map((t) => t.name), ...parsed.skipped]);
    const lost = tests
      .filter((t) => !reported.has(t))
      .map((name) => ({ name, ok: false, seconds: 0 }));
    functional = [...parsed.tests, ...lost];
    // The tests' own time; the wall clock would count the wait for a slot on the shared machine.
    seconds = parsed.total ?? since(started);
  }
  const output = existsSync(log) ? readFileSync(log, "utf8") : "";

  // libsecp256k1's own test programs, built from the copy this release ships.
  const secp = programs.length
    ? await runSecp256k1({
        src,
        dir: path.join(dir, "secp256k1"),
        programs,
        env: runnerEnv(path.join(LAB_DIR, "home")),
        log: (line) => console.log(line),
      })
    : null;
  if (secp?.missing.length)
    console.log(`lab: not in Bitcoin Core ${version}, left out: ${secp.missing.join(", ")}`);
  const library = secp?.tests ?? [];
  const run = LabRun.parse({
    at,
    project: "bitcoin-core",
    version,
    platform: triple,
    verified,
    jobs,
    // Each program's own time, after its slot: the build is not a test.
    seconds: Math.round((seconds + library.reduce((sum, t) => sum + t.seconds, 0)) * 10) / 10,
    tests: [...functional, ...library].sort((a, b) => a.name.localeCompare(b.name)),
  });
  // The owner sees a failed program's last words, and a build that failed, after the runner's.
  const libraryTail = [
    ...(secp?.record.error ? [`libsecp256k1 build: ${secp.record.error}`] : []),
    ...(secp?.record.programs ?? [])
      .filter((p) => !p.ok)
      .map((p) => `${p.name} (exit ${p.exit ?? "none"}):\n${p.tail}`),
  ];
  const rec: LabRecord = {
    run,
    missing: [...chosen.missing, ...(secp?.missing ?? [])],
    skipped: parsed.skipped,
    tail: [tail(output, 400), ...libraryTail].filter(Boolean).join("\n"),
    ...(secp ? { secp256k1: secp.record } : {}),
  };
  writeFileSync(path.join(runsDir, `${runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  const passed = run.tests.filter((t) => t.ok).length;
  console.log(
    `lab: ${passed} of ${run.tests.length} passed in ${run.seconds} s${code === null ? "" : ` (runner exit ${code})`}${parsed.skipped.length ? `; skipped: ${parsed.skipped.join(", ")}` : ""}`,
  );

  const g = gateRun(rec, { publish: opts.publish });
  const outcome = {
    project: "bitcoin-core" as const,
    version,
    passed,
    run: run.tests.length,
    seconds: run.seconds,
    wall: since(started),
  };
  if (g.held) {
    console.log(
      `lab: embargoed for the owner (${g.held.id}): ${g.held.reasons.join("; ")}. Nothing public changed. See pnpm brain embargo show ${g.held.id}`,
    );
    return { ...outcome, result: "held", note: g.held.id };
  }
  if (!g.published) console.log("lab: passed; not published (--no-publish)");
  return { ...outcome, result: g.published ? "published" : "passed", note: "" };
}
