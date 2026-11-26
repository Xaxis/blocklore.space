// Core Lightning in the lab (BACKLOG 40): the third Lightning implementation, after LND and LDK. For
// Core Lightning's newest release the lab checks the release's source zip the way its own
// doc/getting-started/advanced-setup/repro.md says to ("Verifying a reproducible build"), builds
// every tool and library the build needs that this machine lacks from its publisher's own signed
// or hashed release into the lab's own folder (never sudo, never a system package), builds that
// release's own C unit tests from the verified zip, and runs the groups of them whose tests
// exercise a defense the threat map lists. Each group is one lab test, `cln/<group>`, in Core
// Lightning's own run, through the disclosure gate like any other.
//
// Verification. Each release publishes clightning-v<version>.zip (the source, with its submodules),
// SHA256SUMS-v<version> and SHA256SUMS-v<version>.asc, the maintainers' detached signatures over
// the sums. repro.md: `gpg --verify SHA256SUMS.asc`, where "If there are any issues gpg will print
// Bad signature ... a failure here means that the verification failed", then `sha256sum -c
// SHA256SUMS`. It names no minimum count and no list of keys; SECURITY.md does ("The following keys
// may be used ... to validate signatures on releases", a table of names and fingerprints). So the
// lab:
//   fetches the repository at the release tag, without its files (git checks every object's hash as
//     it arrives), and reads SECURITY.md's table at the tag and at the release before it, counting
//     only a key both list, so a release cannot vouch for a key it adds itself;
//   takes each counted key's material from contrib/keys/ at the tag, and from keys.openpgp.org and
//     keyserver.ubuntu.com by its fingerprint (SECURITY.md: "gpg --keyserver hkps://keys.openpgp.org
//     --recv-keys"), all into a keyring of its own, then exports only the key with that fingerprint
//     into the keyring the sums are checked against, so no file or keyserver can put another key
//     in its place, and an expiry its owner extended since is seen;
//   reads gpg's status for each signature in the file: good (GOODSIG, VALIDSIG naming a counted key
//     as the primary key), expired (EXPKEYSIG), bad (BADSIG, a revoked key, an expired signature,
//     or an error other than a missing key), or unknown (a key it was not given);
//   checks the zip's SHA-256 against SHA256SUMS-v<version>.
// The release verifies when the zip matches, no signature is bad, and at least one is good by a
// counted key. `signatures` is the good ones, `signers` the counted keys the file was checked
// against. Nothing is extracted before that. What this does not check: that a key is its named
// maintainer's beyond SECURITY.md saying so (two releases running), and the binaries, which the lab
// does not use.
//
// The tools the build needs. The zip ships no generated configure for libwally-core, whose
// tools/autogen.sh runs autoreconf; the wire code is generated with Mako; the wallet's SQL is
// extracted with gettext's xgettext; configure stops without lowdown (the man pages) and without
// the headers of libsodium, SQLite and zlib (this machine has their runtime libraries, not their
// headers). Each comes from its publisher's own release, pinned below with the SHA-256 the lab
// first saw and checked the way its publisher documents: the GNU tools (m4, autoconf, automake,
// libtool, gettext) by their .sig against the maintainer's key in the GNU
// keyring (ftp.gnu.org/gnu/gnu-keyring.gpg), refreshed by fingerprint from the keyservers; zlib by
// its .asc against Mark Adler's key; libsodium by its minisign signature against the key
// doc.libsodium.org publishes (checked here with Node's own Ed25519 and BLAKE2b-512, as minisign
// does); SQLite by the SHA3-256 its download page lists; lowdown by the SHA-512 its author's site
// lists. A mismatch anywhere and nothing is built. Each is built with ./configure --prefix=<the
// lab's folder>, libsodium and zlib static and SQLite shared too (see its entry), so nothing outside
// the lab is installed, and the only library the test programs load from it is the lab's. lowdown is
// 1.4.0, its newest release that GNU make builds (2.0 and later need BSD make). Mako and MarkupSafe
// are installed with uv into a virtual environment of the release's own, at the versions and with
// only the hashes the release's uv.lock (inside the verified zip) pins, `--require-hashes --no-deps
// --only-binary :all:`. The prefix keeps each one while its stamp line (archive and configure)
// stays the same (depsToBuild).
//
// The build: `./configure --disable-rust --disable-valgrind CC=<dir>/lab-cc PYTEST=`, where lab-cc
// runs cc with the prefix's headers, libraries and run path (clnCompiler), the Rust plugins need
// cargo and none of the tests here are Rust's, and valgrind is not installed; then `make -j<jobs>` of the test
// programs alone. Each program runs as the Makefile's `unittest/%` rule runs it: from the source
// folder, with BOLTDIR=.tmp.lightningrfc, its standard output discarded, its exit the verdict. A
// group's programs run one after another in one step under `heavy`; the group passes when every one
// exits 0.
//
// Which groups, from Core Lightning's source at v26.06.10:
//   penalties  old-state: common/test/run-key_derive derives the revocation key and the revocation
//              private key (derive_revocation_key, derive_revocation_privkey) from BOLT 3's own
//              key derivation test vectors and checks the two agree: the private key is what a
//              node builds from the per-commitment secret its peer revealed when it revoked a
//              state, and spends that state's outputs with if the peer ever publishes it.
//              wallet/test/run-wallet's test_shachain_crud stores 100 revealed secrets in the
//              compact shachain the database keeps and reads them back unchanged, so they survive
//              a restart; its test_channel_crud keeps the peer's shachain with the channel.
//   channels   lightning-bugs, as every group here: each group's programs are Core Lightning's own
//              checks against bugs in that code. channeld/test/run-commit_tx builds the commitment
//              transactions of BOLT 3's test vectors (Appendix C) and checks them byte for byte;
//              common/test/run-derive_basepoints the basepoints and per-commitment points from a
//              seed; common/test/run-channel_type the channel types peers agree on.
//   htlcs      channeld/test/run-full_channel drives HTLCs through add, commitment_signed,
//              revoke_and_ack, fulfill and fee updates, checking the commitments against BOLT 3's
//              vectors with HTLCs; onchaind/test/run-grind_feerate and run-grind_feerate-bug find
//              the feerate of a peer's HTLC-timeout signature, the second on the transactions of
//              issue 2820, where onchaind once found none.
//   onions     common/test's run-sphinx, run-sphinx-xor_cipher_stream, run-onion-test-vector,
//              run-onion-message-test, run-route_blinding_test, run-route_blinding_onion_test,
//              run-blindedpath_onion and run-blindedpath_enctlv build, peel and fail onions and
//              blinded paths, against the spec's vectors where it has them.
//   gossip     gossipd/test's run-check_channel_announcement, run-extended-info,
//              run-next_block_range and run-txout_failure: announcements checked, range queries
//              answered, channels whose funding output is gone forgotten.
//   Every program named here ran and passed in the run on v26.06.10 the lab published 2026-11-26.
//
// Not mapped, because no unit test here exercises the defense:
//   old-state    beyond the keys and secrets above: the penalty transactions themselves are built
//                by onchaind (handle_their_cheat) and lightningd, and only the Python integration
//                tests (tests/test_closing.py, test_penalty_inhtlc and the rest) broadcast an old
//                state, with bitcoind; onchaind's unit tests are the feerate grinding above.
//   pinning      Core Lightning resolves each revoked output in its own penalty transaction, as
//                BOLT 5 asks because "A previous penalty transaction claiming multiple revoked
//                outputs at once may be blocked from confirming because of a transaction pinning
//                attack" (lightningd/onchain_control.c, handle_onchaind_spend_to_us); only the
//                integration tests exercise it.
//   channel-jamming      no unit test mentions jamming, HTLC endorsement or accountability; the
//                        HTLC limits run-full_channel meets are the protocol's, which slot jamming
//                        fills rather than defends against.
//   replacement-cycling  no unit test gives onchaind or lightningd a mempool: a preimage read from
//                        a mempool spend, or a claim re-broadcast after its spend was replaced, is
//                        tested only with bitcoind.
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  CLN_GROUPS,
  CLN_PREFIX,
  type ClnGroup,
  compareVersions,
  type LabTest,
  RELEASE_VERSION,
  type Threat,
} from "@blocklore/core";
import { countedMaintainers, keyUrls, type LdkMaintainer } from "./ldk.ts";
import { signatureState } from "./lnd.ts";
import { download, extract, parseSums, sha256File } from "./release.ts";
import { step } from "./secp256k1.ts";

