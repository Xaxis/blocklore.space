// LND in the lab (BACKLOG 40): the first Lightning implementation. For LND's newest release the lab
// checks the release the way LND's own scripts/verify-install.sh does, builds that release's own
// unit tests from its verified source with the Go version its go.mod names, and runs the packages
// whose tests exercise a defense the threat map lists. Each package is one lab test,
// `lnd/<package>`, in LND's own run, through the disclosure gate like any other.
//
// Verification, as scripts/verify-install.sh at the release tag has it (read from LND's
// repository at that tag, never from the release's own files):
//   KEYS+=("<fingerprint> <user>")   the 16 maintainers whose signatures count, one key each
//   import_keys                      each user's scripts/keys/<user>.asc into a keyring of its
//                                    own, then only the key with that fingerprint exported into
//                                    the keyring that user's signature is checked against
//   verify_signatures                manifest-<user>-v<version>.sig, one per user, checked
//                                    against manifest-v<version>.txt with that user's keyring;
//                                    gpg failing on any one stops the script, and a signature
//                                    counts when gpg's output says "Good signature"
//   MIN_REQUIRED_SIGNATURES=5        fewer good signatures and the release does not verify
// then lnd-source-v<version>.tar.gz's SHA-256 against the manifest. A release that fails either is
// never extracted or built: it is held for the owner, as Bitcoin Core's is. gpg says "Good
// signature" also for a signature made by a key past its expiry (EXPKEYSIG), so LND's count takes
// it; the count the lab publishes is GOODSIG alone, as Bitcoin Core's builder signatures are.
//
// The build: go.mod's `go 1.26.10` (and a `toolchain` line, when there is one) names the Go
// version; its archive comes from go.dev/dl with the SHA-256 go.dev's JSON lists, unpacked under
// the lab's own folder with GOROOT, GOPATH, GOMODCACHE and GOCACHE all there, GOTOOLCHAIN=local
// and GOFLAGS=-mod=readonly, so the modules are the ones the release's go.sum (inside the signed
// tarball) pins, checked by Go against go.sum and the checksum database. The modules are fetched
// once (`go list -deps -test`); the tests then build with GOPROXY=off. The tests run as LND's
// `make unit pkg=<package>` does (make/testing_flags.mk: `$(GOTEST) -tags="$(DEV_TAGS)
// $(RPC_TAGS) $(LOG_TAGS)" $(TEST_FLAGS) $(UNITPKG)`, LOG_TAGS `nolog` by default), with -count=1,
// -json and a 20 minute test timeout in place of its 180, under `heavy`.
//
// Which packages, from LND's source at v0.21.8-beta:
//   contractcourt       old-state: breach_arbitrator.go's BreachArbitrator takes a breach the
//                       chain watcher found (chain_watcher.go, handlePossibleBreach), builds the
//                       justice transaction (createJusticeTx) and sweeps the revoked outputs;
//                       breach_arbitrator_test.go's initBreachedState has Bob broadcast a state
//                       Alice has moved past, then TestBreachHandoffSuccess, TestBreachCreateJusticeTx,
//                       TestBreachSpends and TestBreachDelayedJusticeConfirmation check the handoff,
//                       the justice transactions and their response to each spend.
//                       pinning: blocksPassedSplitPublish (breach_arbitrator.go) splits the justice
//                       transaction after 4 blocks "to mitigate an attack the channel peer can do by
//                       pinning the HTLC outputs of the commitment with low-fee HTLC
//                       transactions"; TestBreachDelayedJusticeConfirmation checks that split.
//   watchtower/lookout  old-state: a watchtower's side. lookout_test.go's TestLookoutBreachMatching
//                       feeds blocks with breaching transactions and checks the tower matches them to
//                       its clients' encrypted states; justice_descriptor_test.go's
//                       TestJusticeDescriptor that the justice transaction it builds is right for
//                       each kind of channel.
//   lnwallet            old-state: the channel state machine. channel_test.go's
//                       TestReceiveRevocationWrongSecret refuses a revocation for the wrong
//                       commitment point, and TestNewBreachRetribution and TestCreateBreachRetribution
//                       build what a breach is punished with, on anchor channels too.
//   htlcswitch, sweep   lightning-bugs, as every package here: each package's unit tests are LND's
//                       own checks against bugs in that code. htlcswitch forwards HTLCs:
//                       link_test.go's TestChannelLinkMultiHopDecodeError cancels an HTLC whose
//                       onion does not decode, switch_test.go's TestInvalidFailure returns an
//                       unreadable failure when one cannot be decrypted. sweep fee bumps force
//                       close, HTLC and justice transactions until they confirm:
//                       fee_bumper_test.go's TestCreateRBFCompliantTx, sweeper_test.go's
//                       TestHandleBumpEventTxReplaced.
//   Every test named here ran and passed in the lab's first run on v0.21.8-beta.
//
// Not mapped, because no unit test here exercises the defense:
//   channel-jamming      htlcswitch's only jamming measure, the experimental accountability signal
//                        (link.go, experimentalAccountability), is tested only by the integration
//                        test testExperimentalAccountability, which needs bitcoind; lnwallet's
//                        TestMaxAcceptedHTLCs checks the 483 slot limit that slot jamming fills,
//                        not a defense against it.
//   replacement-cycling  the defense is htlc_timeout_resolver.go's watchHtlcSpend, which reads a
//                        preimage from a mempool spend (waitForMempoolOrBlockSpend) through
//                        chainntnfs's MempoolNotifier; no contractcourt test gives a resolver a
//                        mempool, and chainntnfs/mempool_test.go tests only the generic notifier.
//                        sweep's re-broadcasting is fee bumping in general, which pinning and
//                        cycling defeat, not a defense the tests put under either attack.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  compareVersions,
  type LabTest,
  LND_PACKAGES,
  LND_PREFIX,
  type LndPackage,
  RELEASE_VERSION,
  type Threat,
} from "@blocklore/core";
import { USER_AGENT } from "../env.ts";
import { download, extract, parseSums, sha256File } from "./release.ts";
import { step } from "./secp256k1.ts";

