// Eclair in the lab (BACKLOG 40): the third Lightning implementation, after LND and LDK. For
// Eclair's newest release the lab checks the release the way its release notes say to, ties the
// signed files to the commit it checks out, builds that commit with the JDK the notes name and the
// Maven Eclair's own wrapper pins, both fetched and checked in the lab's own folder, and runs the
// eclair-core test suites that exercise a defense the threat map lists. Each group of suites is
// one lab test, `eclair/<path>` (its path under fr/acinq/eclair in eclair-core/src/test/scala), in
// Eclair's own run, through the disclosure gate like any other.
//
// Verification. Eclair's release notes ("Verifying signatures") say: get "our release signing
// key", named by its 16-hex key id, from acinq.co or from a committer's GitHub keys, then
// `gpg -d SHA256SUMS.asc > SHA256SUMS.stripped` and `sha256sum -c SHA256SUMS.stripped`. The tag is
// not signed (v0.14.6 is a lightweight tag; its commit carries GitHub's own merge signature), and
// SHA256SUMS lists only the built zips. So the lab:
//   reads the key id the release's notes name, and takes it only when it is the last 16 digits of
//     a key pinned here (ECLAIR_KEYS: the keys the notes of v0.14.1 to v0.14.6 named, read
//     2026-11-26), so a release's notes cannot vouch for a key of their own choosing;
//   fetches that key from the acinq.co address beside it, or keys.openpgp.org or
//     keyserver.ubuntu.com by its fingerprint, into a keyring of its own, then exports only the key
//     with that fingerprint into the keyring the signature is checked against, as for LDK;
//   decrypts SHA256SUMS.asc as the notes do, good when gpg's status says GOODSIG and VALIDSIG
//     names the pinned key as the primary key, and reads the sums from what gpg says was signed,
//     never from the file around it;
//   downloads eclair-node-<v>-<commit>-bin.zip and checks it against those signed sums;
//   reads the commit inside it: eclair-node's jar carries the full commit it was built from in its
//     manifest ("we hide the git commit in the Specification-Version standard field",
//     eclair-node/pom.xml), which must be the commit the tag names, checked out with nothing
//     changed; the jar's Implementation-Title and Implementation-Version must be eclair-node and
//     the release.
// The release verifies when all of that holds; only then does anything build. It is one signature
// (SHA256SUMS.asc carries one), so `signatures` is 0 or 1 and `signers` the pinned keys it was
// checked against. After the build the lab also compares the eclair-node zip it built with the
// signed one: Eclair says its builds are deterministic, and a match means the source tested is
// byte for byte what ACINQ signed. The record keeps the result; it does not decide the run, since
// the notes ask for Ubuntu 26.04.1, which the devbox is not. What this does not check: that the
// key is ACINQ's beyond acinq.co and Eclair's notes saying so; and the dependencies' authors.
//
// The toolchain. The notes name the JDK ("Adoptium OpenJDK 21.0.12.1"); BUILD.md asks for OpenJDK
// 21 from Adoptium. The lab takes Temurin 21.0.12.1+1 (TEMURIN), its tarball checked against the
// SHA-256 pinned here, the release's own .sha256.txt, and its .sig by Adoptium's key, fetched by
// the fingerprint Adoptium's GPG verification page gives. Eclair ships the Maven wrapper, which
// pins Maven 3.9.9 by SHA-256 in .mvn/wrapper/maven-wrapper.properties; the lab does not run the
// wrapper's download but takes that Maven from Apache itself (MAVEN): the tarball checked against
// the SHA-512 pinned here, Apache's .sha512 and its .asc by the release manager's key, taken by
// fingerprint from Apache Maven's KEYS file. Both unpack under the lab's own folder. HOME, the
// Java user.home of every JVM (JAVA_TOOL_OPTIONS, since Java reads it from the password file, not
// HOME), the temporary folder and the Maven repository are all the lab's: nothing goes to ~/.m2
// or ~/.sbt. Every dependency Maven resolves is checked against the repository's checksum
// (--strict-checksums) at a release's first run, which runs online; the lab then keeps the
// SHA-256 of every file it resolved (resolved.sha256 beside the repository), and every later run
// of that release checks them all and builds and tests offline (-o), as LDK keeps its Cargo.lock.
// The bitcoind that eclair-core's own tests run against is the one its pom.xml pins by SHA-256,
// fetched by Maven's download plugin and kept in the repository with the rest.
//
// The build and the tests. The notes' own command builds the release, `mvnw clean install
// -DskipTests` (run with that Maven); then each group runs as BUILD.md runs tests,
// `mvn -pl eclair-core test` with -DwildcardSuites=<package> for a package's suites or
// -Dsuites=<class> for one suite, with scalatest's threadCount at the lab's jobs, under `heavy`;
// channel/publish one suite at a time (ONE_SUITE_AT_A_TIME says why). A group whose only failures
// are timeouts, in Akka TestKit's words as scalatest printed them, runs once more, alone and one
// suite at a time, and that attempt counts; so does one whose other failures each come right after
// a timed out test in the same suite (the timed out test's transactions stay in that suite's
// bitcoind). The second attempt must pass every test; the record keeps the first, and the public
// test says why (`rerun`). Any other failure, or any on the second attempt, goes to the gate.
//
// Which groups, from Eclair's source at v0.14.6:
//   channel/states    old-state: ClosingStateSpec's "recv WatchFundingSpentTriggered (one revoked
//                     tx)" and "(multiple revoked tx)" tests, in each commitment format, have the
//                     peer publish a revoked commitment and check the channel publishes the
//                     penalty transactions for every output; "recv WatchTxConfirmedTriggered
//                     (revoked htlc-success tx)" and "(revoked aggregated htlc tx)" punish the
//                     HTLC transactions spent from it.
//                     replacement-cycling: "recv WatchOutputSpentTriggered (extract preimage from
//                     Claim-HTLC-success tx)" checks that when the peer's HTLC-success spend is
//                     seen, the channel takes its preimage and settles the HTLC upstream; with
//                     the watcher below, that is the mempool scanning Eclair deployed against
//                     replacement cycling.
//                     lightning-bugs, as every group here: each group's tests are Eclair's own
//                     checks against bugs in that code (the channel state machine from opening to
//                     closing, the HTLCs added, settled and failed in NORMAL and SHUTDOWN).
//   transactions      old-state: TransactionsSpec's "generate valid commitment and htlc
//                     transactions", in each commitment format, builds and checks the penalty
//                     transactions for a revoked commitment's outputs and its HTLC transactions;
//                     TestVectorsSpec checks BOLT 3's own vectors.
//   channel/publish   replacement-cycling: TxPublisherSpec's "publishing attempt fails
//                     (unconfirmed conflicting replaceable transaction)" has an HTLC-timeout
//                     transaction lose its place to a conflicting unconfirmed one and checks it is
//                     published again at the next block ("The conflicting transaction may be
//                     evicted from the mempool, so we retry when a new block is found"); and
//                     MempoolTxMonitorSpec's "publish succeeds then transaction is replaced by an
//                     unconfirmed tx" checks, against a real bitcoind, that a replacement is
//                     noticed at the next block. That is the re-broadcasting the 2023 cycling
//                     disclosure named.
//   blockchain/bitcoind/ZmqWatcherSpec
//                     replacement-cycling: "watch for spent transactions" publishes a spend to a
//                     real bitcoind and checks the watch fires while the spend is only in the
//                     mempool ("tx and tx1 aren't confirmed yet, but we trigger the
//                     WatchSpentTriggered event when we see tx1 in the mempool").
//   router, crypto    lightning-bugs: route finding and gossip validation; Sphinx onions with
//                     BOLT 4's vectors, the BOLT 8 transport and the revocation secrets' shachain.
//   Every test named here ran and passed in the lab's first run on v0.14.6.
//
// Not mapped, because no test exercises the defense:
//   pinning           Eclair's source names no pinning defense of its own. Its claims are fee
//                     bumped through anchors, or published as TRUC packages on zero-fee
//                     commitments, and channel/publish checks those bumps against bitcoind, but
//                     no test puts a pinning transaction in their way.
//   channel-jamming   Eclair scores its peers' HTLCs (reputation/), but at v0.14.6 relaying only
//                     logs what it would have refused ("We don't yet enforce channel jamming
//                     protections", ChannelRelay.scala), so a passing test would show a defense no
//                     node has turned on.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  compareVersions,
  ECLAIR_PREFIX,
  ECLAIR_SUITES,
  type EclairSuite,
  type LabTest,
  RELEASE_VERSION,
  type Threat,
} from "@blocklore/core";
import { USER_AGENT } from "../env.ts";
import { keyUrls } from "./ldk.ts";
import { signatureState } from "./lnd.ts";
import { download, extract, parseSums, sha256File } from "./release.ts";
import { step } from "./secp256k1.ts";

