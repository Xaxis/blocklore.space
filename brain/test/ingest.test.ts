import assert from "node:assert/strict";
import { test } from "node:test";
import { isDue } from "../src/ingest.ts";

const at = (iso: string) => Date.parse(iso);
const LAST = "2026-11-21T23:03:31.000Z";

test("an hourly feed is due on the next hourly tick, even when the timer's jitter shortens the gap", () => {
  // The tick that skipped every feed on 2026-11-22: 58 minutes after the last poll.
  assert.equal(isDue(LAST, 60, at("2026-11-22T00:01:46.000Z")), true);
  assert.equal(
    isDue(LAST, 60, at("2026-11-21T23:58:31.000Z")),
    true,
    "55 minutes, the shortest gap",
  );
  assert.equal(
    isDue(LAST, 60, at("2026-11-21T23:40:00.000Z")),
    false,
    "a second run within the hour",
  );
});

test("a slow feed waits for its interval, less the same slack", () => {
  assert.equal(isDue(LAST, 360, at("2026-11-22T04:55:00.000Z")), true);
  assert.equal(isDue(LAST, 360, at("2026-11-22T04:00:00.000Z")), false);
});

test("a feed never polled is due", () => {
  assert.equal(isDue(undefined, 360, at(LAST)), true);
});
