// The lab (ARCHITECTURE.md, "The security watch"): weekly, fully local. It downloads the latest
// Bitcoin Core release, verifies it (SHA256SUMS, and the builders' gpg signatures when gpg is
// installed), then runs Bitcoin Core's own upstream functional tests that replay known attack
// classes (the `lab` tests the threat map names) in regtest against the release binaries, under the
// machine's shared `heavy` pool at a modest number of jobs.
//
// Nothing touches a live node or service: the binaries only ever run inside the upstream test
// framework, in regtest, in temporary data directories. A run that fails a test or does not verify
// is embargoed by the disclosure gate (core/src/disclosure.ts): it goes privately to the owner and
// never reaches knowledge/, the feed or the site until the owner releases it.
//
//   var/security/lab/<v>/dl/<file>          the downloads, untrusted until their hashes match
//   var/security/lab/<v>/release/, src/     the verified tarballs, extracted
//   var/security/lab/<v>/build/             bin/ and test/ linked where the test runner looks
//   var/security/lab/<v>/runs/<time>.json   each run, private: the full output and failure logs
//   var/security/lab/guix.sigs, gnupg/      the builders' keys and an isolated keyring
//   knowledge/security/lab.json             the runs that passed (or the owner released)
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  LAB_KEEP,
  Lab,
  LabRun,
  type LabTest,
  labEmbargo,
  RELEASE_CHECK,
  type Threat,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { KNOWLEDGE, ROOT, USER_AGENT, VAR } from "../env.ts";
import { commitAsOwner } from "../git.ts";
import { type EmbargoItem, hold, onRelease } from "./embargo.ts";
import { logEvent } from "./events.ts";

export interface LabOptions {
  version?: string;
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

/** The newest final release among `git ls-remote --tags` lines: vX.Y or vX.Y.Z, never an rc. */
export function latestRelease(lsRemote: string): string | null {
  const versions = new Set<string>();
  for (const m of lsRemote.matchAll(/refs\/tags\/v(\d+\.\d+(?:\.\d+)?)$/gm))
    versions.add(m[1] as string);
  const key = (v: string) => v.split(".").map(Number);
  return (
    [...versions]
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        for (let i = 0; i < 3; i++)
          if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
        return 0;
      })
      .at(-1) ?? null
  );
}

/** SHA256SUMS as file name to hex digest. */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) out.set(m[2] as string, m[1] as string);
  }
  return out;
}

/** The release tarball's platform triple for this machine. */
export function platformTriple(arch = process.arch, platform = process.platform): string {
  if (platform !== "linux") throw new Error(`the lab runs on Linux, not ${platform}`);
  if (arch === "x64") return "x86_64-linux-gnu";
  if (arch === "arm64") return "aarch64-linux-gnu";
  throw new Error(`no Bitcoin Core release tarball for ${arch}`);
}

/**
 * The tests a run takes: the threat map's lab tests (or the owner's list), without the release
 * check, which is the verification itself, and without tests this release does not have.
 */