export const LND_REPO = "https://github.com/lightningnetwork/lnd";
/** LND's module path: a package's import path is this, a slash and its folder. */
export const LND_MODULE = "github.com/lightningnetwork/lnd";
const GO_DL = "https://go.dev/dl/";
/** The test binary's own limit, and the whole `go test` (its build too) once it holds a slot. */
const TEST_TIMEOUT = "20m";
const STEP_LIMIT_S = 45 * 60;

// ---------------------------------------------------------------------------------------------
// Pure pieces (tested in brain/test/lnd.test.ts)

/** The newest final LND release from `git ls-remote --tags`: "0.21.8-beta", never an rc. */
export function newestLndRelease(lsRemote: string): string | null {
  const versions = [...lsRemote.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+-beta)$/gm)].map(
    (m) => m[1] as string,
  );
  return versions.sort((a, b) => compareVersions(b, a))[0] ?? null;
}

/**
 * Whether a file is the one the manifest names: the manifest lists it, and its SHA-256 is the
 * manifest's. A manifest that lists it twice, differently, matches nothing.
 */
export function manifestMatch(manifest: string, file: string, sha256: string): boolean {
  const listed = manifest
    .split("\n")
    .map((l) => /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(l.trim()))
    .filter((m) => m?.[2] === file)
    .map((m) => m?.[1]);
  return listed.length > 0 && listed.every((h) => h === sha256);
}

/** The release's files on GitHub, by LND's own names. */
export const lndFiles = (version: string) => ({
  manifest: `manifest-v${version}.txt`,
  source: `lnd-source-v${version}.tar.gz`,
  signature: (user: string) => `manifest-${user}-v${version}.sig`,
});

export interface LndSigner {
  fingerprint: string;
  user: string;
}

/**
 * The maintainers whose signatures count and how many must be good, from scripts/verify-install.sh
 * at the release tag. Each user and each key once, as the script asks its reviewers to make sure.
 */
