import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { AtHead, type Source } from "@blocklore/core";
import { FeedEvent } from "@blocklore/core/feed";
import { claim } from "../../core/test/fixtures.ts";

// Every path the step writes points into a temporary folder, set before the modules load.
const tmp = mkdtempSync(path.join(tmpdir(), "blocklore-athead-"));
process.env.BLOCKLORE_CONTROL_DIR = path.join(tmp, "control");
process.env.BLOCKLORE_AT_HEAD_FILE = path.join(tmp, "at-head.json");
after(() => rmSync(tmp, { recursive: true, force: true }));
const { pinnedSources, readAtHead, stateAt } = await import("../src/athead.ts");
type FileRead = import("../src/athead.ts").FileRead;
const feed = () => {
  const f = path.join(tmp, "control", "feed.jsonl");
  return existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => FeedEvent.parse(JSON.parse(l)))
    : [];
};

// The daily `at head` step: each passage a claim quotes from a pinned GitHub file, read again at
// the repository's head. Real lines: Bitcoin Core's chainparams.cpp at a0988140 defined Taproot's
// deployment; at today's head the file is there without it (the deployment was removed).

const PIN = "a0988140b71485ad12c3c3a4a9573f7c21b1eff8";
const HEAD1 = "dbe9eacd17ae1cc24581081613123a40b44a9f31";
const HEAD2 = "1".repeat(40);
const BIPS = "0d99ffd39f2b5d1d1e4a8c0f0d9a4c6b3e2f1a0b";
const QUOTE = "consensus.vDeployments[Consensus::DEPLOYMENT_TAPROOT].bit = 2;";

const src = (url: string, quote = QUOTE): Source => ({
  tier: "T1",
  kind: "code",
  title: "a file",
  url,
  locator: "a line",
  quote,
  accessed: "2026-11-20",
  supports: "direct",
});
const core = (sha: string, file = "src/chainparams.cpp") =>
  `https://github.com/bitcoin/bitcoin/blob/${sha}/${file}#L120`;
const claims = [
  claim({
    id: "taproot.speedy-trial",
    topics: ["taproot"],
    sources: [
      src(core(PIN)),
      src(`https://github.com/bitcoin/bips/blob/${BIPS}/bip-0341.mediawiki`, "Taproot output"),
      src("https://bitcoinops.org/en/topics/taproot/", "an article"),
    ],
  }),
  claim({
    id: "taproot.old",
    topics: ["taproot"],
    status: "superseded",
    superseded_by: "taproot.speedy-trial",
    sources: [src(core(PIN))],
  }),
];

test("a read's state: the quote at head is current, without it changed, no file gone, else unread", () => {
  assert.equal(stateAt({ status: 200, text: `x\n  ${QUOTE}\ny` }, QUOTE), "current");
  assert.equal(stateAt({ status: 200, text: "// Taproot exception" }, QUOTE), "changed");
  assert.equal(stateAt({ status: 404, text: "" }, QUOTE), "gone");
  assert.equal(stateAt({ status: 503, text: "" }, QUOTE), null, "an outage is not a moved source");
  assert.equal(stateAt({ status: 0, text: "" }, QUOTE), null);
});

test("only pinned GitHub sources with a quote, of claims still current", () => {
  const p = pinnedSources(claims);
  assert.deepEqual(
    p.map((s) => [s.claim, s.source, s.repo, s.path, s.commit]),
    [
      ["taproot.speedy-trial", 0, "bitcoin/bitcoin", "src/chainparams.cpp", PIN],
      ["taproot.speedy-trial", 1, "bitcoin/bips", "bip-0341.mediawiki", BIPS],
    ],
  );
});

test("the step: states, a kept head read again for nothing, an outage keeping the last reading", async () => {
  const file = process.env.BLOCKLORE_AT_HEAD_FILE as string;
  let height = 977340;
  const chain = { name: "test", tipHeight: async () => height } as never;
  const heads: Record<string, string> = { "bitcoin/bitcoin": HEAD1, "bitcoin/bips": BIPS };
  const files: Record<string, FileRead> = {
    [`bitcoin/bitcoin@${HEAD1}:src/chainparams.cpp`]: { status: 200, text: "// Taproot exception" },
    [`bitcoin/bitcoin@${HEAD2}:src/chainparams.cpp`]: { status: 503, text: "" },
  };
  const reads: string[] = [];
  const run = () =>
    readAtHead(
      { commit: false, push: false },
      {
        claims,
        chain,
        head: (repo) => ({ sha: heads[repo] as string, branch: "master" }),
        read: async (repo, commit, f) => {
          reads.push(`${repo}@${commit.slice(0, 4)}:${f}`);
          return files[`${repo}@${commit}:${f}`] ?? { status: 404, text: "" };
        },
      },
    );
  const reading = () => AtHead.parse(JSON.parse(readFileSync(file, "utf8")));
  try {
    assert.equal(await run(), 1, "one passage moved on");
    let r = reading();
    assert.deepEqual(
      r.sources.map((s) => [s.claim, s.source, s.state, s.since.height]),
      [
        ["taproot.speedy-trial", 0, "changed", 977340],
        // The bips head is the pinned commit: current without a read.
        ["taproot.speedy-trial", 1, "current", 977340],
      ],
    );
    assert.deepEqual(reads, ["bitcoin/bitcoin@dbe9:src/chainparams.cpp"]);
    assert.deepEqual(
      feed().map((e) => [e.kind, e.text, e.claims, e.outcome, e.n]),
      [
        [
          "recheck",
          "Read 2 cited passages again at their repositories' heads: 1 newly moved on from what its claim cites",
          ["taproot.speedy-trial"],
          "changed",
          undefined,
        ],
      ],
      "the live feed says what moved, and counts no claim as rechecked",
    );
    assert.deepEqual(
      r.heads.map((h) => [h.repo, h.commit]),
      [
        ["bitcoin/bips", BIPS],
        ["bitcoin/bitcoin", HEAD1],
      ],
    );

    reads.length = 0;
    height = 977341;
    await run();
    r = reading();
    assert.deepEqual(reads, [], "no head moved, nothing read");
    assert.deepEqual(
      feed()
        .map((e) => [e.text, e.outcome])
        .at(-1),
      ["Read 2 cited passages again at their repositories' heads: 1 still there, 1 moved on", "ok"],
    );
    assert.equal(r.read.height, 977341);
    assert.equal(
      r.sources[0]?.since.height,
      977340,
      "since stays at the first reading in this state",
    );

    heads["bitcoin/bitcoin"] = HEAD2;
    height = 977342;
    await run();
    r = reading();
    assert.deepEqual(reads, [`bitcoin/bitcoin@1111:src/chainparams.cpp`]);
    assert.deepEqual(
      [r.sources[0]?.state, r.sources[0]?.since.height, r.sources[0]?.head],
      ["changed", 977340, HEAD1],
      "a 503 at the new head keeps the last reading, at the head it was read at",
    );

    reads.length = 0;
    files[`bitcoin/bitcoin@${HEAD2}:src/chainparams.cpp`] = { status: 200, text: `  ${QUOTE}` };
    await run();
    r = reading();
    assert.deepEqual(reads, [`bitcoin/bitcoin@1111:src/chainparams.cpp`], "read again, not reused");
    assert.deepEqual(
      [r.sources[0]?.state, r.sources[0]?.since.height, r.sources[0]?.head],
      ["current", 977342, HEAD2],
    );
  } finally {
    rmSync(file, { force: true });
  }
});