export function selectTests(
  threats: Pick<Threat, "lab">[],
  available: ReadonlySet<string>,
  override?: string[],
): { run: string[]; missing: string[] } {
  const wanted = new Set(
    (override?.length ? override : threats.flatMap((t) => t.lab))
      .map((t) => t.trim())
      .filter((t) => t && t !== RELEASE_CHECK)
      .map((t) => (t.endsWith(".py") ? t : `${t}.py`)),
  );
  const sorted = [...wanted].sort();
  return {
    run: sorted.filter((t) => available.has(t)),
    missing: sorted.filter((t) => !available.has(t)),
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

/** Good builder signatures in gpg's status output. */
export function goodSignatures(status: string): number {
  return status.split("\n").filter((l) => l.startsWith("[GNUPG:] GOODSIG ")).length;
}

/** Tar entry names that could write outside the folder they are extracted into. */
export function unsafeEntries(names: string[]): string[] {
  return names.filter(
    (n) => n.startsWith("/") || n.split("/").includes("..") || /^[A-Za-z]:/.test(n),
  );
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

/** test/config.ini from the release's config.ini.in, pointing at the release binaries. */
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
  return template.replace(/@([A-Za-z_]+)@/g, (m, k: string) => values[k] ?? m);
}

/** What readers see of a passing run, at most 160 characters, in plain words. */
export function labLine(run: LabRun): string {
  const passed = run.tests.filter((t) => t.ok).length;
  const all = passed === run.tests.length;
  return all
    ? `Lab: Bitcoin Core ${run.version} passed all ${run.tests.length} tests that replay known attacks, in regtest`
    : `Lab: Bitcoin Core ${run.version} passed ${passed} of ${run.tests.length} tests that replay known attacks, in regtest`;
}

// ---------------------------------------------------------------------------------------------
// Publishing, behind the disclosure gate

export interface LabRecord {
  run: LabRun;
  /** Scripts this release lacks, and scripts the runner skipped. */
  missing: string[];
  skipped: string[];
  /** The tail of the runner's output, kept private. */
  tail: string;
}

/** Prepends a run to lab.json (newest first, at most LAB_KEEP) and logs its public event. */
export function publishRun(run: LabRun, file = LAB_FILE()): void {
  const parsed = LabRun.parse(run);
  const old = existsSync(file) ? Lab.parse(JSON.parse(readFileSync(file, "utf8"))).runs : [];
  const runs = [parsed, ...old.filter((r) => r.at !== parsed.at)].slice(0, LAB_KEEP);
  const lab = Lab.parse({ runs });
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
    const failed = rec.run.tests
      .filter((t) => !t.ok)
      .map((t) => t.name)
      .sort();
    const item = hold({
      kind: "lab",
      key: `${rec.run.version}\n${failed.join(",")}\n${rec.run.verified.sha256}\n${rec.run.verified.signatures}`,
      title: `Lab: Bitcoin Core ${rec.run.version}, ${failed.length} failed${rec.run.verified.sha256 ? "" : ", release did not verify"}`,
      reasons,
      text: `Bitcoin Core ${rec.run.version} functional tests in regtest: ${failed.join(", ")}`,
      detail: rec,
      at: rec.run.at,
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
  return `released: the run on Bitcoin Core ${run.version} is now in knowledge/security/lab.json`;
});

// ---------------------------------------------------------------------------------------------
// Download, verify, extract

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** Streams one file to disk under a temporary name, renamed only when complete. */
async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const part = `${dest}.part`;
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    createWriteStream(part),
  );
  renameSync(part, dest);
}

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
  return { signatures: goodSignatures(v.stdout ?? ""), signers };
}

/** Every symlink under a folder must resolve inside it. */
function linksStayInside(dir: string): boolean {
  const root = realpathSync(dir);
  const walk = (d: string): boolean => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        const target = path.resolve(path.dirname(p), readlinkSync(p));
        if (!target.startsWith(`${root}${path.sep}`) && target !== root) return false;
      } else if (e.isDirectory() && !walk(p)) return false;
    }
    return true;
  };
  return walk(root);
}