export const CLN_REPO = "https://github.com/ElementsProject/lightning";
const CLN_DL = `${CLN_REPO}/releases/download`;
const GNU_KEYRING = "https://ftp.gnu.org/gnu/gnu-keyring.gpg";
const DEP_LIMIT_S = 30 * 60;
const BUILD_LIMIT_S = 60 * 60;
const GROUP_LIMIT_S = 30 * 60;

// ---------------------------------------------------------------------------------------------
// What the build needs, pinned

/** How a dependency's publisher says to check its release. */
export type DepCheck =
  /** A detached OpenPGP signature (`<file>.sig` or `.asc`) by the key with this fingerprint. */
  | { kind: "gpg"; sig: string; fingerprint: string; signer: string; gnu: boolean }
  /** A minisign signature (`<file>.minisig`) by this public key. */
  | { kind: "minisign"; sig: string; key: string }
  /** A digest the publisher's own page lists. */
  | { kind: "sha3-256" | "sha512"; hash: string; listed: string };

export interface ClnDep {
  name: string;
  version: string;
  url: string;
  /** The archive's SHA-256 when the lab first checked it the publisher's way. */
  sha256: string;
  check: DepCheck;
  /** configure's arguments, given the prefix everything installs into. */
  configure: (prefix: string) => string[];
  env?: Record<string, string>;
}

/**
 * Every tool and library the build needs that this machine lacks, in the order they build (each
 * GNU tool needs m4, automake needs autoconf). Read 2026-11-26; each SHA-256 is the archive's when
 * its signature or listed digest checked out that day.
 */
export const CLN_DEPS: readonly ClnDep[] = [
  {
    name: "m4",
    version: "1.4.21",
    url: "https://ftp.gnu.org/gnu/m4/m4-1.4.21.tar.xz",
    sha256: "f25c6ab51548a73a75558742fb031e0625d6485fe5f9155949d6486a2408ab66",
    // Signed 2026-02-06 by Eric Blake's key, in the GNU keyring.
    check: {
      kind: "gpg",
      sig: ".sig",
      fingerprint: "71C2CC22B1C4602927D2F3AAA7A16B4A2527436A",
      signer: "Eric Blake",
      gnu: true,
    },
    configure: (p) => [`--prefix=${p}`],
  },
  {
    name: "autoconf",
    version: "2.73",
    url: "https://ftp.gnu.org/gnu/autoconf/autoconf-2.73.tar.xz",
    sha256: "9fd672b1c8425fac2fa67fa0477b990987268b90ff36d5f016dae57be0d6b52e",
    // Signed 2026-03-20 by Zack Weinberg's key, in the GNU keyring.
    check: {
      kind: "gpg",
      sig: ".sig",
      fingerprint: "82F854F3CE73174B8B63174091FCC32B6769AA64",
      signer: "Zack Weinberg",
      gnu: true,
    },
    configure: (p) => [`--prefix=${p}`],
  },
  {
    name: "automake",
    version: "1.20",
    url: "https://ftp.gnu.org/gnu/automake/automake-1.20.tar.xz",
    sha256: "f6f34dad4cbe395715762b0710f7c511e39bd5cf777e6b95818ccbecf7714248",
    // Signed 2026-11-07 by a subkey of Kamila Szewczyk's key, in the GNU keyring.
    check: {
      kind: "gpg",
      sig: ".sig",
      fingerprint: "6C222EA6B2BD216AA406516AC868F0B6DE38409D",
      signer: "Kamila Szewczyk",
      gnu: true,
    },
    configure: (p) => [`--prefix=${p}`],
  },
  {
    name: "libtool",
    version: "2.6.2",
    url: "https://ftp.gnu.org/gnu/libtool/libtool-2.6.2.tar.xz",
    sha256: "2ef1067c16c97db930fd740cc9bc3d3ba9a583804ae5ac42cc3e8719e49e191e",
    // Signed 2026-07-16 by Ileana Dumitrescu's key. The GNU keyring's copy had expired; the
    // keyservers' copy, which she extended to 2027-02-16, makes the same signature good.
    check: {
      kind: "gpg",
      sig: ".sig",
      fingerprint: "FA26CA784BE188927F22B99F6570EA01146F7354",
      signer: "Ileana Dumitrescu",
      gnu: true,
    },
    configure: (p) => [`--prefix=${p}`],
  },
  {
    // wallet/Makefile extracts the SQL statements with xgettext; the zip ships no
    // wallet/statements_gettextgen.po.
    name: "gettext",
    version: "1.0",
    url: "https://ftp.gnu.org/gnu/gettext/gettext-1.0.tar.xz",
    sha256: "71132a3fb71e68245b8f2ac4e9e97137d3e5c02f415636eb508ae607bc01add7",
    // Signed 2026-01-29 by Bruno Haible's "Free Software Development" key, in the GNU keyring.
    check: {
      kind: "gpg",
      sig: ".sig",
      fingerprint: "E0FFBD975397F77A32AB76ECB6301D9E1BBEAC08",
      signer: "Bruno Haible",
      gnu: true,
    },
    configure: (p) => [
      `--prefix=${p}`,
      "--disable-shared",
      "--disable-java",
      "--disable-csharp",
      "--disable-openmp",
      "--without-emacs",
      "--without-git",
    ],
  },
  {
    name: "libsodium",
    version: "1.0.22",
    url: "https://download.libsodium.org/libsodium/releases/libsodium-1.0.22.tar.gz",
    sha256: "adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349",
    // doc.libsodium.org/installation, "Integrity checking": "Distribution files can be verified
    // with Minisign ... using the following Ed25519 key".
    check: {
      kind: "minisign",
      sig: ".minisig",
      key: "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3",
    },
    configure: (p) => [`--prefix=${p}`, "--disable-shared", "--enable-static", "--with-pic"],
  },
  {
    name: "sqlite",
    version: "3.54.1",
    url: "https://sqlite.org/2026/sqlite-autoconf-3540100.tar.gz",
    sha256: "926ef8d3eab93fbf6e06011901273eec076b25594a4e1cdadd50c987f4f6d64e",
    // sqlite.org/download.html lists each file with its SHA3-256.
    check: {
      kind: "sha3-256",
      hash: "b6ced585c750916b1052667239a12c25a7ff34e7f06e1e6e01ecb0427657d9c4",
      listed: "https://sqlite.org/download.html",
    },
    // Shared as well as static, as SQLite builds by default: Core Lightning's configure links
    // `-lsqlite3` alone, which the static library cannot pass without libm after it. The test
    // programs load the shared one from the lab's prefix, by the run path the build gives them.
    configure: (p) => [`--prefix=${p}`],
  },
  {
    name: "zlib",
    version: "1.4",
    url: "https://zlib.net/zlib-1.4.tar.gz",
    sha256: "02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584",
    // zlib.net links a "GPG signature" beside each archive. It names no fingerprint; the key that
    // makes it is Mark Adler's (uid madler@alumni.caltech.edu on keyserver.ubuntu.com), and his
    // GitHub account lists its key id, 783FCD8E58BCAFBA (github.com/madler.gpg).
    check: {
      kind: "gpg",
      sig: ".asc",
      fingerprint: "5ED46A6721D365587791E2AA783FCD8E58BCAFBA",
      signer: "Mark Adler",
      gnu: false,
    },
    configure: (p) => [`--prefix=${p}`, "--static"],
    env: { CFLAGS: "-O2 -fPIC" },
  },
  {
    name: "lowdown",
    version: "1.4.0",
    url: "https://kristaps.bsd.lv/lowdown/snapshots/lowdown-1.4.0.tar.gz",
    sha256: "75bf8ddc66f6c75ebb64131ced1e729983a38f866a93878fc1753df93330e0ef",
    // kristaps.bsd.lv/lowdown/snapshots/ lists lowdown-1.4.0.tar.gz.sha512 beside it.
    check: {
      kind: "sha512",
      hash: "316b27384f83cb57fa414c315556fd177f2998c009e031986446e82252f276dc68adfeb263b88640deccb7084da4771d0ee8fae7d37388dba4e1a0aa426c701d",
      listed: "https://kristaps.bsd.lv/lowdown/snapshots/lowdown-1.4.0.tar.gz.sha512",
    },
    configure: (p) => [`PREFIX=${p}`],
  },
];