export function lndSigners(script: string): { signers: LndSigner[]; required: number } {
  const signers = [...script.matchAll(/^KEYS\+=\("([0-9A-F]{40}) ([A-Za-z0-9_-]+)"\)$/gm)].map(
    (m) => ({ fingerprint: m[1] as string, user: m[2] as string }),
  );
  const required = /^MIN_REQUIRED_SIGNATURES=(\d+)$/m.exec(script)?.[1];
  if (!signers.length || !required)
    throw new Error("verify-install.sh does not name its keys the way the lab reads them");
  for (const k of ["fingerprint", "user"] as const)
    if (new Set(signers.map((s) => s[k])).size !== signers.length)
      throw new Error(`verify-install.sh lists a ${k} twice`);
  return { signers, required: Number(required) };
}

/**
 * What gpg's status output (--status-fd) says of one maintainer's signature, made by the key with
 * this fingerprint (VALIDSIG naming it as the primary key):
 *   good     GOODSIG, the count the lab publishes, as Bitcoin Core's builder signatures are counted
 *   expired  EXPKEYSIG: the signature is good but its key had expired when it was made. gpg still
 *            prints "Good signature" and exits 0, which is all verify-install.sh checks, so LND's
 *            own minimum counts it; the lab's public count does not.
 *   bad      anything else: a bad or unverifiable signature, another key, a revoked key, or gpg
 *            exiting non-zero, where verify-install.sh stops
 */
export function signatureState(
  status: string,
  fingerprint: string,
  exit: number | null,
): "good" | "expired" | "bad" {
  if (exit !== 0) return "bad";
  const lines = status.split("\n").map((l) => l.trim());
  if (lines.some((l) => /^\[GNUPG:\] (BADSIG|ERRSIG|REVKEYSIG|EXPSIG|NO_PUBKEY) /.test(l)))
    return "bad";
  const signer = lines.some((l) => {
    const f = l.split(/\s+/);
    // VALIDSIG <fpr> <date> <ts> <expire> <version> <reserved> <algo> <hash> <class> <primary>
    return f[1] === "VALIDSIG" && (f.length >= 12 ? f[11] : f[2]) === fingerprint;
  });
  if (!signer) return "bad";
  if (lines.some((l) => l.startsWith("[GNUPG:] GOODSIG "))) return "good";
  if (lines.some((l) => l.startsWith("[GNUPG:] EXPKEYSIG "))) return "expired";
  return "bad";
}

/**
 * Whether a release verifies, by verify-install.sh's rule: its tarball matches the manifest, no
 * maintainer's signature that is there fails (the script stops at the first that does), and as
 * many as LND requires are good by the script's count; and at least one is good by the lab's.
 */
export function lndVerified(
  sha256: boolean,
  states: readonly ("good" | "expired" | "bad" | "absent")[],
  required: number,
): boolean {
  const good = states.filter((s) => s === "good").length;
  const counted = states.filter((s) => s === "good" || s === "expired").length;
  return sha256 && !states.includes("bad") && good > 0 && counted >= required;
}

/**
 * The Go release go.mod asks for: its `toolchain` line when it names one at least as new as the
 * `go` line, else the `go` line ("go 1.21" and later name a release: 1.26 is go1.26.0).
 */
export function goVersionFromMod(goMod: string): string {
  const go = /^go (\d+\.\d+(?:\.\d+)?)\s*$/m.exec(goMod)?.[1];
  if (!go) throw new Error("go.mod names no go version");
  const [major = 0, minor = 0] = go.split(".").map(Number);
  const line = go.split(".").length === 2 && major === 1 && minor >= 21 ? `${go}.0` : go;
  const toolchain = /^toolchain go(\d+\.\d+\.\d+)\s*$/m.exec(goMod)?.[1];
  return `go${toolchain && compareVersions(toolchain, line) >= 0 ? toolchain : line}`;
}