/** Extracts a verified tarball into a fresh folder and returns its single top directory. */
function extract(tarball: string, dest: string): string {
  const names = execFileSync("tar", ["-tzf", tarball], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const bad = unsafeEntries(names);
  if (bad.length)
    throw new Error(`${path.basename(tarball)} has unsafe entries: ${bad.slice(0, 3)}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", dest, "--no-same-owner"], { stdio: "pipe" });
  if (!linksStayInside(dest)) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`${path.basename(tarball)} has links that leave its folder`);
  }
  const tops = readdirSync(dest);
  if (tops.length !== 1) throw new Error(`${path.basename(tarball)} does not hold one folder`);
  return path.join(dest, tops[0] as string);
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

function runnerEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1" };
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
      env: runnerEnv(path.join(LAB_DIR, "home")),
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

/** One lab run: download, verify, extract, test, then the disclosure gate decides what is public. */
export async function lab(opts: LabOptions): Promise<number> {
  const triple = platformTriple();
  const version =
    opts.version ??
    latestRelease(
      execFileSync("git", ["ls-remote", "--tags", CORE_REPO], {
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
  if (!version || !/^\d+\.\d+(\.\d+)?$/.test(version))
    throw new Error(`no Bitcoin Core release to test (${version})`);
  const jobs = Math.max(1, Math.min(opts.jobs ?? DEFAULT_JOBS, 6));
  const started = Date.now();
  const at = stamp();
  console.log(`lab: Bitcoin Core ${version} (${triple}), ${jobs} jobs`);

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
        version,
        platform: triple,
        verified,
        jobs,
        seconds: Math.round((Date.now() - started) / 1000),
        tests: [{ name: RELEASE_CHECK, ok: false, seconds: 0 }],
      }),
      missing: [],
      skipped: [],
      tail: "",
    };
    writeFileSync(path.join(runsDir, `${runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
    const g = gateRun(rec, { publish: opts.publish });
    console.log(`lab: the release did not verify; held privately for the owner (${g.held?.id})`);
    return 0;
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
  const { run: tests, missing } = selectTests(threats, available, opts.tests);
  if (missing.length)
    console.log(`lab: not in Bitcoin Core ${version}, left out: ${missing.join(", ")}`);
  if (!tests.length) throw new Error("no lab tests to run");
  console.log(`lab: running ${tests.length} functional tests in regtest`);

  const tmp = path.join(dir, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(path.join(LAB_DIR, "home"), { recursive: true });
  const work = path.join(dir, "work");
  mkdirSync(work, { recursive: true });
  const results = path.join(runsDir, `${runId}.csv`);
  const log = path.join(runsDir, `${runId}.log`);
  const code = await runTests({ src, tests, jobs, results, tmp, log, cwd: work });
  const output = existsSync(log) ? readFileSync(log, "utf8") : "";
  const parsed = existsSync(results)
    ? parseResults(readFileSync(results, "utf8"))
    : { tests: [], skipped: [], total: null };
  // A test the runner never reported (killed, crashed, timed out) counts as failed.
  const reported = new Set([...parsed.tests.map((t) => t.name), ...parsed.skipped]);
  const lost = tests
    .filter((t) => !reported.has(t))
    .map((name) => ({ name, ok: false, seconds: 0 }));
  const all = [...parsed.tests, ...lost].sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) throw new Error(`the test runner reported nothing (exit ${code}); see ${log}`);
  const run = LabRun.parse({
    at,
    version,
    platform: triple,
    verified,
    jobs,
    // The tests' own time; the wall clock would count the wait for a slot on the shared machine.
    seconds: parsed.total ?? Math.round((Date.now() - started) / 1000),
    tests: all,
  });
  const rec: LabRecord = { run, missing, skipped: parsed.skipped, tail: tail(output, 400) };
  writeFileSync(path.join(runsDir, `${runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  const passed = run.tests.filter((t) => t.ok).length;
  console.log(
    `lab: ${passed} of ${run.tests.length} passed in ${run.seconds} s (runner exit ${code})${parsed.skipped.length ? `; skipped: ${parsed.skipped.join(", ")}` : ""}`,
  );

  const g = gateRun(rec, { publish: opts.publish });
  if (g.held) {
    console.log(
      `lab: embargoed for the owner (${g.held.id}): ${g.held.reasons.join("; ")}. Nothing public changed. See pnpm brain embargo show ${g.held.id}`,
    );
    return 0;
  }
  if (!g.published) {
    console.log("lab: passed; not published (--no-publish)");
    return 0;
  }
  console.log(`lab: published to ${path.relative(ROOT, LAB_FILE())}`);
  if (opts.commit) {
    const committed = commitAsOwner(
      [path.relative(ROOT, LAB_FILE())],
      `Publish the lab's run on Bitcoin Core ${version}, so readers can see the release still holds against the ${run.tests.length} known attacks its own tests replay.`,
      opts.push,
    );
    if (!committed) console.log("lab: nothing to commit");
  }
  return 0;
}
