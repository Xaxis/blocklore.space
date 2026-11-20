import assert from "node:assert/strict";
import { test } from "node:test";
import { allowed, isApi, parseRobots } from "../src/robots.ts";

// Excerpts of github.com/robots.txt and gnusha.org/robots.txt as read on 2026-11-20.
const GITHUB = `User-agent: baidu
crawl-delay: 1

User-agent: *
Allow: /*?tab=achievements&achievement=*
Disallow: /*/raw/
Disallow: /*/tree/
Disallow: /*.git$
Disallow: /*.atom$
Disallow: /*/*/commits/
Disallow: /search$
`;
const GNUSHA = `User-agent: *
Disallow: /~bryan/papers2/*
Disallow: /cgit/*/commit/*
Crawl-delay: 10

User-agent: ia_archiver
Disallow: /cgit/meetlog/*
`;

test("GitHub's rules keep the bot off Atom feeds and commit lists, not off code or PRs", () => {
  const r = parseRobots(GITHUB);
  assert.equal(r.crawlDelay, undefined, "baidu's delay is not ours");
  assert.equal(allowed(r, "/bitcoin/bitcoin/commits/master.atom"), false);
  assert.equal(allowed(r, "/bitcoin/bitcoin/releases.atom"), false);
  assert.equal(allowed(r, "/bitcoin/bitcoin/pull/30000"), true);
  assert.equal(
    allowed(r, "/bitcoin/bitcoin/commit/f498a5a6718d9157b6afb85412c3462439117702"),
    true,
  );
  assert.equal(allowed(r, "/bitcoin/bitcoin/blob/master/src/validation.cpp"), true);
  assert.equal(allowed(r, "/bitcoin/bitcoin.git"), false);
  assert.equal(allowed(r, "/bitcoin/bitcoin.git/info/refs?service=git-upload-pack"), true);
  assert.equal(allowed(r, "/search"), false);
  assert.equal(allowed(r, "/search/advanced?x"), true, "$ anchors the end");
});

test("gnusha's crawl delay applies, and its archive stays readable", () => {
  const r = parseRobots(GNUSHA);
  assert.equal(r.crawlDelay, 10);
  assert.equal(allowed(r, "/pi/bitcoindev/new.atom"), true);
  assert.equal(allowed(r, "/cgit/bitcoin/commit/abc"), false);
  assert.equal(allowed(r, "/cgit/meetlog/x"), true, "ia_archiver's rule is not ours");
});

test("a group naming BlockloreBot beats *, the longest rule wins, and Allow wins a tie", () => {
  const r = parseRobots(
    "User-agent: *\nDisallow: /\n\nUser-agent: BlockloreBot\nDisallow: /private/\nAllow: /private/ok\nDisallow: /tie\nAllow: /tie\n",
  );
  assert.equal(allowed(r, "/anything"), true);
  assert.equal(allowed(r, "/private/x"), false);
  assert.equal(allowed(r, "/private/ok/1"), true);
  assert.equal(allowed(r, "/tie"), true);
  assert.equal(allowed(parseRobots(""), "/x"), true);
});

test("APIs are exempt, pages are not", () => {
  assert.equal(isApi(new URL("https://api.github.com/repos/bitcoin/bitcoin")), true);
  assert.equal(isApi(new URL("https://mempool.space/api/blocks/tip/height")), true);
  assert.equal(isApi(new URL("https://bitcoinops.org/en/newsletters/")), false);
});