export interface GoRelease {
  version: string;
  stable: boolean;
  files: {
    filename: string;
    os: string;
    arch: string;
    sha256: string;
    size: number;
    kind: string;
  }[];
}

/** Go's name for this machine's architecture. */
export function goArch(arch = process.arch): string {
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  throw new Error(`no Go release for ${arch}`);
}

/** The archive go.dev's JSON lists for a release, with its SHA-256. */
export function goArchive(
  releases: readonly GoRelease[],
  version: string,
  os = "linux",
  arch = goArch(),
): { filename: string; sha256: string; size: number } {
  const release = releases.find((r) => r.version === version);
  if (!release) throw new Error(`go.dev lists no ${version}`);
  const file = release.files.find((f) => f.os === os && f.arch === arch && f.kind === "archive");
  if (!file || !/^[0-9a-f]{64}$/.test(file.sha256) || !/^go[\w.-]+\.tar\.gz$/.test(file.filename))
    throw new Error(`go.dev lists no ${os}-${arch} archive of ${version}`);
  return { filename: file.filename, sha256: file.sha256, size: file.size };
}

/**
 * The build tags of LND's `make unit` from make/testing_flags.mk: DEV_TAGS, RPC_TAGS and the
 * default LOG_TAGS, in the UNIT line's order.
 */
export function unitTags(mk: string): string[] {
  const read = (re: RegExp, what: string) => {
    const m = re.exec(mk);
    if (!m) throw new Error(`make/testing_flags.mk does not say ${what} the way the lab reads it`);
    return m[1] as string;
  };
  const vars: Record<string, string> = {
    DEV_TAGS: read(/^DEV_TAGS = (.+)$/m, "DEV_TAGS"),
    RPC_TAGS: read(/^RPC_TAGS = (.+)$/m, "RPC_TAGS"),
    LOG_TAGS: read(
      /^ifneq \(\$\(log\),\)\s*\nLOG_TAGS := \$\{log\}\s*\nelse\s*\nLOG_TAGS := (\S+)\s*\nendif/m,
      "the default LOG_TAGS",
    ),
  };
  const unit = read(/^UNIT := \$\(GOTEST\) -tags="([^"]+)"/m, "the unit test command");
  const tags = unit.replace(/\$\((\w+)\)/g, (m, k: string) => {
    if (!(k in vars)) throw new Error(`make/testing_flags.mk: unknown ${m} in the unit tags`);
    return vars[k] as string;
  });
  return [...new Set(tags.split(/\s+/).filter(Boolean))];
}

/** The threat map's LND packages (or the owner's list), in the order the lab knows them. */
export function selectLndPackages(
  threats: Pick<Threat, "lab">[],
  override?: string[],
): { packages: LndPackage[]; unknown: string[] } {
  const wanted = new Set<string>();
  const unknown: string[] = [];
  for (const raw of override?.length ? override : threats.flatMap((t) => t.lab)) {
    const t = raw.trim();
    if (!t.startsWith(LND_PREFIX)) continue;
    const pkg = t.slice(LND_PREFIX.length);
    if ((LND_PACKAGES as readonly string[]).includes(pkg)) wanted.add(pkg);
    else unknown.push(t);
  }
  return { packages: LND_PACKAGES.filter((p) => wanted.has(p)), unknown };
}

/**
 * The environment Go runs in: every folder under the lab's, and nothing from the user's own. Any
 * Go setting the base environment carries (GOSUMDB=off, GOPROXY, GOFLAGS, GOPATH) is dropped, so
 * nothing outside the lab can weaken the module checks or move a folder.
 */
