import assert from "node:assert/strict";
import { test } from "node:test";
import { atHeadOf, compareUrl, pinnedGitHub } from "../src/athead.ts";
import type { AtHead } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

const PIN = "a0988140b71485ad12c3c3a4a9573f7c21b1eff8";
const HEAD = "dbe9eacd17ae1cc24581081613123a40b44a9f31";
const OLD = "1".repeat(40);
const url = `https://github.com/bitcoin/bitcoin/blob/${PIN}/src/chainparams.cpp#L120`;
const at = (height: number) => ({ time: "2026-11-24T07:39:10Z", height });

test("a pinned GitHub link names its repository, commit and file; nothing else does", () => {
  assert.deepEqual(pinnedGitHub(url), {
    repo: "bitcoin/bitcoin",
    commit: PIN,
    path: "src/chainparams.cpp",
  });
  assert.deepEqual(
    pinnedGitHub(`https://github.com/lightning/bolts/blob/${PIN}/02-peer-protocol.md?plain=1#L5`),
    { repo: "lightning/bolts", commit: PIN, path: "02-peer-protocol.md" },
  );
  assert.equal(
    pinnedGitHub("https://github.com/bitcoin/bitcoin/blob/master/src/chainparams.cpp"),
    null,
  );
  assert.equal(pinnedGitHub(`https://github.com/bitcoin/bitcoin/tree/${PIN}/src`), null);
  assert.equal(pinnedGitHub("https://bitcoinops.org/en/topics/taproot/"), null);
  assert.equal(pinnedGitHub(undefined), null);
});

test("a claim's sources as read at head, joined by index and only while it cites the same URL", () => {
  const c = claim({
    id: "taproot.speedy-trial",
    topics: ["taproot"],
    sources: [
      { ...claim().sources[0], url: "https://bitcoinops.org/en/topics/taproot/" } as never,
      { ...claim().sources[0], url } as never,
    ],
  });
  const reading: AtHead = {
    read: at(977341),
    heads: [{ repo: "bitcoin/bitcoin", branch: "master", commit: HEAD }],
    sources: [
      {
        claim: "taproot.speedy-trial",
        source: 1,
        url,
        head: OLD,
        state: "changed",
        since: at(977300),
      },
      // Another claim's reading, and one for a URL this claim no longer cites at that index.
      {
        claim: "taproot.three-bips",
        source: 1,
        url,
        head: HEAD,
        state: "changed",
        since: at(977300),
      },
      {
        claim: "taproot.speedy-trial",
        source: 0,
        url,
        head: HEAD,
        state: "gone",
        since: at(977300),
      },
    ],
  };
  const [a, ...rest] = atHeadOf(c, reading);
  assert.equal(rest.length, 0);
  assert.deepEqual(a, {
    source: 1,
    repo: "bitcoin/bitcoin",
    path: "src/chainparams.cpp",
    pinned: PIN,
    branch: "master",
    // The head this passage was read at, which an outage can leave behind the repository's.
    head: OLD,
    state: "changed",
    since: at(977300),
    read: at(977341),
  });
  assert.equal(
    compareUrl(a as NonNullable<typeof a>),
    `https://github.com/bitcoin/bitcoin/compare/${PIN}...${OLD}`,
  );
  assert.deepEqual(atHeadOf(c, null), []);
  assert.deepEqual(
    atHeadOf(c, { ...reading, heads: [] }),
    [],
    "a repository whose head was never read",
  );
});
