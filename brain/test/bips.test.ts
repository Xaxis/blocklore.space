import assert from "node:assert/strict";
import { test } from "node:test";
import { diffBips, parseBipIndex } from "../src/bips.ts";

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