export function goEnv(
  dirs: { goroot: string; go: string; home: string; tmp: string },
  base: NodeJS.ProcessEnv,
  online: boolean,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith("GO"))),
    PATH: `${path.join(dirs.goroot, "bin")}:${base.PATH ?? "/usr/bin:/bin"}`,
    HOME: dirs.home,
    XDG_CONFIG_HOME: path.join(dirs.home, ".config"),
    XDG_CACHE_HOME: path.join(dirs.home, ".cache"),
    TMPDIR: dirs.tmp,
    GOROOT: dirs.goroot,
    GOPATH: path.join(dirs.go, "path"),
    GOMODCACHE: path.join(dirs.go, "mod"),
    GOCACHE: path.join(dirs.go, "cache"),
    GOENV: "off",
    GOTELEMETRY: "off",
    GOTOOLCHAIN: "local",
    GOFLAGS: "-mod=readonly",
    // Online only to fetch the modules go.sum pins; the build and the tests never fetch.
    ...(online ? {} : { GOPROXY: "off" }),
  };
}

/** `go test` for one package, as LND's `make unit pkg=<package>` runs it. */
export function goTestArgv(pkg: LndPackage, tags: readonly string[], jobs: number): string[] {
  return [
    "go",
    "test",
    "-json",
    "-count=1",
    `-timeout=${TEST_TIMEOUT}`,
    `-p=${jobs}`,
    `-tags=${tags.join(" ")}`,
    `./${pkg}`,
  ];
}

export interface GoTestResult {
  /** The package's own verdict: pass, fail, or skip when it has no tests. */
  action: "pass" | "fail" | "skip" | null;
  /** The test binary's own time, without the build. */
  seconds: number;
  /** Tests that failed, by name. */
  failed: string[];
  /** What the package and its failing tests printed, and any build error. */
  output: string[];
}

/**
 * One package's result from `go test -json`: its last package-level event (pass, fail or skip;
 * none when the run was cut off, which is not a pass), the tests that failed, and their output.
 */
export function parseGoTest(jsonl: string, importPath: string): GoTestResult {
  let final: { Action: string; Elapsed?: number } | null = null;
  const failed: string[] = [];
  const byTest = new Map<string, string[]>();
  const pkgOut: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.startsWith("{")) {
      if (line.trim()) pkgOut.push(line);
      continue;
    }
    let e: {
      Action?: string;
      Package?: string;
      ImportPath?: string;
      Test?: string;
      Elapsed?: number;
      Output?: string;
    };
    try {
      e = JSON.parse(line);
    } catch {
      pkgOut.push(line);
      continue;
    }
    if (e.Action === "build-output" && e.Output) pkgOut.push(e.Output.trimEnd());
    if (e.Package !== importPath) continue;
    if (e.Test) {
      if (e.Action === "output" && e.Output)
        byTest.set(e.Test, [...(byTest.get(e.Test) ?? []), e.Output.trimEnd()]);
      if (e.Action === "fail") failed.push(e.Test);
    } else if (e.Action === "output" && e.Output) pkgOut.push(e.Output.trimEnd());
    else if (e.Action === "pass" || e.Action === "fail" || e.Action === "skip")
      final = { Action: e.Action, Elapsed: e.Elapsed };
  }
  return {
    action: (final?.Action as GoTestResult["action"]) ?? null,
    seconds: Math.round((final?.Elapsed ?? 0) * 10) / 10,
    failed,
    output: [...failed.flatMap((t) => byTest.get(t) ?? []), ...pkgOut],
  };
}

// ---------------------------------------------------------------------------------------------
// Verify, build, test

/** What the owner sees of an LND run, privately. */
export interface LndRecord {
  tag: string;
  /** The commit the tag named when LND's keys and verify-install.sh were read. */
  commit: string | null;
  manifest: string;
  source: string;
  required: number | null;
  /** Each maintainer the script names: their signature's state, gpg's exit and its words. */
  signatures: {
    user: string;
    fingerprint: string;
    state: "good" | "expired" | "bad" | "absent";
    exit: number | null;
    status: string;
  }[];
  go: { version: string; archive: string; sha256: string } | null;
  tags: string[];
  commands: string[];
  packages: {
    name: string;
    ok: boolean;
    exit: number | null;
    seconds: number;
    wall: number;
    failed: string[];
    tail: string;
  }[];
  error: string | null;
}