export const ECLAIR_REPO = "https://github.com/ACINQ/eclair";
const NOTES_API = "https://api.github.com/repos/ACINQ/eclair/releases/tags";
const RELEASE_FILES = `${ECLAIR_REPO}/releases/download`;
const BUILD_LIMIT_S = 60 * 60;
const GROUP_LIMIT_S = 60 * 60;

/**
 * The keys Eclair's release notes have named as "our release signing key" (v0.14.1 to v0.14.6,
 * read 2026-11-26: E04E48E72C205463 for every release but v0.14.3, signed with E434ED292E85643A),
 * by full fingerprint, each with where ACINQ publishes it: the notes give acinq.co/pgp/drouinf2.asc
 * for the first; ACINQ's SECURITY.md lists the second, at acinq.co/pgp/padioupm.asc. Each
 * fingerprint was read from the key at that address.
 */
export const ECLAIR_KEYS = [
  {
    fingerprint: "55092314AD0547C59BDB7AE8E04E48E72C205463",
    name: "Fabrice Drouin",
    url: "https://acinq.co/pgp/drouinf2.asc",
  },
  {
    fingerprint: "6AA45A4C209A2D3064CF66BEE434ED292E85643A",
    name: "Pierre-Marie Padiou",
    url: "https://acinq.co/pgp/padioupm.asc",
  },
] as const;
export type EclairKey = (typeof ECLAIR_KEYS)[number];

/**
 * Temurin 21.0.12.1+1, the JDK Eclair's notes name for v0.14.4 to v0.14.6 ("Adoptium OpenJDK
 * 21.0.12.1"). Each SHA-256 is Adoptium's API's (api.adoptium.net/v3/assets/release_name/eclipse/
 * jdk-21.0.12.1%2B1) and the release's own .sha256.txt, read 2026-11-26; the key is the one
 * Adoptium's "GPG verification" page names (adoptium.net/installation/gpg-verification).
 */
export const TEMURIN = {
  version: "21.0.12.1+1",
  key: "3B04D753C9050D9A5D343F39843C48A565F8F04B",
  files: {
    x64: {
      file: "OpenJDK21U-jdk_x64_linux_hotspot_21.0.12.1_1.tar.gz",
      sha256: "ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94",
    },
    arm64: {
      file: "OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.12.1_1.tar.gz",
      sha256: "23e37e026f12f3e706f18938ff611db3032d075b09d0879a25d06718c773e223",
    },
  },
} as const;
const TEMURIN_DL = "https://github.com/adoptium/temurin21-binaries/releases/download";

/**
 * Maven 3.9.9, the version Eclair's wrapper pins at v0.14.6 (.mvn/wrapper/maven-wrapper.properties).
 * The SHA-512 is Apache's own (apache-maven-3.9.9-bin.tar.gz.sha512), read 2026-11-26; the key is
 * the one its .asc names, Tamas Cservenak's, which Apache Maven's KEYS file lists.
 */
export const MAVEN = {
  version: "3.9.9",
  file: "apache-maven-3.9.9-bin.tar.gz",
  sha512:
    "a555254d6b53d267965a3404ecb14e53c3827c09c3b94b5678835887ab404556bfaf78dcfe03ba76fa2508649dca8531c74bca4d5846513522404d48e8c4ac8b",
  key: "88BE34F94BDB2B5357044E2E3A387D43964143E3",
} as const;
const MAVEN_DL = `https://archive.apache.org/dist/maven/maven-3/${MAVEN.version}/binaries`;
const MAVEN_KEYS = "https://downloads.apache.org/maven/KEYS";

// ---------------------------------------------------------------------------------------------
// Pure pieces (tested in brain/test/eclair.test.ts)

/** Eclair's final releases from `git ls-remote --tags`, newest first: never an rc or a `^{}`. */
export function eclairReleases(lsRemote: string): string[] {
  const versions = new Set(
    [...lsRemote.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)$/gm)].map((m) => m[1] as string),
  );
  return [...versions].sort((a, b) => compareVersions(b, a));
}

/** The newest final Eclair release, "0.14.6", or null. */
export const newestEclairRelease = (lsRemote: string): string | null =>
  eclairReleases(lsRemote)[0] ?? null;

/** What the release notes say to check with: the signing key's id and the JDK they name. */
export function readNotes(body: string): { keyId: string | null; jdk: string | null } {
  return {
    keyId: /release signing key ([0-9A-F]{16})\b/.exec(body)?.[1] ?? null,
    jdk: /Adoptium OpenJDK (\d+(?:\.\d+)+)/.exec(body)?.[1] ?? null,
  };
}

/** The pinned key a 16-hex key id names, or null: an id no pinned key ends with names none. */
export function pinnedKey(keyId: string | null): EclairKey | null {
  if (!keyId || !/^[0-9A-F]{16}$/.test(keyId)) return null;
  return ECLAIR_KEYS.find((k) => k.fingerprint.endsWith(keyId)) ?? null;
}

