import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advisoryIds,
  type DisclosureContext,
  disclosurePath,
  embargoReasons,
  isDisclosureSource,
  labEmbargo,
} from "../src/disclosure.ts";

const ctx: DisclosureContext = {
  knownTerms: ["time warp", "channel jamming", "eclipse attack"],
  knownIds: new Set(["CVE-2018-17144", "GHSA-9GXX-58Q6-42P7"]),
};
const optech = { url: "https://bitcoinops.org/en/topics/channel-jamming-attacks/" };
const advisory = { url: "https://bitcoincore.org/en/2026/11/20/disclose-orphan-inv-stall/" };
const ghsa = {
  url: "https://github.com/lightningnetwork/lnd/security/advisories/GHSA-9gxx-58q6-42p7",
};
const held = (statement: string, sources: { url?: string }[] = [optech]) =>
  embargoReasons({ statement, sources }, ctx);

test("a weakness described as unpatched never passes without a published advisory", () => {
  const s =
    "A remote peer can crash Bitcoin Core 32.1 by sending a crafted message, and the bug remains unpatched in every release.";
  assert.ok(held(s).length > 0);
  // Naming a public threat does not excuse saying it is unfixed.
  assert.ok(
    held(`An eclipse attack variant is still exploitable against Bitcoin Core 32.1 nodes.`).length >
      0,
  );
  // With the project's own advisory cited, it is disclosed.
  assert.deepEqual(held(s, [advisory]), []);
});

test("a security finding that names nothing public is held; a public threat or advisory passes", () => {
  assert.ok(
    held("A flaw in compact block reconstruction lets a peer delay block relay to a node.").length >
      0,
  );
  assert.deepEqual(
    held("Channel jamming is a denial-of-service attack in which payments are left unsettled."),
    [],
  );
  assert.deepEqual(
    held("CVE-2018-17144 let a miner crash nodes with a block that spent one output twice."),
    [],
  );
  assert.deepEqual(held("The onion bomb was a crash bug in LND.", [ghsa]), []);
});

test("a CVE no published advisory lists is held, unless the finding cites one", () => {
  const s = "CVE-2027-0001 lets a peer exhaust a node's memory with oversized inventory messages.";
  assert.match(held(s).join(" "), /CVE-2027-0001/);
  assert.deepEqual(held(s, [advisory]), []);
});

test("statements that are not security findings pass untouched", () => {
  assert.deepEqual(
    held("The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000.", []),
    [],
  );
  assert.deepEqual(
    held("In BIP 3, a Draft BIP that appears stalled for a year may be proposed for Closed.", []),
    [],
  );
});

test("published claims of the store's own kind pass the gate (calibration)", () => {
  // Real statements from knowledge/claims, shortened: known threats, by their public names.
  const real = [
    "BIP 54 (Consensus Cleanup) states that the timewarp bug lets an attacker with a majority of Bitcoin's hashrate arbitrarily lower mining difficulty; the time warp is fixed on testnet4.",
    "Channel jamming is a denial-of-service attack on Lightning in which an attacker sends payments that it delays settling.",
  ];
  for (const s of real) assert.deepEqual(held(s, []), [], s);
});

test("only advisories and CVE records count as disclosure sources", () => {
  for (const u of [
    "https://bitcoincore.org/en/2024/10/08/disclose-blocktxn-crash/",
    "https://bitcoincore.org/en/security-advisories/",
    "https://github.com/ACINQ/eclair/security/advisories/GHSA-abcd-efgh-2345",
    "https://nvd.nist.gov/vuln/detail/CVE-2018-17144",
    "https://www.cve.org/CVERecord?id=CVE-2018-17144",
    "https://en.bitcoin.it/wiki/Common_Vulnerabilities_and_Exposures",
    // Core's own posts slugged with underscores, the CVE API's record, bitcoin.org's alerts and
    // Optech's list of disclosures: held claims cited each of these.
    "https://bitcoincore.org/en/2024/07/03/disclose_upnp_rce/",
    "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2015-20111",
    "https://bitcoin.org/en/alert/2013-08-11-android",
    "https://bitcoinops.org/en/topics/responsible-disclosures/",
  ])
    assert.ok(isDisclosureSource(u), u);
  for (const u of [
    undefined,
    "https://bitcoincore.org/en/2024/07/03/release_notes/",
    "https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=bitcoin",
    "https://services.nvd.nist.gov/rest/json/cves/2.0",
    "https://bitcoin.org/en/alerts",
    "https://bitcoin.org/bitcoin.pdf",
    "https://bitcoinops.org/en/topics/",
    "https://bitcoinops.org/en/newsletters/2025/03/07/#disclosure-of-fixed-lnd-vulnerability",
    "https://bitcoincore.org/en/download/",
    "https://github.com/bitcoin/bitcoin/issues/1",
    "https://delvingbitcoin.org/t/some-weakness/1",
    "http://nvd.nist.gov/vuln/detail/CVE-2018-17144",
    "https://nvd.nist.gov.evil.example/vuln/detail/CVE-2018-17144",
    "not a url",
  ])
    assert.ok(!isDisclosureSource(u), String(u));
});

test("a lab run is embargoed on any failure or a release that did not verify", () => {
  const ok = { name: "p2p_invalid_block.py", ok: true };
  const verified = { sha256: true, signatures: 9 };
  assert.deepEqual(labEmbargo({ verified, tests: [ok] }), []);
  assert.deepEqual(labEmbargo({ verified: { sha256: true, signatures: null }, tests: [ok] }), []);
  assert.match(
    labEmbargo({ verified, tests: [ok, { name: "feature_block.py", ok: false }] }).join(),
    /feature_block\.py/,
  );
  assert.ok(labEmbargo({ verified: { sha256: false, signatures: 9 }, tests: [ok] }).length);
  assert.ok(labEmbargo({ verified: { sha256: true, signatures: 0 }, tests: [ok] }).length);
  // Each project says what its own release check is.
  const ldk = { name: "ldk/chain/package", ok: true };
  assert.deepEqual(
    labEmbargo({ project: "ldk", verified: { sha256: false, signatures: 0 }, tests: [ldk] }),
    [
      "the source checked out is not the commit LDK's release tag names",
      "no signature on LDK's release tag by a maintainer its SECURITY.md lists was good",
    ],
  );
  assert.deepEqual(
    labEmbargo({ project: "ldk", verified: { sha256: true, signatures: 1 }, tests: [ldk] }),
    [],
  );
  assert.deepEqual(
    labEmbargo({ project: "lnd", verified: { sha256: false, signatures: 4 }, tests: [ok] }),
    ["the source tarball did not match LND's signed manifest"],
  );
});

test("the disclosure path always includes Bitcoin Core's security team, and the project named", () => {
  const core = disclosurePath("a lab failure in feature_block.py");
  assert.deepEqual(
    core.map((c) => c.email),
    ["security@bitcoincore.org"],
  );
  const lnd = disclosurePath("LND accepts a malformed onion");
  assert.deepEqual(
    lnd.map((c) => c.email),
    ["security@bitcoincore.org", "security@lightning.engineering"],
  );
  assert.deepEqual(advisoryIds("see cve-2018-17144 and GHSA-9gxx-58q6-42p7"), [
    "CVE-2018-17144",
    "GHSA-9GXX-58Q6-42P7",
  ]);
});