export interface LndRun {
  sha256: boolean;
  signatures: number | null;
  signers: number | null;
  /** The release verified: the manifest's hash matched and enough maintainers signed it. */
  verified: boolean;
  tests: LabTest[];
  missing: string[];
  record: LndRecord;
}

const tailOf = (text: string[] | string, lines: number) =>
  (Array.isArray(text) ? text : text.split("\n")).slice(-lines).join("\n");

/** LND's keys and verify-install.sh at the release tag, from its repository: the trusted side. */
function checkoutKeys(tag: string, dir: string): string | null {
  const git = (args: string[], cwd?: string) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", timeout: 180_000 });
  rmSync(dir, { recursive: true, force: true });
  git([
    "clone",
    "-q",
    "--depth",
    "1",
    "--branch",
    tag,
    "--filter=blob:none",
    "--no-checkout",
    LND_REPO,
    dir,
  ]);
  git(["sparse-checkout", "set", "--no-cone", "/scripts/keys/", "/scripts/verify-install.sh"], dir);
  git(["checkout", "-q", tag], dir);
  return git(["rev-parse", "HEAD"], dir).trim() || null;
}

/** Each maintainer's signature checked against a keyring holding that maintainer's key alone. */
function verifyManifest(input: {
  signers: LndSigner[];
  keys: string;
  gnupg: string;
  dl: string;
  manifest: string;
  sigs: Map<string, string>;
}): LndRecord["signatures"] {
  rmSync(input.gnupg, { recursive: true, force: true });
  mkdirSync(input.gnupg, { recursive: true, mode: 0o700 });
  const gpg = (args: string[], stdin?: Buffer) =>
    spawnSync("gpg", ["--homedir", input.gnupg, "--batch", "--no-tty", ...args], {
      input: stdin,
      timeout: 120_000,
    });
  const ring = (file: string) => ["--no-default-keyring", "--keyring", file];
  try {
    return input.signers.map(({ user, fingerprint }) => {
      const sig = input.sigs.get(user);
      const keyFile = path.join(input.keys, `${user}.asc`);
      if (!sig || !existsSync(keyFile))
        return { user, fingerprint, state: "absent" as const, exit: null, status: "" };
      const untrusted = path.join(input.gnupg, `${user}.pgp-untrusted`);
      const trusted = path.join(input.gnupg, `${user}.pgp`);
      gpg([...ring(untrusted), "--import", keyFile]);
      const key = gpg([...ring(untrusted), "--export", fingerprint]).stdout;
      if (key?.length) gpg([...ring(trusted), "--import"], key);
      const v = gpg([
        ...ring(trusted),
        "--status-fd",
        "1",
        "--verify",
        path.join(input.dl, sig),
        path.join(input.dl, input.manifest),
      ]);
      const status = v.stdout?.toString("utf8") ?? "";
      const state = signatureState(status, fingerprint, v.status);
      return { user, fingerprint, state, exit: v.status, status };
    });
  } finally {
    // The imports start an agent for this folder; it is not left running on the shared machine.
    spawnSync("gpgconf", ["--homedir", input.gnupg, "--kill", "all"], {
      stdio: "ignore",
      timeout: 30_000,
    });
  }
}