/** The eclair-node zip the signed sums list for a release, with the short commit in its name. */
export function nodeZip(
  sums: ReadonlyMap<string, string>,
  version: string,
): { file: string; sha256: string; short: string } | null {
  const re = new RegExp(
    `^eclair-node-${version.replaceAll(".", "\\.")}-([0-9a-f]{7,40})-bin\\.zip$`,
  );
  const hits = [...sums].flatMap(([file, sha256]) => {
    const m = re.exec(file);
    return m ? [{ file, sha256, short: m[1] as string }] : [];
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * The eclair-node jar in the zip's listing (`unzip -Z1`): <top>/lib/eclair-node_<scala>-<v>.jar,
 * exactly one, or null.
 */
export function nodeJar(listing: string, zipFile: string, version: string): string | null {
  const top = zipFile.replace(/-bin\.zip$/, "");
  const v = version.replaceAll(".", "\\.");
  const re = new RegExp(`^${top.replaceAll(".", "\\.")}/lib/eclair-node_\\d+\\.\\d+-${v}\\.jar$`);
  const hits = listing.split("\n").filter((n) => re.test(n));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** A jar manifest's main attributes, its 72-column continuation lines joined. */
export function manifestFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let last = "";
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line === "") break;
    if (line.startsWith(" ") && last) out[last] += line.slice(1);
    else {
      const at = line.indexOf(": ");
      if (at < 0) continue;
      last = line.slice(0, at);
      out[last] = line.slice(at + 2);
    }
  }
  return out;
}

/**
 * Whether a release verifies: the signature over SHA256SUMS is good by the pinned key the notes
 * name, the eclair-node zip matched the signed sums, its jar names eclair-node at this version,
 * built from the commit the tag names, and that commit is checked out with nothing changed.
 */
export function eclairVerified(input: {
  version: string;
  signature: "good" | "expired" | "bad";
  zip: { sha256: string; got: string; short: string } | null;
  manifest: Record<string, string> | null;
  head: string;
  clean: boolean;
}): { checkout: boolean; verified: boolean } {
  const m = input.manifest;
  const checkout =
    input.zip !== null &&
    /^[0-9a-f]{64}$/.test(input.zip.sha256) &&
    input.zip.got === input.zip.sha256 &&
    m !== null &&
    m["Implementation-Title"] === "eclair-node" &&
    m["Implementation-Version"] === input.version &&
    /^[0-9a-f]{40}$/.test(input.head) &&
    m["Specification-Version"] === input.head &&
    input.head.startsWith(input.zip.short) &&
    input.clean;
  return { checkout, verified: checkout && input.signature === "good" };
}

/** The Maven version Eclair's wrapper pins, from maven-wrapper.properties, or null. */
export function wrapperMaven(properties: string): string | null {
  return (
    /^distributionUrl=\S*\/apache-maven-(\d+\.\d+\.\d+)-bin\.(?:zip|tar\.gz)\s*$/m.exec(
      properties,
    )?.[1] ?? null
  );
}

/** This machine's Temurin build, by Node's name for its architecture. */
export function temurinFile(arch = process.arch): { file: string; sha256: string } {
  if (arch === "x64" || arch === "arm64") return TEMURIN.files[arch];
  throw new Error(`no Temurin build for ${arch}`);
}

/** The threat map's Eclair groups (or the owner's list), in the order the lab knows them. */
export function selectEclairSuites(
  threats: Pick<Threat, "lab">[],
  override?: string[],
): { suites: EclairSuite[]; unknown: string[] } {
  const wanted = new Set<string>();
  const unknown: string[] = [];
  for (const raw of override?.length ? override : threats.flatMap((t) => t.lab)) {
    const t = raw.trim();
    if (!t.startsWith(ECLAIR_PREFIX)) continue;
    const s = t.slice(ECLAIR_PREFIX.length);
    if ((ECLAIR_SUITES as readonly string[]).includes(s)) wanted.add(s);
    else unknown.push(t);
  }
  return { suites: ECLAIR_SUITES.filter((s) => wanted.has(s)), unknown };
}

/** A group is one suite when its last part is a class name (`ZmqWatcherSpec`), else a package. */
const isSuite = (s: EclairSuite) => /^[A-Z]/.test(s.split("/").at(-1) ?? "");

/** Where a group's tests live in the source: its package folder, or its suite's file. */
export const suitePath = (s: EclairSuite): string =>
  `eclair-core/src/test/scala/fr/acinq/eclair/${s}${isSuite(s) ? ".scala" : ""}`;

/** scalatest's selection of a group: every suite in a package, or one suite by its class. */
export const suiteArg = (s: EclairSuite): string =>
  `-D${isSuite(s) ? "suites" : "wildcardSuites"}=fr.acinq.eclair.${s.replaceAll("/", ".")}`;

/**
 * Maven's command line: batch mode, no download progress, every dependency checked against the
 * repository's checksum, the lab's repository, and offline once a release's dependencies are kept.
 */
export function mavenArgv(m2: string, offline: boolean, args: string[]): string[] {
  return [
    "mvn",
    "-B",
    "-ntp",
    "--strict-checksums",
    ...(offline ? ["-o"] : []),
    `-Dmaven.repo.local=${m2}`,
    ...args,
  ];
}

/** One group's tests, as BUILD.md runs tests for a class, in eclair-core alone. */
export function testArgv(m2: string, s: EclairSuite, jobs: number, offline: boolean): string[] {
  return mavenArgv(m2, offline, [
    "-pl",
    "eclair-core",
    "test",
    `-DthreadCount=${jobs}`,
    suiteArg(s),
  ]);
}

/**
 * The environment Maven runs in: the JDK and Maven first on PATH, and HOME, every JVM's user.home
 * and the temporary folder all the lab's. Anything Java, Maven, sbt or Scala the base environment
 * carries is dropped.
 */
export function mavenEnv(
  dirs: { jdk: string; maven: string; home: string; tmp: string },
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const drop = /^(JAVA_|_JAVA_|JDK_|MAVEN_|M2_|SBT_|SCALA_|CLASSPATH$)/;
  return {
    ...Object.fromEntries(Object.entries(base).filter(([k]) => !drop.test(k))),
    PATH: `${path.join(dirs.jdk, "bin")}:${path.join(dirs.maven, "bin")}:${base.PATH ?? "/usr/bin:/bin"}`,
    JAVA_HOME: dirs.jdk,
    HOME: dirs.home,
    XDG_CONFIG_HOME: path.join(dirs.home, ".config"),
    XDG_CACHE_HOME: path.join(dirs.home, ".cache"),
    TMPDIR: dirs.tmp,
    // Java reads user.home from the password file, not HOME; the Scala compiler keeps its bridge
    // under it (~/.sbt) and Maven its settings (~/.m2). Every JVM started here, the forked test
    // runner's too, takes these.
    JAVA_TOOL_OPTIONS: `-Duser.home=${dirs.home} -Djava.io.tmpdir=${dirs.tmp}`,
  };
}

/**
 * Groups whose suites each start a bitcoind of their own and wait on it with fixed timeouts, run
 * one suite at a time: Eclair's pom.xml runs suites in parallel (scalatest's -P, threadCount of
 * them) in the one JVM Maven forks, and each BitcoindService suite starts its bitcoind before its
 * tests and stops it after, so threadCount 1 is one bitcoind at a time. channel/publish is the
 * group: ReplaceableTxPublisherSpec waits 50 s for bitcoind to mine 144 regtest blocks, and with
 * three of its suites side by side on the devbox (load average 48 to 75 on 2026-11-26), 19 and 22
 * of its tests timed out in two runs, and the next test in the same suite then found the
 * timed out test's transactions still in that bitcoind's mempool.
 */
export const ONE_SUITE_AT_A_TIME: readonly EclairSuite[] = ["channel/publish"];

/** How many suites of a group run at once: the lab's jobs, or one for the groups above. */
export function groupJobs(s: EclairSuite, jobs: number): number {
  return ONE_SUITE_AT_A_TIME.includes(s) ? 1 : jobs;
}

/** One test scalatest marked FAILED, with the first line it printed under it. */
export interface ScalatestFailure {
  /** The suite whose recap header it sits under; null when scalatest printed no recap. */
  suite: string | null;
  name: string;
  message: string;
  /** The test waited too long for something, in Akka TestKit's own words (TIMEOUT). */
  timeout: boolean;
}

export interface ScalatestResult {
  /** Whether scalatest printed its summary; none means the build failed or the run was cut off. */
  summary: boolean;
  passed: number;
  failed: number;
  canceled: number;
  ignored: number;
  suites: number;
  aborted: number;
  /** scalatest's own time ("Run completed in 1 minute, 2 seconds."), without Maven's. */
  seconds: number;
  /** Tests that failed and suites that aborted, by name. */
  failedNames: string[];
  /** Each failed test, from the recap scalatest prints after "*** N TESTS FAILED ***". */
  failures: ScalatestFailure[];
  output: string[];
}

/**
 * A timeout, as Akka TestKit words it and scalatest prints it under the failed test: "java.lang.
 * AssertionError: assertion failed: timeout (50 seconds) during expectMsgClass waiting for class
 * org.json4s.JValue". expectMsg, expectMsgType, fishForMessage and the rest all say "timeout
 * (<duration>) during <call>". Nothing else counts: a wrong value, a missing transaction or an
 * exception is a failure like any other.
 */
const TIMEOUT = /^java\.lang\.AssertionError: assertion failed: timeout \(\d+ [a-z]+\) during \S/;

/**
 * The failed tests, from scalatest's recap when it printed one (each failure once, under its
 * suite's name, however the suites' output interleaved while they ran), else from anywhere in
 * the output.
 */
function failuresOf(lines: string[]): ScalatestFailure[] {
  let recap = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (/^\*\*\* \d+ TESTS? FAILED \*\*\*\s*$/.test(lines[i] as string)) {
      recap = i;
      break;
    }
  const from = recap >= 0 ? lines.slice(recap + 1) : lines;
  const out: ScalatestFailure[] = [];
  const seen = new Set<string>();
  let suite: string | null = null;
  from.forEach((l, i) => {
    const header = recap >= 0 ? /^([A-Za-z_$][\w$]*):\s*$/.exec(l)?.[1] : undefined;
    if (header) {
      suite = header;
      return;
    }
    const name = /^- (.+?) \*\*\* FAILED \*\*\*/.exec(l.trim())?.[1];
    if (!name) return;
    const message =
      from
        .slice(i + 1)
        .find((x) => x.trim())
        ?.trim() ?? "";
    const key = `${suite ?? ""}\n${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ suite, name, message, timeout: TIMEOUT.test(message) });
  });
  return out;
}

/**
 * The failures that are not timeouts but come right after one: in scalatest's recap order, the
 * failure before each of them in the same suite timed out. Tests in a suite share its bitcoind, so
 * a test that timed out mining leaves its transactions in the mempool for the next one, which then
 * finds one more than it expects (channel/publish on 2026-11-26: "had size 2 instead of expected
 * size 1" right after "htlc tx feerate too low, adding multiple wallet inputs" timed out).
 */
export function afterTimeouts(p: ScalatestResult): ScalatestFailure[] {
  return p.failures.filter((f, i) => {
    if (f.timeout || f.suite === null) return false;
    const before = p.failures.slice(0, i).findLast((x) => x.suite === f.suite);
    return before?.timeout === true;
  });
}

/**
 * Whether a group failed only because tests timed out, and the tests the timeouts left behind, by
 * scalatest's own account: it printed its summary, no suite aborted, every failed test it counted
 * is one it printed, at least one timed out, and every other one comes right after a timed out
 * test in its suite (`afterTimeouts`). A failure first in its suite, or in a suite with no
 * timeout, or anything less certain, is a failure like any other.
 */
export function rerunnable(p: ScalatestResult): boolean {
  if (!p.summary || p.aborted !== 0 || p.failed === 0 || p.failures.length !== p.failed)
    return false;
  const timeouts = p.failures.filter((f) => f.timeout).length;
  return timeouts > 0 && timeouts + afterTimeouts(p).length === p.failed;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** "1 hour, 2 minutes, 3 seconds, 450 milliseconds" in seconds. */
function runTime(text: string): number {
  const unit: Record<string, number> = { hour: 3600, minute: 60, second: 1, millisecond: 0.001 };
  let s = 0;
  for (const m of text.matchAll(/(\d+) (hour|minute|second|millisecond)s?/g))
    s += Number(m[1]) * (unit[m[2] as string] ?? 0);
  return Math.round(s * 10) / 10;
}

/**
 * One group's result from Maven's output: scalatest's summary (the last one, since one module
 * runs), each test it marked FAILED and each suite it ABORTED.
 */
export function parseScalatest(output: string): ScalatestResult {
  const text = output.replace(ANSI, "");
  const lines = text.split("\n");
  const last = <T>(re: RegExp, f: (m: RegExpExecArray) => T): T | null => {
    const all = [...text.matchAll(new RegExp(re.source, "gm"))];
    const m = all.at(-1);
    return m ? f(m as RegExpExecArray) : null;
  };
  const tests = last(
    /^Tests: succeeded (\d+), failed (\d+), canceled (\d+), ignored (\d+), pending \d+\s*$/,
    (m) => m.slice(1, 5).map(Number),
  );
  const suites = last(/^Suites: completed (\d+), aborted (\d+)\s*$/, (m) =>
    m.slice(1, 3).map(Number),
  );
  const seconds = last(/^Run completed in (.+)\.\s*$/, (m) => runTime(m[1] as string)) ?? 0;
  const failedNames = [
    ...new Set(
      lines.flatMap((l) => {
        const t = /^- (.+) \*\*\* FAILED \*\*\*/.exec(l.trim())?.[1];
        if (t) return [t];
        const a = /suite with class name: (\S+) \*\*\* ABORTED \*\*\*/.exec(l)?.[1];
        return a ? [`${a} (aborted)`] : [];
      }),
    ),
  ];
  const first = lines.findIndex((l) => /\*\*\* (FAILED|ABORTED) \*\*\*/.test(l));
  return {
    summary: tests !== null && suites !== null,
    passed: tests?.[0] ?? 0,
    failed: tests?.[1] ?? 0,
    canceled: tests?.[2] ?? 0,
    ignored: tests?.[3] ?? 0,
    suites: suites?.[0] ?? 0,
    aborted: suites?.[1] ?? 0,
    seconds,
    failedNames,
    failures: failuresOf(lines),
    output: first >= 0 ? lines.slice(first) : lines,
  };
}

/** One group's record: the attempt that counts, and the first one when it ran twice. */
export interface EclairGroup {
  name: string;
  ok: boolean;
  exit: number | null;
  seconds: number;
  wall: number;
  /** Suites at once (scalatest's threadCount). */
  jobs: number;
  passed: number;
  suites: number;
  failed: string[];
  timeouts: number;
  ignored: number;
  canceled: number;
  tail: string;
  /** Why the group ran a second time, alone, and what the first attempt gave. */
  rerun?: {
    reason: string;
    first: {
      exit: number | null;
      seconds: number;
      wall: number;
      jobs: number;
      passed: number;
      failed: string[];
      timeouts: number;
      /** Failures right after a timed out test in the same suite (`afterTimeouts`). */
      afterTimeouts: number;
    };
  };
}

/** One attempt at a group: its suites `jobs` at a time, alone on the box's pool when `solo`. */
export type GroupAttempt = (
  jobs: number,
  solo: boolean,
  log: string,
) => Promise<{ exit: number | null; seconds: number; output: string }>;

const passedAll = (r: { exit: number | null }, p: ScalatestResult) =>
  r.exit === 0 && p.summary && p.failed === 0 && p.aborted === 0;

const failedList = (p: ScalatestResult) =>
  p.failures.length
    ? p.failures.map((f) => (f.suite ? `${f.suite}: ${f.name}` : f.name))
    : p.failedNames;

/**
 * Runs one group. A group whose suites ran no test is missing (null). A group whose failures are
 * timeouts and the tests right after them (`rerunnable`) runs once more, alone and one suite at a
 * time, and that second attempt is the result: it must run every test the first did and pass them
 * all. The first is kept beside it and the reason goes on the public test. Any other failure, or
 * any failure on the second attempt, fails the group.
 */
export async function runGroup(
  s: EclairSuite,
  jobs: number,
  attempt: GroupAttempt,
  log: (line: string) => void,
): Promise<{ test: LabTest; group: EclairGroup } | null> {
  const name = `${ECLAIR_PREFIX}${s}`;
  const j = groupJobs(s, jobs);
  const r = await attempt(j, false, "");
  const p = parseScalatest(r.output);
  if (r.exit === 0 && p.summary && p.passed === 0 && p.failed === 0 && p.aborted === 0) return null;
  const said = (x: ScalatestResult, at: number, wall: number, exit: number | null) =>
    `${x.passed} of ${x.passed + x.failed} tests passed in ${x.suites} ${x.suites === 1 ? "suite" : "suites"} ${at} at a time, ${x.ignored} ignored, in ${x.seconds} s (${wall} s with Maven)${exit === 0 ? "" : `, exit ${exit}`}`;
  const timeouts = (x: ScalatestResult) => x.failures.filter((f) => f.timeout).length;
  let counted = { r, p, jobs: j };
  let rerun: EclairGroup["rerun"];
  if (!passedAll(r, p) && rerunnable(p)) {
    const words = [
      ...new Set(
        p.failures.flatMap((f) => /timeout \(\d+ [a-z]+\) during \S+/.exec(f.message)?.[0] ?? []),
      ),
    ].join(", ");
    const after = afterTimeouts(p).length;
    const more = after
      ? ` and ${after} more failed right after a timed out test in the same suite`
      : "";
    const reason = `The first attempt, ${j} ${j === 1 ? "suite" : "suites"} at a time, failed because ${timeouts(p)} of ${p.passed + p.failed} tests timed out (${words})${more}, so the group ran once more, alone, one suite at a time.`;
    log(
      `lab: ${name}: ${said(p, j, r.seconds, r.exit)}; ${timeouts(p)} timed out (${words})${after ? `, and each of the other ${after} came right after one in its suite` : ""}`,
    );
    log(`lab: ${name}: running it once more, alone, one suite at a time`);
    const r2 = await attempt(1, true, ".rerun");
    const p2 = parseScalatest(r2.output);
    rerun = {
      reason,
      first: {
        exit: r.exit,
        seconds: p.seconds,
        wall: r.seconds,
        jobs: j,
        passed: p.passed,
        failed: failedList(p),
        timeouts: timeouts(p),
        afterTimeouts: afterTimeouts(p).length,
      },
    };
    counted = { r: r2, p: p2, jobs: 1 };
  }
  const c = counted;
  // A second attempt counts only when it ran every test the first did and passed them all.
  const ok = passedAll(c.r, c.p) && c.p.passed > 0 && (!rerun || c.p.passed >= p.passed + p.failed);
  const group: EclairGroup = {
    name,
    ok,
    exit: c.r.exit,
    seconds: c.p.seconds,
    wall: c.r.seconds,
    jobs: c.jobs,
    passed: c.p.passed,
    suites: c.p.suites,
    failed: failedList(c.p),
    timeouts: timeouts(c.p),
    ignored: c.p.ignored,
    canceled: c.p.canceled,
    tail: ok ? "" : tailOf(c.p.output, 60),
    ...(rerun ? { rerun } : {}),
  };
  const names = c.p.failedNames;
  log(
    `lab: ${name} ${ok ? "passed" : `FAILED${names.length ? ` (${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""})` : ""}`}${rerun ? " on its second attempt" : ""}: ${said(c.p, c.jobs, c.r.seconds, c.r.exit)}`,
  );
  return {
    test: { name, ok, seconds: c.p.seconds, ...(rerun ? { rerun: rerun.reason } : {}) },
    group,
  };
}

// ---------------------------------------------------------------------------------------------
// Verify, get the toolchain, build, test

/** What the owner sees of an Eclair run, privately. */
export interface EclairRecord {
  tag: string;
  /** The commit checked out, which the signed zip must name. */
  commit: string | null;
  notes: { keyId: string | null; jdk: string | null };
  key: { fingerprint: string; name: string; from: string | null } | null;
  signature: { state: "good" | "expired" | "bad"; exit: number | null; status: string } | null;
  zip: { file: string; sha256: string; got: string | null } | null;
  manifest: Record<string, string> | null;
  checkout: boolean;
  jdk: { version: string; file: string; sha256: string; signature: string } | null;
  maven: {
    version: string;
    file: string;
    sha512: string;
    signature: string;
    wrapper: string | null;
  } | null;
  /** The dependency set: files resolved, the SHA-256 of their list, and when it was resolved. */
  resolved: { files: number; sha256: string; resolved: string } | null;
  commands: string[];
  build: { exit: number | null; seconds: number; tail: string } | null;
  /** The eclair-node zip the build made, against the signed one. */
  reproduced: { file: string; sha256: string | null; match: boolean } | null;
  groups: EclairGroup[];
}

export interface EclairRun {
  /** The signed zip matched the signed sums and names the commit checked out. */
  sha256: boolean;
  signatures: number | null;
  signers: number | null;
  verified: boolean;
  tests: LabTest[];
  missing: string[];
  record: EclairRecord;
}

const tailOf = (text: string[] | string, lines: number) =>
  (Array.isArray(text) ? text : text.split("\n")).slice(-lines).join("\n");

const git = (args: string[], cwd?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", timeout: 600_000 });

function sha512File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha512");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

const gpgIn = (gnupg: string, args: string[], stdin?: Buffer) =>
  spawnSync("gpg", ["--homedir", gnupg, "--batch", "--no-tty", ...args], {
    input: stdin,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * One key by its fingerprint, from the first address that has it, into a keyring of its own; then
 * only the key with that fingerprint into `gnupg`. The address it came from, or null.
 */
async function importKey(
  fingerprint: string,
  urls: readonly string[],
  gnupg: string,
  dl: string,
): Promise<string | null> {
  for (const [i, url] of urls.entries()) {
    const file = path.join(dl, `${fingerprint}.${i}.asc`);
    const untrusted = path.join(gnupg, `${fingerprint}.${i}.pgp-untrusted`);
    rmSync(file, { force: true });
    rmSync(untrusted, { force: true });
    if (!(await download(url, file, { optional: true }).catch(() => false))) continue;
    gpgIn(gnupg, ["--no-default-keyring", "--keyring", untrusted, "--import", file]);
    const key = gpgIn(gnupg, [
      "--no-default-keyring",
      "--keyring",
      untrusted,
      "--export",
      fingerprint,
    ]).stdout;
    if (key?.length && gpgIn(gnupg, ["--import"], key).status === 0) return url;
  }
  return null;
}

/** A fresh keyring folder; its agent is stopped by `stopAgent`. */
function freshKeyring(dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const stopAgent = (gnupg: string) =>
  spawnSync("gpgconf", ["--homedir", gnupg, "--kill", "all"], { stdio: "ignore", timeout: 30_000 });

/** A detached signature over a file, checked with one key alone: good, expired or bad. */
function verifyDetached(gnupg: string, sig: string, file: string, fingerprint: string) {
  const v = gpgIn(gnupg, ["--status-fd", "1", "--verify", sig, file]);
  return signatureState(v.stdout?.toString("utf8") ?? "", fingerprint, v.status);
}

/**
 * The JDK and Maven, each checked three ways before it is unpacked into <javaDir>; reused when the
 * folder is there and its stamp names the same files and hashes.
 */
async function toolchain(
  javaDir: string,
  log: (line: string) => void,
): Promise<{
  jdk: string;
  maven: string;
  jdkRec: EclairRecord["jdk"];
  mavenRec: Omit<NonNullable<EclairRecord["maven"]>, "wrapper">;
}> {
  const dl = path.join(javaDir, "dl");
  mkdirSync(dl, { recursive: true });
  const t = temurinFile();
  const stampFile = path.join(javaDir, ".stamp");
  const stampText = `${t.sha256}  ${t.file}\n${MAVEN.sha512}  ${MAVEN.file}\n`;
  const jdkRoot = path.join(javaDir, `jdk-${TEMURIN.version}`);
  const mavenRoot = path.join(javaDir, `apache-maven-${MAVEN.version}`);
  const jdkRec = { version: TEMURIN.version, file: t.file, sha256: t.sha256, signature: "" };
  const mavenRec = {
    version: MAVEN.version,
    file: MAVEN.file,
    sha512: MAVEN.sha512,
    signature: "",
  };
  if (
    existsSync(path.join(jdkRoot, "bin", "java")) &&
    existsSync(path.join(mavenRoot, "bin", "mvn")) &&
    existsSync(stampFile) &&
    readFileSync(stampFile, "utf8") === stampText
  ) {
    log(`lab: Temurin ${TEMURIN.version} and Maven ${MAVEN.version} already unpacked`);
    const kept = "checked when unpacked (stamp matches)";
    return {
      jdk: jdkRoot,
      maven: mavenRoot,
      jdkRec: { ...jdkRec, signature: kept },
      mavenRec: { ...mavenRec, signature: kept },
    };
  }
  rmSync(stampFile, { force: true });
  const gnupg = freshKeyring(path.join(javaDir, "gnupg"));
  try {
    // Temurin: the pinned SHA-256, the release's .sha256.txt, and its .sig by Adoptium's key.
    const base = `${TEMURIN_DL}/${encodeURIComponent(`jdk-${TEMURIN.version}`)}/${t.file}`;
    const tarball = path.join(dl, t.file);
    for (const ext of [".sha256.txt", ".sig"]) {
      rmSync(`${tarball}${ext}`, { force: true });
      await download(`${base}${ext}`, `${tarball}${ext}`);
    }
    if (parseSums(readFileSync(`${tarball}.sha256.txt`, "utf8")).get(t.file) !== t.sha256)
      throw new Error(`${t.file}: Adoptium's .sha256.txt does not say ${t.sha256}`);
    if (!existsSync(tarball) || (await sha256File(tarball)) !== t.sha256) {
      log(`lab: downloading ${t.file}`);
      await download(base, tarball);
    }
    const got = await sha256File(tarball);
    if (got !== t.sha256) {
      rmSync(tarball, { force: true });
      throw new Error(`${t.file} did not match its SHA-256 (${got})`);
    }
    // Adoptium's page says keyserver.ubuntu.com; keys.openpgp.org when it has none.
    const adoptium = await importKey(TEMURIN.key, [...keyUrls(TEMURIN.key)].reverse(), gnupg, dl);
    if (!adoptium) throw new Error("no keyserver had Adoptium's key");
    const jdkSig = verifyDetached(gnupg, `${tarball}.sig`, tarball, TEMURIN.key);
    if (jdkSig !== "good") throw new Error(`${t.file}: its signature by Adoptium is ${jdkSig}`);
    jdkRec.signature = `good, by ${TEMURIN.key} (from ${adoptium})`;

    // Maven: the pinned SHA-512, Apache's .sha512, and its .asc by the key from Maven's KEYS.
    const mvn = path.join(dl, MAVEN.file);
    for (const ext of [".sha512", ".asc"]) {
      rmSync(`${mvn}${ext}`, { force: true });
      await download(`${MAVEN_DL}/${MAVEN.file}${ext}`, `${mvn}${ext}`);
    }
    const published = readFileSync(`${mvn}.sha512`, "utf8").trim().split(/\s+/)[0];
    if (published !== MAVEN.sha512)
      throw new Error(`${MAVEN.file}: Apache's .sha512 does not say the pinned SHA-512`);
    if (!existsSync(mvn) || (await sha512File(mvn)) !== MAVEN.sha512) {
      log(`lab: downloading ${MAVEN.file}`);
      await download(`${MAVEN_DL}/${MAVEN.file}`, mvn);
    }
    const got512 = await sha512File(mvn);
    if (got512 !== MAVEN.sha512) {
      rmSync(mvn, { force: true });
      throw new Error(`${MAVEN.file} did not match its SHA-512`);
    }
    const keys = await importKey(MAVEN.key, [MAVEN_KEYS], gnupg, dl);
    if (!keys) throw new Error("Apache Maven's KEYS does not hold the release manager's key");
    const mvnSig = verifyDetached(gnupg, `${mvn}.asc`, mvn, MAVEN.key);
    if (mvnSig !== "good") throw new Error(`${MAVEN.file}: its signature is ${mvnSig}`);
    mavenRec.signature = `good, by ${MAVEN.key} (from ${keys})`;
  } finally {
    stopAgent(gnupg);
    rmSync(gnupg, { recursive: true, force: true });
  }

  for (const [archive, root] of [
    [path.join(dl, t.file), jdkRoot],
    [path.join(dl, MAVEN.file), mavenRoot],
  ] as const) {
    rmSync(root, { recursive: true, force: true });
    const x = path.join(javaDir, "x");
    rmSync(x, { recursive: true, force: true });
    renameSync(extract(archive, x), root);
    rmSync(x, { recursive: true, force: true });
  }
  writeFileSync(stampFile, stampText);
  log(
    `lab: Temurin ${TEMURIN.version} and Maven ${MAVEN.version} unpacked; each matched its pinned and published hash and its signature`,
  );
  return { jdk: jdkRoot, maven: mavenRoot, jdkRec, mavenRec };
}

/**
 * Every file of the resolved dependencies, by path in the repository, sorted: the jars, poms and
 * archives, and the download plugin's cached bitcoind (`<name>.tar.gz_<hash>`); never Eclair's own
 * artifacts, which each build installs anew.
 */
export function resolvedFiles(m2: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (r !== "fr/acinq/eclair") walk(path.join(d, e.name), r);
      } else if (e.isFile() && /\.(jar|pom|tar\.gz|zip)(_[0-9a-f]+)?$/.test(e.name)) out.push(r);
    }
  };
  if (existsSync(m2)) walk(m2, "");
  return out.sort();
}

