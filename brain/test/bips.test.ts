import assert from "node:assert/strict";
import { test } from "node:test";
import { diffBips, diffCoreBips, parseBipIndex, parseCoreBips } from "../src/bips.ts";

// Three rows of bitcoin/bips README.mediawiki as of a7f91321f25b5be8d93e901775621c21519e80b7.
const README = `Intro text.

{| class="wikitable sortable" style="width: auto;"
!Number
!Layer
!Title
!Owner
!Type
!Status
|- style="background-color: #ffcfcf"
| [[bip-0001.mediawiki|1]]
|
| BIP Purpose and Guidelines
| Amir Taaki
| Process
| Closed
|- style="background-color: #ffffcf"
| [[bip-0054.md|54]]
| Consensus (soft fork)
| Consensus Cleanup
| Antoine Poinsot, Matt Corallo
| Specification
| Complete
|-
| 40
| API/RPC
| Stratum wire protocol
| Marek Palatinus
| Standard
| BIP number allocated
|-
| [[bip-0360.mediawiki|360]]
| Consensus (soft fork)
| Pay-to-Merkle-Root (P2MR)
| Hunter Beast, Ethan Heilman, Isabel Foxen Duke
| Specification
| Draft
|}
`;

test("the index parses into rows without owners", () => {
  const b = parseBipIndex(README);
  assert.deepEqual(b, [
    {
      n: 1,
      title: "BIP Purpose and Guidelines",
      type: "Process",
      status: "Closed",
      file: "bip-0001.mediawiki",
    },
    {
      n: 54,
      layer: "Consensus (soft fork)",
      title: "Consensus Cleanup",
      type: "Specification",
      status: "Complete",
      file: "bip-0054.md",
    },
    {
      n: 40,
      layer: "API/RPC",
      title: "Stratum wire protocol",
      type: "Standard",
      status: "BIP number allocated",
    },
    {
      n: 360,
      layer: "Consensus (soft fork)",
      title: "Pay-to-Merkle-Root (P2MR)",
      type: "Specification",
      status: "Draft",
      file: "bip-0360.mediawiki",
    },
  ]);
  assert.ok(!JSON.stringify(b).includes("Poinsot"), "owners are never stored");
});

test("dashes in the index are undone, as everywhere on the site", () => {
  const dash = String.fromCharCode(0x2014);
  const [b] = parseBipIndex(
    README.replace("Consensus Cleanup", `Consensus${dash}Cleanup`).replace(/\|-[\s\S]*?\|-/, "|-"),
  );
  assert.equal(b?.title, "Consensus, Cleanup");
});

test("a malformed row stops the parse instead of guessing", () => {
  assert.throws(
    () => parseBipIndex(README.replace("[[bip-0054.md|54]]", "BIP 54")),
    /unexpected BIP index row/,
  );
});

test("changes record status moves, additions and removals with their commit", () => {
  const before = parseBipIndex(README);
  const after = before
    .filter((b) => b.n !== 1 && b.n !== 40)
    .map((b) => (b.n === 360 ? { ...b, status: "Complete" } : b))
    .concat({ n: 444, title: "New", type: "Specification", status: "Draft", file: "bip-0444.md" });
  const at = { time: "2026-11-21T00:00:00Z", height: 976900 };
  const c = diffBips(before, after, "a".repeat(40), at);
  assert.deepEqual(
    c.map((x) => [x.n, x.field, x.before, x.after]),
    [
      [360, "status", "Draft", "Complete"],
      [444, "added", undefined, "Draft"],
      [1, "removed", "Closed", undefined],
      [40, "removed", "BIP number allocated", undefined],
    ],
  );
});