/** The Go release go.mod names, from go.dev, checked against go.dev's SHA-256; reused when intact. */
async function toolchain(
  version: string,
  goDir: string,
  log: (line: string) => void,
): Promise<{ goroot: string; archive: string; sha256: string }> {
  const res = await fetch(`${GO_DL}?mode=json&include=all`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`go.dev/dl: HTTP ${res.status}`);
  const want = goArchive((await res.json()) as GoRelease[], version);
  const home = path.join(goDir, version);
  const goroot = path.join(home, "go");
  const stampFile = path.join(home, ".sha256");
  if (
    existsSync(path.join(goroot, "bin", "go")) &&
    existsSync(stampFile) &&
    readFileSync(stampFile, "utf8").trim() === want.sha256
  ) {
    log(`lab: ${version} already unpacked from ${want.filename} (SHA-256 ${want.sha256})`);
    return { goroot, archive: want.filename, sha256: want.sha256 };
  }
  const dl = path.join(goDir, "dl");
  mkdirSync(dl, { recursive: true });
  const archive = path.join(dl, want.filename);
  if (!existsSync(archive) || (await sha256File(archive)) !== want.sha256) {
    log(`lab: downloading ${want.filename}`);
    await download(`${GO_DL}${want.filename}`, archive);
  }
  const got = await sha256File(archive);
  if (got !== want.sha256) {
    rmSync(archive, { force: true });
    throw new Error(`${want.filename} did not match go.dev's SHA-256 (${got})`);
  }
  if (extract(archive, home) !== goroot) throw new Error(`${want.filename} does not hold go/`);
  writeFileSync(stampFile, `${want.sha256}\n`);
  log(`lab: ${version} unpacked from ${want.filename}, SHA-256 matched go.dev`);
  return { goroot, archive: want.filename, sha256: want.sha256 };
}

/**
 * One LND release: verify, and only then extract, fetch the Go toolchain and the modules, and run
 * each package's tests. Throws when the lab itself cannot run (a download, git or go.dev failing);
 * what LND's release does is in what it returns.
 */