/** The SHA-256 list of the resolved files, as `sha256sum` writes it. */
async function resolvedList(m2: string): Promise<string> {
  const lines: string[] = [];
  for (const f of resolvedFiles(m2)) lines.push(`${await sha256File(path.join(m2, f))}  ${f}`);
  return `${lines.join("\n")}\n`;
}

const sha256Text = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The release's notes, from GitHub's API. The lab reads only the key id and the JDK they name, and
 * the key id counts only when it names a pinned key.
 */
async function releaseNotes(tag: string): Promise<string> {
  const res = await fetch(`${NOTES_API}/${tag}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Eclair's release notes for ${tag}: HTTP ${res.status}`);
  const body = ((await res.json()) as { body?: unknown }).body;
  if (typeof body !== "string") throw new Error(`Eclair's release ${tag} has no notes`);
  return body;
}

/**
 * One Eclair release: verify the signed sums, the zip and the commit inside it, and only then get
 * the JDK and Maven, build the release and run each group. Throws when the lab itself cannot run
 * (a clone, a download, a toolchain check, a changed dependency); what Eclair's release does is in
 * what it returns.
 */
export async function runEclair(input: {
  version: string;
  /** <lab>/eclair/<version>: the source, the keys, the downloads, the Maven repository, each run. */
  dir: string;
  /** <lab>/java: the JDK and Maven, shared by every release. */
  javaDir: string;
  home: string;
  suites: readonly EclairSuite[];
  jobs: number;
  env: NodeJS.ProcessEnv;
  runId: string;
  log: (line: string) => void;
}): Promise<EclairRun> {
  const { version, dir, log } = input;
  if (!RELEASE_VERSION.eclair.test(version)) throw new Error(`${version} is not an Eclair release`);
  const tag = `v${version}`;
  const record: EclairRecord = {
    tag,
    commit: null,
    notes: { keyId: null, jdk: null },
    key: null,
    signature: null,
    zip: null,
    manifest: null,
    checkout: false,
    jdk: null,
    maven: null,
    resolved: null,
    commands: [],
    build: null,
    reproduced: null,
    groups: [],
  };
  mkdirSync(dir, { recursive: true });

  // The source at the tag, and the key the notes name.
  const src = path.join(dir, "src");
  rmSync(src, { recursive: true, force: true });
  git(["clone", "-q", "--depth", "1", "--branch", tag, ECLAIR_REPO, src]);
  record.commit = git(["rev-parse", "HEAD"], src).trim();
  record.notes = readNotes(await releaseNotes(tag));
  const key = pinnedKey(record.notes.keyId);
  log(
    `lab: Eclair ${tag} is commit ${record.commit}; its notes name signing key ${record.notes.keyId ?? "none"}${key ? `, ${key.name}'s ${key.fingerprint}` : ", which is not a key the lab pins"}`,
  );

  const dl = path.join(dir, "dl");
  const keys = path.join(dir, "keys");
  mkdirSync(dl, { recursive: true });
  rmSync(keys, { recursive: true, force: true });
  mkdirSync(keys, { recursive: true });
  const gnupg = freshKeyring(path.join(dir, "gnupg"));
  let state: "good" | "expired" | "bad" = "bad";
  let signed = "";
  try {
    if (key) {
      const from = await importKey(
        key.fingerprint,
        [key.url, ...keyUrls(key.fingerprint)],
        gnupg,
        keys,
      );
      record.key = { fingerprint: key.fingerprint, name: key.name, from };
      const asc = path.join(dl, "SHA256SUMS.asc");
      const stripped = path.join(dl, "SHA256SUMS.stripped");
      for (const f of [asc, stripped]) rmSync(f, { force: true });
      await download(`${RELEASE_FILES}/${tag}/SHA256SUMS.asc`, asc);
      // As the notes do (`gpg -d SHA256SUMS.asc > SHA256SUMS.stripped`): what gpg writes out is
      // what the signature covers, and only that is read.
      const v = gpgIn(gnupg, ["--status-fd", "1", "--output", stripped, "--decrypt", asc]);
      const status = v.stdout?.toString("utf8") ?? "";
      state = from ? signatureState(status, key.fingerprint, v.status) : "bad";
      record.signature = { state, exit: v.status, status };
      if (state === "good") signed = readFileSync(stripped, "utf8");
    }
  } finally {
    stopAgent(gnupg);
  }
  const zip = nodeZip(parseSums(signed), version);
  let got: string | null = null;
  if (zip) {
    const file = path.join(dl, zip.file);
    if (!existsSync(file) || (await sha256File(file)) !== zip.sha256) {
      log(`lab: downloading ${zip.file}`);
      rmSync(file, { force: true });
      await download(`${RELEASE_FILES}/${tag}/${zip.file}`, file);
    }
    got = await sha256File(file);
    record.zip = { file: zip.file, sha256: zip.sha256, got };
    if (got === zip.sha256) {
      // Read in place, never extracted: the jar, then its manifest.
      const entry = nodeJar(
        execFileSync("unzip", ["-Z1", file], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
        zip.file,
        version,
      );
      if (!entry) throw new Error(`${zip.file} does not hold one eclair-node jar`);
      const jar = execFileSync("unzip", ["-p", file, entry], { maxBuffer: 64 * 1024 * 1024 });
      const jarFile = path.join(dl, "eclair-node.jar");
      writeFileSync(jarFile, jar);
      record.manifest = manifestFields(
        execFileSync("unzip", ["-p", jarFile, "META-INF/MANIFEST.MF"], { encoding: "utf8" }),
      );
      rmSync(jarFile, { force: true });
    }
  }
  const clean = git(["status", "--porcelain"], src).trim() === "";
  const check = eclairVerified({
    version,
    signature: state,
    zip: zip && got ? { sha256: zip.sha256, got, short: zip.short } : null,
    manifest: record.manifest,
    head: record.commit,
    clean,
  });
  record.checkout = check.checkout;
  log(
    `lab: SHA256SUMS.asc's signature is ${state}${key && state === "good" ? `, by ${key.name} (${key.fingerprint})` : ""}; ${zip ? `${zip.file} ${got === zip.sha256 ? "matched it" : "DID NOT match it"}` : "it lists no eclair-node zip"}; ${check.checkout ? "the jar inside names the commit checked out" : "the zip DOES NOT name the commit checked out"}`,
  );
  const out = {
    sha256: check.checkout,
    signatures: key ? (state === "good" ? 1 : 0) : 0,
    signers: record.key?.from ? 1 : 0,
    record,
  };
  if (!check.verified) return { ...out, verified: false, tests: [], missing: [] };

  // Verified: the groups this release has, the toolchain, then the build.
  const missing = input.suites
    .filter((s) => !existsSync(path.join(src, suitePath(s))))
    .map((s) => `${ECLAIR_PREFIX}${s}`);
  const suites = input.suites.filter((s) => !missing.includes(`${ECLAIR_PREFIX}${s}`));
  if (!suites.length) return { ...out, verified: true, tests: [], missing };

  const tc = await toolchain(input.javaDir, log);
  record.jdk = tc.jdkRec;
  const wrapper = wrapperMaven(
    readFileSync(path.join(src, ".mvn", "wrapper", "maven-wrapper.properties"), "utf8"),
  );
  record.maven = { ...tc.mavenRec, wrapper };
  if (wrapper !== MAVEN.version)
    log(
      `lab: Eclair's wrapper pins Maven ${wrapper ?? "nothing the lab reads"}; the lab builds with ${MAVEN.version}`,
    );
  if (record.notes.jdk && !TEMURIN.version.startsWith(`${record.notes.jdk}+`))
    log(
      `lab: the notes name JDK ${record.notes.jdk}; the lab builds with Temurin ${TEMURIN.version}`,
    );
  const tmp = path.join(dir, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  for (const d of [tmp, input.home]) mkdirSync(d, { recursive: true });
  const env = mavenEnv({ jdk: tc.jdk, maven: tc.maven, home: input.home, tmp }, input.env);

  // The dependencies: resolved online at the release's first run, checked and offline after.
  const m2 = path.join(dir, "m2");
  const keptList = path.join(dir, "resolved.sha256");
  const kept = existsSync(keptList);
  if (kept) {
    const want = readFileSync(keptList, "utf8");
    const now = await resolvedList(m2);
    if (now !== want) {
      const a = new Set(want.split("\n"));
      const changed = now
        .split("\n")
        .filter((l) => l && !a.has(l))
        .slice(0, 3);
      throw new Error(
        `the dependencies kept for Eclair ${version} changed: ${changed.join("; ") || "files are missing"}`,
      );
    }
    log(
      `lab: ${want.split("\n").filter(Boolean).length} dependency files kept from this release's first run, each checked`,
    );
  }

  const runs = path.join(dir, "runs");
  mkdirSync(runs, { recursive: true });
  const buildArgv = mavenArgv(m2, kept, ["clean", "install", "-DskipTests"]);
  record.commands.push(buildArgv.join(" "));
  const b = await step(buildArgv, {
    cwd: src,
    log: path.join(runs, `${input.runId}.build.log`),
    limit: BUILD_LIMIT_S,
    env,
  });
  record.build = {
    exit: b.exit,
    seconds: b.seconds,
    tail: b.exit === 0 ? "" : tailOf(b.output, 60),
  };
  log(
    `lab: Eclair ${version} ${b.exit === 0 ? "built" : `FAILED to build (exit ${b.exit})`} in ${b.seconds} s`,
  );
  if (b.exit === 0) {
    const built = path.join(src, "eclair-node", "target", zip?.file ?? "");
    const sha = zip && existsSync(built) ? await sha256File(built) : null;
    record.reproduced = {
      file: zip?.file ?? "",
      sha256: sha,
      match: sha !== null && sha === zip?.sha256,
    };
    log(
      `lab: the eclair-node zip it built ${record.reproduced.match ? "is byte for byte the one ACINQ signed" : `differs from the signed one (${sha ?? "none built"})`}`,
    );
  }

  const tests: LabTest[] = [];
  for (const s of suites) {
    // The first run resolves what the tests need too, so its groups run online.
    const attempt: GroupAttempt = async (jobs, solo, suffix) => {
      if (b.exit !== 0) return { exit: b.exit, seconds: 0, output: b.output };
      const argv = testArgv(m2, s, jobs, kept);
      record.commands.push(`${solo ? "(alone) " : ""}${argv.join(" ")}`);
      return step(argv, {
        cwd: src,
        log: path.join(runs, `${input.runId}.${s.replaceAll("/", "_")}${suffix}.log`),
        limit: GROUP_LIMIT_S,
        env,
        solo,
      });
    };
    const g = await runGroup(s, input.jobs, attempt, log);
    if (!g) {
      missing.push(`${ECLAIR_PREFIX}${s}`);
      continue;
    }
    tests.push(g.test);
    record.groups.push(g.group);
  }

  if (!kept && b.exit === 0) {
    const list = await resolvedList(m2);
    writeFileSync(keptList, list);
  }
  const list = existsSync(keptList) ? readFileSync(keptList, "utf8") : "";
  record.resolved = {
    files: list.split("\n").filter(Boolean).length,
    sha256: sha256Text(list),
    resolved: kept ? "kept from this release's first run" : "resolved at this run, online",
  };
  return { ...out, verified: true, tests, missing };
}

/**
 * Removes what a run leaves that the next one does not need: the source's build output, the
 * Maven repository and the signed zip are kept.
 */
export function tidyEclair(dir: string): void {
  for (const d of ["tmp", "gnupg", "keys"])
    rmSync(path.join(dir, d), { recursive: true, force: true });
}