/** The packages the build's Python needs: tools/generate-wire.py imports mako. */
const PYTHON_ROOTS = ["mako"];

/**
 * Which of a release's unit test programs make each group (brain/src/security/cln.ts's header says
 * what each holds), by their path without `.c`.
 */
export const CLN_PROGRAMS: Record<ClnGroup, RegExp> = {
  channels: /^(channeld\/test\/run-commit_tx|common\/test\/run-(derive_basepoints|channel_type))$/,
  htlcs: /^(channeld\/test\/run-full_channel|onchaind\/test\/run-grind_feerate(-bug)?)$/,
  onions:
    /^common\/test\/run-(sphinx|sphinx-xor_cipher_stream|onion-test-vector|onion-message-test|route_blinding_test|route_blinding_onion_test|blindedpath_onion|blindedpath_enctlv)$/,
  gossip: /^gossipd\/test\/run-[A-Za-z0-9_-]+$/,
  penalties: /^(common\/test\/run-key_derive|wallet\/test\/run-wallet)$/,
};

// ---------------------------------------------------------------------------------------------
// Pure pieces (tested in brain/test/cln.test.ts)

/**
 * Core Lightning's final releases from `git ls-remote --tags`, newest first: v26.06.10, and v26.06
 * for a line's first release; never an rc, never a peeled `^{}` line, never the 0.x releases of
 * before it numbered them by year and month.
 */
export function clnReleases(lsRemote: string): string[] {
  const versions = new Set(
    [...lsRemote.matchAll(/refs\/tags\/v(\d{2}\.\d{2}(?:\.\d+)?)$/gm)].map((m) => m[1] as string),
  );
  return [...versions].sort((a, b) => compareVersions(b, a) || b.length - a.length);
}

/** The newest final Core Lightning release, "26.06.10", or null. */
export const newestClnRelease = (lsRemote: string): string | null =>
  clnReleases(lsRemote)[0] ?? null;

/** The final release before `version`, whose SECURITY.md the keys must already be listed in. */
export function previousClnRelease(lsRemote: string, version: string): string | null {
  return clnReleases(lsRemote).find((v) => compareVersions(v, version) < 0) ?? null;
}

/** A release's files, as its GitHub release lists them. */
export const clnFiles = (version: string) => ({
  zip: `clightning-v${version}.zip`,
  sums: `SHA256SUMS-v${version}`,
  sig: `SHA256SUMS-v${version}.asc`,
});

export type ClnKey = LdkMaintainer;

/**
 * The keys SECURITY.md's "Signatures For Releases" table lists, `| Name | email | fingerprint |`
 * with the fingerprint in groups of four, in its order. Each key and each name once; a file that
 * lists none the way the lab reads them is an error, never "no keys".
 */