export async function runLnd(input: {
  version: string;
  /** <lab>/lnd/<version>: downloads, the source, the tests' temporary files. */
  dir: string;
  /** <lab>/go: the toolchain, GOPATH, the module and build caches, shared by every release. */
  goDir: string;
  home: string;
  packages: readonly LndPackage[];
  jobs: number;
  env: NodeJS.ProcessEnv;
  runId: string;
  log: (line: string) => void;
}): Promise<LndRun> {
  const { version, dir, log } = input;
  if (!RELEASE_VERSION.lnd.test(version)) throw new Error(`${version} is not an LND release`);
  const tag = `v${version}`;
  const files = lndFiles(version);
  const record: LndRecord = {
    tag,
    commit: null,
    manifest: files.manifest,
    source: files.source,
    required: null,
    signatures: [],
    go: null,
    tags: [],
    commands: [],
    packages: [],
    error: null,
  };

  // The trusted side first: who signs, and their keys, from LND's repository at the tag.
  const keysDir = path.join(dir, "keys");
  record.commit = checkoutKeys(tag, keysDir);
  const { signers, required } = lndSigners(
    readFileSync(path.join(keysDir, "scripts", "verify-install.sh"), "utf8"),
  );
  record.required = required;
  log(`lab: LND's keys at ${tag} (commit ${record.commit}): ${signers.length} maintainers`);

  // Then the release's files, untrusted, in a folder of their own, fetched fresh but for the
  // tarball, which is kept only while it still matches the manifest.
  const dl = path.join(dir, "dl");
  mkdirSync(dl, { recursive: true });
  const base = `${LND_REPO}/releases/download/${tag}`;
  await download(`${base}/${files.manifest}`, path.join(dl, files.manifest));
  const sigs = new Map<string, string>();
  for (const { user } of signers) {
    const name = files.signature(user);
    rmSync(path.join(dl, name), { force: true });
    if (await download(`${base}/${name}`, path.join(dl, name), { optional: true }))
      sigs.set(user, name);
  }
  record.signatures = verifyManifest({
    signers,
    keys: path.join(keysDir, "scripts", "keys"),
    gnupg: path.join(dir, "gnupg"),
    dl,
    manifest: files.manifest,
    sigs,
  });
  const states = record.signatures.map((s) => s.state);
  const good = states.filter((s) => s === "good").length;
  const expired = record.signatures.filter((s) => s.state === "expired").map((s) => s.user);
  const manifest = readFileSync(path.join(dl, files.manifest), "utf8");
  if (!parseSums(manifest).has(files.source))
    throw new Error(`${files.manifest} does not list ${files.source}`);
  const tarball = path.join(dl, files.source);
  if (!existsSync(tarball) || !manifestMatch(manifest, files.source, await sha256File(tarball))) {
    log(`lab: downloading ${files.source}`);
    await download(`${base}/${files.source}`, tarball);
  }
  const sha256 = manifestMatch(manifest, files.source, await sha256File(tarball));
  const verified = lndVerified(sha256, states, required);
  log(
    `lab: manifest ${sha256 ? "matched" : "DID NOT MATCH"}; ${good} good maintainer signatures of ${signers.length} known keys${expired.length ? `, and ${expired.length} good but made by a key past its expiry (${expired.join(", ")})` : ""}; LND requires ${required} by its own count`,
  );
  const out = { sha256, signatures: good, signers: signers.length, record };
  if (!verified) return { ...out, verified, tests: [], missing: [] };

  // Verified: extract, read how LND builds its tests, get the Go it names.
  const src = extract(tarball, path.join(dir, "src"));
  const goVersion = goVersionFromMod(readFileSync(path.join(src, "go.mod"), "utf8"));
  record.tags = unitTags(readFileSync(path.join(src, "make", "testing_flags.mk"), "utf8"));
  const go = await toolchain(goVersion, input.goDir, log);
  record.go = { version: goVersion, archive: go.archive, sha256: go.sha256 };
  const tmp = path.join(dir, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  for (const d of [tmp, input.home]) mkdirSync(d, { recursive: true });
  const dirs = { goroot: go.goroot, go: input.goDir, home: input.home, tmp };

  const missing = input.packages
    .filter((p) => {
      const d = path.join(src, p);
      return !existsSync(d) || !readdirSync(d).some((f) => f.endsWith("_test.go"));
    })
    .map((p) => `${LND_PREFIX}${p}`);
  const packages = input.packages.filter((p) => !missing.includes(`${LND_PREFIX}${p}`));
  if (!packages.length) return { ...out, verified, tests: [], missing };

  // The modules go.sum pins, fetched once and checked by Go; nothing after this goes online.
  const list = ["go", "list", "-deps", "-test", `-tags=${record.tags.join(" ")}`];
  const fetched = spawnSync(
    list[0] as string,
    [...list.slice(1), ...packages.map((p) => `./${p}`)],
    {
      cwd: src,
      env: goEnv(dirs, input.env, true),
      encoding: "utf8",
      timeout: 30 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  record.commands.push([...list, ...packages.map((p) => `./${p}`)].join(" "));
  if (fetched.status !== 0)
    throw new Error(`go list could not fetch LND's modules: ${tailOf(fetched.stderr ?? "", 8)}`);
  log(`lab: LND's modules for ${packages.length} packages fetched and checked against go.sum`);

  const tests: LabTest[] = [];
  for (const pkg of packages) {
    const argv = goTestArgv(pkg, record.tags, input.jobs);
    record.commands.push(argv.join(" "));
    const name = `${LND_PREFIX}${pkg}`;
    const logFile = path.join(dir, "runs", `${input.runId}.${pkg.replaceAll("/", "_")}.jsonl`);
    const r = await step(argv, {
      cwd: src,
      log: logFile,
      limit: STEP_LIMIT_S,
      env: goEnv(dirs, input.env, false),
    });
    const parsed = parseGoTest(r.output, `${LND_MODULE}/${pkg}`);
    if (parsed.action === "skip") {
      missing.push(name);
      continue;
    }
    const ok = r.exit === 0 && parsed.action === "pass";
    tests.push({ name, ok, seconds: parsed.seconds });
    record.packages.push({
      name,
      ok,
      exit: r.exit,
      seconds: parsed.seconds,
      wall: r.seconds,
      failed: parsed.failed,
      tail: tailOf(ok ? [] : parsed.output, 60),
    });
    log(
      `lab: ${name} ${ok ? "passed" : `FAILED (exit ${r.exit}${parsed.failed.length ? `; ${parsed.failed.slice(0, 5).join(", ")}` : ""})`} in ${parsed.seconds} s (with its build ${r.seconds} s)`,
    );
  }
  return { ...out, verified, tests, missing };
}