// Bitcoin Core's doc/bips.md, lines from the file itself (bitcoin/bitcoin master, 2026-11-24).
const CORE_MD = `BIPs that are implemented by Bitcoin Core:

* [\`BIP 9\`](https://github.com/bitcoin/bips/blob/master/bip-0009.mediawiki): The changes allowing multiple soft-forks to be deployed in parallel have been implemented since **v0.12.1**  ([PR #7575](https://github.com/bitcoin/bitcoin/pull/7575))
* [\`BIP 61\`](https://github.com/bitcoin/bips/blob/master/bip-0061.mediawiki): The 'reject' protocol message (and the protocol version bump to 70002) was added in **v0.9.0** ([PR #3185](https://github.com/bitcoin/bitcoin/pull/3185)). Starting **v0.17.0**, whether to send reject messages can be configured with the \`-enablebip61\` option, and support is deprecated (disabled by default) as of **v0.18.0**. Support was removed in **v0.20.0** ([PR #15437](https://github.com/bitcoin/bitcoin/pull/15437)).
* [\`BIP 70\`](https://github.com/bitcoin/bips/blob/master/bip-0070.mediawiki) [\`71\`](https://github.com/bitcoin/bips/blob/master/bip-0071.mediawiki) [\`72\`](https://github.com/bitcoin/bips/blob/master/bip-0072.mediawiki):
  Payment Protocol support has been available in Bitcoin Core GUI since **v0.9.0** ([PR #5216](https://github.com/bitcoin/bitcoin/pull/5216)).
  Support can be optionally disabled at build time since **v0.18.0** ([PR 14451](https://github.com/bitcoin/bitcoin/pull/14451)),
  and it is disabled by default at build time since **v0.19.0** ([PR #15584](https://github.com/bitcoin/bitcoin/pull/15584)).
  It has been removed as of **v0.20.0** ([PR 17165](https://github.com/bitcoin/bitcoin/pull/17165)).
* [\`BIP 144\`](https://github.com/bitcoin/bips/blob/master/bip-0144.mediawiki): Segregated Witness as of **0.13.0** ([PR 8149](https://github.com/bitcoin/bitcoin/pull/8149)).
* [\`BIP 340\`](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
  [\`341\`](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki)
  [\`342\`](https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki):
  Validation rules for Taproot (including Schnorr signatures and Tapscript
  leaves) are implemented as of **v0.21.0** ([PR 19953](https://github.com/bitcoin/bitcoin/pull/19953)),
  with mainnet activation as of **v0.21.1** ([PR 21377](https://github.com/bitcoin/bitcoin/pull/21377),
  [PR 21686](https://github.com/bitcoin/bitcoin/pull/21686)),
  always active as of **v24.0** ([PR 23536](https://github.com/bitcoin/bitcoin/pull/23536)).`;

test("Core's list parses into entries with their BIPs, words, first version, pull requests and line", () => {
  const e = parseCoreBips(CORE_MD);
  assert.deepEqual(
    e.map((x) => x.bips),
    [[9], [61], [70, 71, 72], [144], [340, 341, 342]],
  );
  assert.deepEqual(e[0], {
    bips: [9],
    text: "The changes allowing multiple soft-forks to be deployed in parallel have been implemented since v0.12.1 (PR #7575)",
    since: "v0.12.1",
    prs: [7575],
    line: 3,
  });
  // A removed feature keeps Core's own account of it, removal included.
  assert.match(e[1]?.text ?? "", /Support was removed in v0\.20\.0 \(PR #15437\)\.$/);
  assert.deepEqual(e[2]?.prs, [5216, 14451, 15584, 17165]);
  assert.equal(e[3]?.since, "0.13.0");
  // Each entry's line is where its bullet starts in the file, continuation lines and all.
  assert.deepEqual(
    e.map((x) => x.line),
    CORE_MD.split("\n").flatMap((l, k) => (l.startsWith("* ") ? [k + 1] : [])),
  );
  assert.match(
    e[4]?.text ?? "",
    /^Validation rules for Taproot .* always active as of v24\.0 \(PR 23536\)\.$/,
  );
});

test("a bullet in Core's list that names no BIP stops the reading instead of losing it", () => {
  assert.throws(
    () => parseCoreBips(`${CORE_MD}\n* A new kind of entry with no BIP link.`),
    /names no BIP/,
  );
  assert.throws(() => parseCoreBips("BIPs that are implemented by Bitcoin Core:\n"), /no entries/);
});

test("changes to Core's list are kept per BIP: added, removed and new words", () => {
  const before = parseCoreBips(CORE_MD);
  const after = before
    .filter((x) => x.bips[0] !== 61)
    .map((x) => (x.bips[0] === 9 ? { ...x, text: `${x.text}.` } : x));
  after.push({
    bips: [434],
    text: "Peer Feature Negotiation as of v32.0 (PR 35221).",
    since: "v32.0",
    prs: [35221],
    line: 99,
  });
  const at = { time: "2026-11-24T05:00:00Z", height: 977330 };
  const commit = "a".repeat(40);
  assert.deepEqual(
    diffCoreBips(before, after, commit, at).map((c) => [c.n, c.field]),
    [
      [9, "text"],
      [61, "removed"],
      [434, "added"],
    ],
  );
  assert.deepEqual(diffCoreBips(before, before, commit, at), []);
});