export function clnReleaseKeys(securityMd: string): ClnKey[] {
  const at = securityMd.search(/^## Signatures For Releases\s*$/m);
  if (at < 0) throw new Error("SECURITY.md has no Signatures For Releases section");
  const section = securityMd.slice(at).split(/\n## /)[0] ?? "";
  const list = [
    ...section.matchAll(/^\|([^|\n]+)\|[^|\n]*\|\s*((?:[0-9A-F]{4}\s+){9}[0-9A-F]{4})\s*\|\s*$/gm),
  ].map((m) => ({
    fingerprint: (m[2] as string).replace(/\s+/g, ""),
    name: (m[1] as string).trim(),
  }));
  if (!list.length) throw new Error("SECURITY.md lists no key the way the lab reads them");
  for (const k of ["fingerprint", "name"] as const)
    if (new Set(list.map((s) => s[k])).size !== list.length)
      throw new Error(`SECURITY.md lists a ${k} twice`);
  return list;
}

export interface SumsSignature {
  /** The key id gpg names, and the primary key's fingerprint when gpg could check it. */
  keyid: string;
  fingerprint: string | null;
  state: "good" | "expired" | "bad" | "unknown";
}

/**
 * Each signature in a file of several, from gpg's status (`--status-fd`), which begins each with
 * NEWSIG: good (GOODSIG and VALIDSIG), expired (EXPKEYSIG: good, by a key past its expiry), unknown
 * (ERRSIG with NO_PUBKEY: a key gpg was not given), or bad (anything else: BADSIG, a revoked key,
 * an expired signature, any other error).
 */
export function sumsSignatures(status: string): SumsSignature[] {
  const blocks: string[][] = [];
  for (const line of status.split("\n").map((l) => l.trim())) {
    if (!line.startsWith("[GNUPG:] ")) continue;
    if (/^\[GNUPG:\] NEWSIG( |$)/.test(line)) blocks.push([]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map((b) => {
    const f = (k: string) => b.find((l) => l.startsWith(`[GNUPG:] ${k} `))?.split(/\s+/);
    // VALIDSIG <fpr> <date> <ts> <expire> <version> <reserved> <algo> <hash> <class> <primary>
    const valid = f("VALIDSIG");
    const fingerprint = valid ? ((valid.length >= 12 ? valid[11] : valid[2]) ?? null) : null;
    const named = f("GOODSIG") ?? f("EXPKEYSIG") ?? f("BADSIG") ?? f("REVKEYSIG") ?? f("EXPSIG");
    const err = f("ERRSIG");
    const keyid = (named ?? err)?.[2] ?? "";
    let state: SumsSignature["state"] = "bad";
    if (f("BADSIG") || f("REVKEYSIG") || f("EXPSIG")) state = "bad";
    else if (err) state = f("NO_PUBKEY") ? "unknown" : "bad";
    else if (f("GOODSIG") && fingerprint) state = "good";
    else if (f("EXPKEYSIG") && fingerprint) state = "expired";
    return { keyid, fingerprint, state };
  });
}

/**
 * Whether a release verifies, by repro.md's rule and SECURITY.md's keys: the zip matches the sums,
 * gpg found no signature bad, and at least one is good by a counted key (the good ones are what
 * the lab publishes).
 */
export function clnVerified(input: {
  sha256: boolean;
  signatures: readonly SumsSignature[];
  counted: readonly ClnKey[];
}): { good: ClnKey[]; verified: boolean } {
  const good = input.counted.filter((k) =>
    input.signatures.some((s) => s.state === "good" && s.fingerprint === k.fingerprint),
  );
  const bad = input.signatures.some((s) => s.state === "bad");
  return { good, verified: input.sha256 && !bad && good.length > 0 };
}

/**
 * A minisign signature (`<file>.minisig`) over `data` by a minisign public key, as minisign -V
 * checks it: the key ids agree, the signature is over the data (algorithm "Ed") or its BLAKE2b-512
 * ("ED", prehashed), and the global signature over the signature and the trusted comment. With
 * `file`, the trusted comment must name it when it names a file. `data` may be the file's
 * BLAKE2b-512 already taken, which serves a prehashed signature only.
 */
export function minisignVerify(
  publicKey: string,
  data: Buffer | { blake2b512: Buffer },
  minisig: string,
  file?: string,
): { ok: boolean; trusted: string; reason: string } {
  const pk = Buffer.from(publicKey, "base64");
  const lines = minisig.split("\n").map((l) => l.replace(/\r$/, ""));
  const fail = (reason: string) => ({ ok: false, trusted: "", reason });
  if (pk.length !== 42 || pk.subarray(0, 2).toString("latin1") !== "Ed")
    return fail("not a minisign Ed25519 public key");
  if (!lines[0]?.startsWith("untrusted comment: ") || !lines[2]?.startsWith("trusted comment: "))
    return fail("not a minisign signature file");
  const sig = Buffer.from(lines[1] ?? "", "base64");
  const global = Buffer.from(lines[3] ?? "", "base64");
  const trusted = (lines[2] as string).slice("trusted comment: ".length);
  if (sig.length !== 74 || global.length !== 64) return fail("a signature of the wrong length");
  const alg = sig.subarray(0, 2).toString("latin1");
  if (alg !== "Ed" && alg !== "ED") return fail(`an unknown signature algorithm ${alg}`);
  if (!sig.subarray(2, 10).equals(pk.subarray(2, 10))) return fail("signed by another key");
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const bytes = Buffer.isBuffer(data) ? data : null;
  if (alg === "Ed" && !bytes) return fail("a signature over the file itself needs the file");
  const message =
    alg === "ED"
      ? bytes
        ? createHash("blake2b512").update(bytes).digest()
        : (data as { blake2b512: Buffer }).blake2b512
      : (bytes as Buffer);
  if (!verifySignature(null, message, key, sig.subarray(10)))
    return fail("the signature does not match the file");
  if (!verifySignature(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, global))
    return fail("the trusted comment's signature does not match");
  const named = /(?:^|\t)file:([^\t]+)/.exec(trusted)?.[1];
  if (file && named !== undefined && named !== file) return fail(`signed as ${named}`);
  return { ok: true, trusted, reason: "" };
}

/** A digest the publisher lists, of a file's bytes. */
export const digestOf = (kind: "sha3-256" | "sha512", data: Buffer): string =>
  createHash(kind).update(data).digest("hex");

export interface LockedPackage {
  name: string;
  version: string;
  hashes: string[];
}

/**
 * The packages `roots` need from a uv.lock, with every dependency uv.lock gives them, each at its
 * locked version with every SHA-256 the lock lists (its sdist and wheels). A package locked twice
 * or not at all is an error.
 */
export function lockedRequirements(uvLock: string, roots: readonly string[]): LockedPackage[] {
  const blocks = uvLock.split(/^\[\[package\]\]$/m).slice(1);
  const byName = new Map<string, { version: string; deps: string[]; hashes: string[] }[]>();
  for (const b of blocks) {
    const name = /^name = "([^"]+)"$/m.exec(b)?.[1];
    const version = /^version = "([^"]+)"$/m.exec(b)?.[1];
    if (!name || !version) continue;
    const depsBlock = /^dependencies = \[\n([\s\S]*?)^\]$/m.exec(b)?.[1] ?? "";
    const deps = [...depsBlock.matchAll(/\{ name = "([^"]+)"/g)].map((m) => m[1] as string);
    const hashes = [...b.matchAll(/hash = "sha256:([0-9a-f]{64})"/g)].map((m) => m[1] as string);
    byName.set(name, [...(byName.get(name) ?? []), { version, deps, hashes }]);
  }
  const out: LockedPackage[] = [];
  const seen = new Set<string>();
  const want = [...roots];
  while (want.length) {
    const name = want.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const found = byName.get(name) ?? [];
    if (found.length !== 1)
      throw new Error(`uv.lock locks ${name} ${found.length ? "more than once" : "not at all"}`);
    const p = found[0] as { version: string; deps: string[]; hashes: string[] };
    if (!p.hashes.length) throw new Error(`uv.lock lists no hash for ${name}`);
    out.push({ name, version: p.version, hashes: p.hashes });
    want.push(...p.deps);
  }
  return out;
}

/** A requirements file uv installs with `--require-hashes`: each package pinned to its hashes. */
export const requirementsText = (pkgs: readonly LockedPackage[]): string =>
  `${pkgs.map((p) => `${p.name}==${p.version} ${p.hashes.map((h) => `--hash=sha256:${h}`).join(" ")}`).join("\n")}\n`;

/** A release's unit test programs (`<dir>/test/run-*.c`, without `.c`) in each group. */
export function clnPrograms(sources: readonly string[]): Record<ClnGroup, string[]> {
  const programs = sources
    .map((s) => s.replace(/\.c$/, ""))
    .filter((p) => /^[a-z]+\/test\/run-[A-Za-z0-9_-]+$/.test(p))
    .sort();
  return Object.fromEntries(
    CLN_GROUPS.map((g) => [g, programs.filter((p) => CLN_PROGRAMS[g].test(p))]),
  ) as Record<ClnGroup, string[]>;
}

/** The threat map's Core Lightning groups (or the owner's list), in the order the lab knows them. */
export function selectClnGroups(
  threats: Pick<Threat, "lab">[],
  override?: string[],
): { groups: ClnGroup[]; unknown: string[] } {
  const wanted = new Set<string>();
  const unknown: string[] = [];
  for (const raw of override?.length ? override : threats.flatMap((t) => t.lab)) {
    const t = raw.trim();
    if (!t.startsWith(CLN_PREFIX)) continue;
    const g = t.slice(CLN_PREFIX.length);
    if ((CLN_GROUPS as readonly string[]).includes(g)) wanted.add(g);
    else unknown.push(t);
  }
  return { groups: CLN_GROUPS.filter((g) => wanted.has(g)), unknown };
}

/**
 * The environment the build runs in: the lab's tools first on PATH, its headers and libraries the
 * compiler's (configure passes CPATH and LIBRARY_PATH on), HOME and TMPDIR the lab's. Any compiler,
 * Python or uv setting the base environment carries is dropped, so nothing outside the lab changes
 * what is built.
 */
export function clnEnv(
  dirs: { prefix: string; python: string; home: string; tmp: string },
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const drop =
    /^(CC|CXX|CPP|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS|LDLIBS|LIBS|CPATH|C_INCLUDE_PATH|LIBRARY_PATH|LD_LIBRARY_PATH|PKG_CONFIG.*|PYTHON.*|VIRTUAL_ENV|UV_.*|MAKEFLAGS|MFLAGS|BOLTDIR|VALGRIND)$/;
  return {
    ...Object.fromEntries(Object.entries(base).filter(([k]) => !drop.test(k))),
    PATH: [
      path.join(dirs.python, "bin"),
      path.join(dirs.prefix, "bin"),
      base.PATH ?? "/usr/bin:/bin",
    ].join(":"),
    CPATH: path.join(dirs.prefix, "include"),
    LIBRARY_PATH: path.join(dirs.prefix, "lib"),
    PKG_CONFIG_PATH: path.join(dirs.prefix, "lib", "pkgconfig"),
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    HOME: dirs.home,
    TMPDIR: dirs.tmp,
  };
}

const PLAIN_PATH = /^\/[A-Za-z0-9._/+-]+$/;

/**
 * The compiler the build is given: a script that runs the system's cc with the prefix's headers,
 * its libraries and the run path to them. configure sets CPATH and LIBRARY_PATH to /usr/local/lib
 * before its checks, and libwally's configure runs "$CC" as one word, so neither the environment
 * nor flags in CC can carry them. A prefix with a space or quote in it is refused.
 */
export function clnCompiler(prefix: string): string {
  if (!PLAIN_PATH.test(prefix))
    throw new Error(`the lab's prefix ${JSON.stringify(prefix)} cannot go in a compiler line`);
  const lib = path.join(prefix, "lib");
  return [
    "#!/bin/sh",
    "# The lab's compiler for Core Lightning (brain/src/security/cln.ts, clnCompiler).",
    `exec cc -I${path.join(prefix, "include")} -L${lib} -Wl,-rpath,${lib} "$@"`,
    "",
  ].join("\n");
}

/** configure's arguments past the switches: that compiler, and no pytest. */
export function clnConfigure(compiler: string): string[] {
  if (!PLAIN_PATH.test(compiler))
    throw new Error(`the lab's compiler ${JSON.stringify(compiler)} cannot go in CC`);
  return [`CC=${compiler}`, "PYTEST="];
}

/**
 * Runs each program of a group as the Makefile's `unittest/%` rule does (`$* > /dev/null`, from the
 * source folder, BOLTDIR=.tmp.lightningrfc), printing one line per program the lab reads back.
 */
const GROUP_SH = [
  "status=0",
  'for p in "$@"; do',
  "  s=$(date +%s%N)",
  '  BOLTDIR=.tmp.lightningrfc "./$p" > /dev/null',
  "  e=$?",
  '  echo "cln-lab: $p exit $e ms $(( ($(date +%s%N) - s) / 1000000 ))"',
  '  [ "$e" -eq 0 ] || status=1',
  "done",
  'exit "$status"',
].join("\n");

export const groupArgv = (programs: readonly string[]): string[] => [
  "sh",
  "-c",
  GROUP_SH,
  "sh",
  ...programs,
];

export interface ProgramResult {
  name: string;
  /** Its exit, or null when it never finished (the group's step was cut off). */
  exit: number | null;
  seconds: number;
}

/** Each program's result from a group's output, in the order given; one with no line never ended. */
export function parseGroup(output: string, programs: readonly string[]): ProgramResult[] {
  const lines = new Map<string, { exit: number; ms: number }>();
  for (const m of output.matchAll(/^cln-lab: (\S+) exit (\d+) ms (\d+)$/gm))
    lines.set(m[1] as string, { exit: Number(m[2]), ms: Number(m[3]) });
  return programs.map((name) => {
    const l = lines.get(name);
    return {
      name,
      exit: l ? l.exit : null,
      seconds: l ? Math.round(l.ms / 100) / 10 : 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Verify, build the tools, build, test

/** What the owner sees of a Core Lightning run, privately. */
export interface ClnRecord {
  tag: string;
  /** The commit the tag names, whose SECURITY.md and contrib/keys/ the keys were read from. */
  commit: string | null;
  previous: { tag: string; keys: number } | null;
  keys: (ClnKey & { counted: boolean; sources: string[] })[];
  zip: { file: string; listed: string | null; sha256: string } | null;
  gpg: { exit: number | null; status: string } | null;
  signatures: (SumsSignature & { name: string | null })[];
  deps: {
    name: string;
    version: string;
    file: string;
    sha256: string;
    check: string;
    seconds: number | null;
  }[];
  python: { python: string; packages: string[] } | null;
  commands: string[];
  configure: { exit: number | null; seconds: number; tail: string } | null;
  build: { exit: number | null; seconds: number; tail: string } | null;
  groups: {
    name: string;
    ok: boolean;
    seconds: number;
    wall: number;
    programs: ProgramResult[];
    tail: string;
  }[];
}

export interface ClnRun {
  sha256: boolean;
  signatures: number | null;
  signers: number | null;
  verified: boolean;
  tests: LabTest[];
  missing: string[];
  record: ClnRecord;
}

const tailOf = (text: string, lines: number) => text.split("\n").slice(-lines).join("\n");

const git = (args: string[], cwd?: string) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${tailOf(r.stderr ?? "", 4)}`);
  return r.stdout;
};

const gpgIn =
  (home: string) =>
  (args: string[], input?: Buffer): { status: number | null; stdout: Buffer } => {
    const r = spawnSync("gpg", ["--homedir", home, "--batch", "--no-tty", ...args], {
      input,
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0) };
  };

/** Primary keys' fingerprints in a key file, as gpg reads them, without importing it. */
function primaries(gpg: ReturnType<typeof gpgIn>, file: string): string[] {
  const out = gpg(["--with-colons", "--show-keys", file]).stdout.toString("utf8").split("\n");
  const fprs: string[] = [];
  for (let i = 0; i < out.length; i++)
    if (out[i]?.startsWith("pub:")) {
      const f = out[i + 1]?.split(":");
      if (f?.[0] === "fpr" && f[9]) fprs.push(f[9]);
    }
  return fprs;
}

const killAgent = (home: string) =>
  spawnSync("gpgconf", ["--homedir", home, "--kill", "all"], { stdio: "ignore", timeout: 30_000 });

/**
 * One key by its fingerprint into a fresh keyring of its own, from every file given and both
 * keyservers, merged in an untrusted keyring and only that key exported. Returns where it was
 * found; none means the keyring has no key.
 */
async function keyring(
  home: string,
  fingerprint: string,
  files: readonly { file: string; label: string }[],
  dl: string,
): Promise<string[]> {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const gpg = gpgIn(home);
  const untrusted = path.join(home, "untrusted.pgp");
  const sources: string[] = [];
  const offered = [...files];
  for (const [i, url] of keyUrls(fingerprint).entries()) {
    const file = path.join(dl, `${fingerprint}.${i}.asc`);
    rmSync(file, { force: true });
    if (await download(url, file, { optional: true }).catch(() => false))
      offered.push({ file, label: new URL(url).host });
  }
  for (const f of offered) {
    if (!primaries(gpg, f.file).includes(fingerprint)) continue;
    if (gpg(["--no-default-keyring", "--keyring", untrusted, "--import", f.file]).status === 0)
      sources.push(f.label);
  }
  const key = gpg(["--no-default-keyring", "--keyring", untrusted, "--export", fingerprint]).stdout;
  if (!key.length || gpg(["--import"], key).status !== 0) return [];
  return sources;
}

/** One line of the prefix's stamp: a dependency's archive and how it was configured. */
const stampLine = (d: ClnDep, prefix: string) =>
  [d.sha256, path.basename(d.url), ...d.configure(prefix), JSON.stringify(d.env ?? {})].join(" ");

/**
 * Which dependencies still need building into a prefix whose stamp lists `built` (one line per
 * dependency installed, in the order built): none when every one is listed, the missing ones
 * beside the rest when some are, and every one, from an empty prefix, when the stamp lists none or
 * anything CLN_DEPS no longer has (an archive or configure changed or a dependency dropped), so
 * nothing stale or half-built stays installed.
 */
export function depsToBuild(
  deps: readonly ClnDep[],
  prefix: string,
  built: readonly string[],
): { fresh: boolean; todo: ClnDep[] } {
  const want = deps.map((d) => stampLine(d, prefix));
  if (!built.length || built.some((l) => !want.includes(l)))
    return { fresh: true, todo: [...deps] };
  return { fresh: false, todo: deps.filter((_, i) => !built.includes(want[i] as string)) };
}

/** The programs the build runs from the prefix: one missing and the prefix is built afresh. */
const PREFIX_TOOLS = ["m4", "autoreconf", "automake", "libtoolize", "xgettext", "lowdown"];

/**
 * Every tool and library in CLN_DEPS, each checked its publisher's way, built and installed into
 * <depsDir>/prefix; each one reused while the prefix's stamp lists its archive and configure.
 */
async function buildDeps(input: {
  depsDir: string;
  jobs: number;
  env: NodeJS.ProcessEnv;
  home: string;
  log: (line: string) => void;
  commands: string[];
}): Promise<{ prefix: string; deps: ClnRecord["deps"] }> {
  const { depsDir, log } = input;
  const prefix = path.join(depsDir, "prefix");
  const dl = path.join(depsDir, "dl");
  const stampFile = path.join(prefix, ".sha256");
  const built = existsSync(stampFile)
    ? readFileSync(stampFile, "utf8").split("\n").filter(Boolean)
    : [];
  let { fresh, todo } = depsToBuild(CLN_DEPS, prefix, built);
  if (!todo.length && !PREFIX_TOOLS.every((b) => existsSync(path.join(prefix, "bin", b)))) {
    fresh = true;
    todo = [...CLN_DEPS];
  }
  const record = CLN_DEPS.map((d) => ({
    name: d.name,
    version: d.version,
    file: path.basename(d.url),
    sha256: d.sha256,
    check:
      d.check.kind === "gpg"
        ? `${d.check.sig} by ${d.check.signer} (${d.check.fingerprint})`
        : d.check.kind === "minisign"
          ? `minisign ${d.check.key}`
          : `${d.check.kind} ${d.check.hash} listed at ${d.check.listed}`,
    seconds: null as number | null,
  }));
  const kept = CLN_DEPS.filter((d) => !todo.includes(d));
  if (kept.length)
    log(`lab: already built in ${prefix}: ${kept.map((d) => `${d.name} ${d.version}`).join(", ")}`);
  if (!todo.length) return { prefix, deps: record };
  if (fresh) rmSync(prefix, { recursive: true, force: true });
  for (const d of [prefix, dl]) mkdirSync(d, { recursive: true });
  const gnupg = path.join(depsDir, "gnupg");
  rmSync(gnupg, { recursive: true, force: true });
  mkdirSync(gnupg, { recursive: true, mode: 0o700 });
  const gnuKeys = path.join(dl, "gnu-keyring.gpg");
  rmSync(gnuKeys, { force: true });
  if (todo.some((d) => d.check.kind === "gpg" && d.check.gnu)) await download(GNU_KEYRING, gnuKeys);
  if (fresh) writeFileSync(stampFile, "");

  for (const d of todo) {
    const i = CLN_DEPS.indexOf(d);
    const file = path.join(dl, path.basename(d.url));
    if (!existsSync(file) || (await sha256File(file)) !== d.sha256) {
      log(`lab: downloading ${path.basename(d.url)}`);
      await download(d.url, file);
    }
    const got = await sha256File(file);
    if (got !== d.sha256) {
      rmSync(file, { force: true });
      throw new Error(`${path.basename(d.url)} is not the archive the lab pinned (${got})`);
    }
    const c = d.check;
    if (c.kind === "gpg") {
      const sig = `${file}${c.sig}`;
      rmSync(sig, { force: true });
      await download(`${d.url}${c.sig}`, sig);
      const home = path.join(gnupg, d.name);
      try {
        const sources = await keyring(
          home,
          c.fingerprint,
          c.gnu ? [{ file: gnuKeys, label: "gnu-keyring.gpg" }] : [],
          dl,
        );
        if (!sources.length) throw new Error(`no copy of ${c.signer}'s key ${c.fingerprint}`);
        const v = spawnSync(
          "gpg",
          ["--homedir", home, "--batch", "--no-tty", "--status-fd", "1", "--verify", sig, file],
          { timeout: 120_000 },
        );
        const state = signatureState(v.stdout?.toString("utf8") ?? "", c.fingerprint, v.status);
        if (state !== "good")
          throw new Error(
            `${path.basename(d.url)}${c.sig} is ${state}, not good by ${c.signer} (${c.fingerprint})`,
          );
        log(
          `lab: ${path.basename(d.url)} matched its pin; its ${c.sig} is good by ${c.signer} (key from ${sources.join(", ")})`,
        );
      } finally {
        killAgent(home);
      }
    } else if (c.kind === "minisign") {
      const sig = `${file}${c.sig}`;
      rmSync(sig, { force: true });
      await download(`${d.url}${c.sig}`, sig);
      const m = minisignVerify(
        c.key,
        readFileSync(file),
        readFileSync(sig, "utf8"),
        path.basename(d.url),
      );
      if (!m.ok) throw new Error(`${path.basename(d.url)}${c.sig}: ${m.reason}`);
      log(`lab: ${path.basename(d.url)} matched its pin; its minisign signature is good`);
    } else {
      const got2 = digestOf(c.kind, readFileSync(file));
      if (got2 !== c.hash)
        throw new Error(`${path.basename(d.url)}: its ${c.kind} is not the one ${c.listed} lists`);
      log(`lab: ${path.basename(d.url)} matched its pin and the ${c.kind} ${c.listed} lists`);
    }

    // Checked: extracted into a fresh folder of its own and installed into the prefix.
    const top = extract(file, path.join(depsDir, "x", d.name));
    const argv = [
      "sh",
      "-c",
      'set -e; ./configure "$@"; make -j"$CLN_LAB_JOBS"; make install',
      "sh",
      ...d.configure(prefix),
    ];
    input.commands.push(
      `${d.name}: ./configure ${d.configure(prefix).join(" ")} && make && make install`,
    );
    const tmp = path.join(depsDir, "tmp");
    mkdirSync(tmp, { recursive: true });
    const r = await step(argv, {
      cwd: top,
      log: path.join(depsDir, `${d.name}.log`),
      limit: DEP_LIMIT_S,
      env: {
        ...clnEnv(
          { prefix, python: path.join(depsDir, "no-python"), home: input.home, tmp },
          input.env,
        ),
        ...d.env,
        CLN_LAB_JOBS: String(input.jobs),
      },
    });
    if (r.exit !== 0)
      throw new Error(
        `${d.name} ${d.version} did not build (exit ${r.exit}): ${tailOf(r.output, 12)}`,
      );
    (record[i] as { seconds: number | null }).seconds = r.seconds;
    log(`lab: ${d.name} ${d.version} built and installed in ${r.seconds} s`);
    rmSync(path.join(depsDir, "x", d.name), { recursive: true, force: true });
    appendFileSync(stampFile, `${stampLine(d, prefix)}\n`);
  }
  rmSync(path.join(depsDir, "x"), { recursive: true, force: true });
  rmSync(gnupg, { recursive: true, force: true });
  return { prefix, deps: record };
}

/** uv, from PATH or where its own installer puts it; the lab installs nothing system-wide. */
function findUv(env: NodeJS.ProcessEnv): string {
  for (const dir of [
    ...(env.PATH ?? "").split(":"),
    path.join(process.env.HOME ?? "", ".local", "bin"),
  ])
    if (dir && existsSync(path.join(dir, "uv"))) return path.join(dir, "uv");
  throw new Error("the lab needs uv (https://docs.astral.sh/uv/) for Core Lightning's Python");
}

/**
 * One Core Lightning release: verify its zip against the sums its maintainers signed, and only then
 * build the tools it needs, its unit test programs, and run each group. Throws when the lab itself
 * cannot run (a clone, a download, a tool that does not verify or build); what Core Lightning's
 * release does is in what it returns.
 */
export async function runCln(input: {
  version: string;
  previous: string | null;
  /** <lab>/cln/<version>: the downloads, the keys, the source and its build, each run. */
  dir: string;
  /** <lab>/cln-deps: the build's tools and libraries, shared by every release. */
  depsDir: string;
  home: string;
  groups: readonly ClnGroup[];
  jobs: number;
  env: NodeJS.ProcessEnv;
  runId: string;
  log: (line: string) => void;
}): Promise<ClnRun> {
  const { version, dir, log } = input;
  if (!RELEASE_VERSION.cln.test(version))
    throw new Error(`${version} is not a Core Lightning release`);
  const tag = `v${version}`;
  const files = clnFiles(version);
  const record: ClnRecord = {
    tag,
    commit: null,
    previous: null,
    keys: [],
    zip: null,
    gpg: null,
    signatures: [],
    deps: [],
    python: null,
    commands: [],
    configure: null,
    build: null,
    groups: [],
  };
  mkdirSync(dir, { recursive: true });

  // The repository at the tag, without its files: SECURITY.md and contrib/keys/ there, and
  // SECURITY.md at the release before it.
  const repo = path.join(dir, "repo.git");
  rmSync(repo, { recursive: true, force: true });
  git([
    "clone",
    "-q",
    "--bare",
    "--filter=blob:none",
    "--depth",
    "1",
    "--branch",
    tag,
    CLN_REPO,
    repo,
  ]);
  record.commit = git(["rev-parse", "HEAD^{commit}"], repo).trim();
  const atTag = clnReleaseKeys(git(["show", "HEAD:SECURITY.md"], repo));
  let earlier = atTag;
  if (input.previous) {
    git(
      ["fetch", "-q", "--filter=blob:none", "--depth", "1", "origin", "tag", `v${input.previous}`],
      repo,
    );
    earlier = clnReleaseKeys(git(["show", `v${input.previous}:SECURITY.md`], repo));
    record.previous = { tag: `v${input.previous}`, keys: earlier.length };
  }
  const counted = countedMaintainers(atTag, earlier);
  log(
    `lab: Core Lightning's SECURITY.md at ${tag} (commit ${record.commit}) lists ${atTag.length} release keys; ${counted.length} also listed at ${input.previous ? `v${input.previous}` : "no earlier release"}`,
  );

  // Each run takes the keys afresh: nothing an earlier run left is ever read.
  const keys = path.join(dir, "keys");
  const gnupg = path.join(dir, "gnupg");
  for (const d of [keys, gnupg]) rmSync(d, { recursive: true, force: true });
  mkdirSync(keys, { recursive: true });
  mkdirSync(gnupg, { recursive: true, mode: 0o700 });
  const contrib: { file: string; label: string }[] = [];
  for (const name of git(["ls-tree", "--name-only", "HEAD", "contrib/keys/"], repo).split("\n")) {
    const base = path.basename(name.trim());
    if (!/^[A-Za-z0-9_.-]+\.txt$/.test(base)) continue;
    const file = path.join(keys, base);
    writeFileSync(file, git(["show", `HEAD:contrib/keys/${base}`], repo));
    contrib.push({ file, label: `contrib/keys/${base}` });
  }
  const sources = new Map<string, string[]>();
  for (const k of counted) {
    const home = path.join(gnupg, k.fingerprint);
    try {
      sources.set(k.fingerprint, await keyring(home, k.fingerprint, contrib, keys));
    } finally {
      killAgent(home);
    }
  }
  record.keys = atTag.map((k) => ({
    ...k,
    counted: counted.some((c) => c.fingerprint === k.fingerprint),
    sources: sources.get(k.fingerprint) ?? [],
  }));
  const checked = counted.filter((k) => (sources.get(k.fingerprint) ?? []).length > 0);
  const lacking = counted.filter((k) => !checked.includes(k)).map((k) => k.name);
  log(
    `lab: ${checked.length} of ${counted.length} counted keys found by fingerprint${lacking.length ? `; none had ${lacking.join(", ")}'s` : ""}`,
  );
  // One keyring with only the counted keys found, exported from their own keyrings.
  const verifyHome = path.join(gnupg, "verify");
  mkdirSync(verifyHome, { recursive: true, mode: 0o700 });
  for (const k of checked) {
    const key = gpgIn(path.join(gnupg, k.fingerprint))(["--export", k.fingerprint]).stdout;
    gpgIn(verifyHome)(["--import"], key);
    killAgent(path.join(gnupg, k.fingerprint));
  }

  // The release's files, untrusted until checked.
  const dl = path.join(dir, "dl");
  mkdirSync(dl, { recursive: true });
  for (const f of [files.sums, files.sig]) {
    rmSync(path.join(dl, f), { force: true });
    await download(`${CLN_DL}/${tag}/${f}`, path.join(dl, f));
  }
  const zip = path.join(dl, files.zip);
  const listed = parseSums(readFileSync(path.join(dl, files.sums), "utf8")).get(files.zip) ?? null;
  if (!existsSync(zip) || (listed && (await sha256File(zip)) !== listed)) {
    log(`lab: downloading ${files.zip}`);
    await download(`${CLN_DL}/${tag}/${files.zip}`, zip);
  }
  const sha = await sha256File(zip);
  record.zip = { file: files.zip, listed, sha256: sha };
  const v = spawnSync(
    "gpg",
    [
      "--homedir",
      verifyHome,
      "--batch",
      "--no-tty",
      "--status-fd",
      "1",
      "--verify",
      path.join(dl, files.sig),
      path.join(dl, files.sums),
    ],
    { timeout: 120_000 },
  );
  killAgent(verifyHome);
  const status = v.stdout?.toString("utf8") ?? "";
  record.gpg = { exit: v.status, status };
  const sigs = sumsSignatures(status);
  record.signatures = sigs.map((s) => ({
    ...s,
    name: atTag.find((k) => k.fingerprint === s.fingerprint)?.name ?? null,
  }));
  const check = clnVerified({
    sha256: listed !== null && sha === listed,
    signatures: sigs,
    counted: checked,
  });
  log(
    `lab: ${files.zip} ${listed === null ? "IS NOT LISTED in" : sha === listed ? "matched" : "DID NOT MATCH"} ${files.sums}; ${sigs.length} signatures: ${(["good", "expired", "unknown", "bad"] as const).map((s) => `${sigs.filter((x) => x.state === s).length} ${s}`).join(", ")}; good by ${check.good.map((k) => k.name).join(", ") || "no counted key"}`,
  );
  const out = {
    sha256: listed !== null && sha === listed,
    signatures: check.good.length,
    signers: checked.length,
    record,
  };
  if (!check.verified) return { ...out, verified: false, tests: [], missing: [] };

  // Verified: the tools, the source, its Python, then the programs of each group it has.
  const tmp = path.join(dir, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  for (const d of [tmp, input.home]) mkdirSync(d, { recursive: true });
  const deps = await buildDeps({
    depsDir: input.depsDir,
    jobs: input.jobs,
    env: input.env,
    home: input.home,
    log,
    commands: record.commands,
  });
  record.deps = deps.deps;
  const src = extract(zip, path.join(dir, "src"));
  log(`lab: ${files.zip} extracted`);

  const python = path.join(dir, "python");
  rmSync(python, { recursive: true, force: true });
  const pkgs = lockedRequirements(readFileSync(path.join(src, "uv.lock"), "utf8"), PYTHON_ROOTS);
  const reqs = path.join(dir, "requirements.txt");
  writeFileSync(reqs, requirementsText(pkgs));
  const uv = findUv(input.env);
  const uvEnv = {
    ...clnEnv({ prefix: deps.prefix, python, home: input.home, tmp }, input.env),
    UV_CACHE_DIR: path.join(input.depsDir, "uv-cache"),
    UV_NO_CONFIG: "1",
    UV_PYTHON_DOWNLOADS: "never",
  };
  const uvRun = (args: string[]) => {
    record.commands.push(["uv", ...args].join(" "));
    const r = spawnSync(uv, args, { env: uvEnv, encoding: "utf8", timeout: 600_000 });
    if (r.status !== 0) throw new Error(`uv ${args[0]} ${args[1]}: ${tailOf(r.stderr ?? "", 6)}`);
  };
  uvRun(["venv", "-q", "--python", "/usr/bin/python3", python]);
  uvRun([
    "pip",
    "install",
    "-q",
    "--python",
    path.join(python, "bin", "python3"),
    "--index-url",
    "https://pypi.org/simple",
    "--require-hashes",
    "--no-deps",
    "--only-binary",
    ":all:",
    "-r",
    reqs,
  ]);
  const pyVersion = spawnSync(path.join(python, "bin", "python3"), ["-I", "-V"], {
    encoding: "utf8",
  }).stdout.trim();
  record.python = { python: pyVersion, packages: pkgs.map((p) => `${p.name} ${p.version}`) };
  log(
    `lab: ${pyVersion} with ${pkgs.map((p) => `${p.name} ${p.version}`).join(", ")}, each checked by uv against the hashes in the release's uv.lock`,
  );

  const sources2 = readdirSync(src, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(src, e.name, "test")))
    .flatMap((e) =>
      readdirSync(path.join(src, e.name, "test"))
        .filter((f) => /^run-.*\.c$/.test(f))
        .map((f) => `${e.name}/test/${f}`),
    );
  const all = clnPrograms(sources2);
  const missing = input.groups.filter((g) => !all[g].length).map((g) => `${CLN_PREFIX}${g}`);
  const groups = input.groups.filter((g) => all[g].length);
  if (!groups.length) return { ...out, verified: true, tests: [], missing };
  const programs = groups.flatMap((g) => all[g]);

  // The prefix goes in through the compiler (clnCompiler), which configure writes into config.vars
  // for the Makefile. PYTHON is the lab's, and PYTEST empty, so configure never asks `uv run` for
  // one, which would sync the release's whole uv.lock; UV_OFFLINE keeps any other uv call from
  // fetching anything.
  const env = {
    ...clnEnv({ prefix: deps.prefix, python, home: input.home, tmp }, input.env),
    PYTHON: path.join(python, "bin", "python3"),
    UV_OFFLINE: "1",
  };
  const runs = path.join(dir, "runs");
  mkdirSync(runs, { recursive: true });
  const compiler = path.join(dir, "lab-cc");
  writeFileSync(compiler, clnCompiler(deps.prefix));
  chmodSync(compiler, 0o755);
  const configureArgv = [
    "./configure",
    "--disable-rust",
    "--disable-valgrind",
    ...clnConfigure(compiler),
  ];
  record.commands.push(configureArgv.join(" "));
  const c = await step(configureArgv, {
    cwd: src,
    log: path.join(runs, `${input.runId}.configure.log`),
    limit: DEP_LIMIT_S,
    env,
  });
  record.configure = {
    exit: c.exit,
    seconds: c.seconds,
    tail: c.exit === 0 ? "" : tailOf(c.output, 60),
  };
  log(`lab: configure ${c.exit === 0 ? "passed" : `FAILED (exit ${c.exit})`} in ${c.seconds} s`);
  const buildArgv = ["make", `-j${input.jobs}`, ...programs];
  record.commands.push(`make -j${input.jobs} <${programs.length} test programs>`);
  const b =
    c.exit === 0
      ? await step(buildArgv, {
          cwd: src,
          log: path.join(runs, `${input.runId}.build.log`),
          limit: BUILD_LIMIT_S,
          env,
        })
      : c;
  record.build = {
    exit: b.exit,
    seconds: b.seconds,
    tail: b.exit === 0 ? "" : tailOf(b.output, 60),
  };
  log(
    `lab: ${programs.length} unit test programs ${b.exit === 0 ? "built" : `FAILED to build (exit ${b.exit})`} in ${b.seconds} s`,
  );

  const tests: LabTest[] = [];
  for (const g of groups) {
    const name = `${CLN_PREFIX}${g}`;
    const argv = groupArgv(all[g]);
    record.commands.push(`BOLTDIR=.tmp.lightningrfc ${all[g].join(", ")} > /dev/null`);
    const r =
      b.exit === 0
        ? await step(argv, {
            cwd: src,
            log: path.join(runs, `${input.runId}.${g}.log`),
            limit: GROUP_LIMIT_S,
            env,
          })
        : { exit: b.exit, seconds: 0, output: b.output };
    const results = parseGroup(r.output, all[g]);
    const ok = r.exit === 0 && results.every((p) => p.exit === 0);
    const seconds = Math.round(results.reduce((s, p) => s + p.seconds, 0) * 10) / 10;
    tests.push({ name, ok, seconds });
    record.groups.push({
      name,
      ok,
      seconds,
      wall: r.seconds,
      programs: results,
      tail: ok ? "" : tailOf(r.output, 60),
    });
    const failed = results.filter((p) => p.exit !== 0).map((p) => p.name);
    log(
      `lab: ${name} ${ok ? "passed" : `FAILED (${failed.join(", ") || `exit ${r.exit}`})`}: ${results.length} programs in ${seconds} s (${r.seconds} s with the wait)`,
    );
  }
  return { ...out, verified: true, tests, missing };
}

/** Removes what a run leaves that the next one does not need: the source and its build are kept. */
export function tidyCln(dir: string): void {
  for (const d of ["tmp", "gnupg", "keys", "repo.git"])
    rmSync(path.join(dir, d), { recursive: true, force: true });
}
