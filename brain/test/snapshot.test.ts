import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarAllowed } from "../src/snapshot.ts";

test("only the reference whitelist's calendars may be contacted", () => {
  assert.ok(calendarAllowed("https://alice.btc.calendar.opentimestamps.org"));
  assert.ok(calendarAllowed("https://finney.calendar.eternitywall.com"));
  assert.ok(calendarAllowed("https://btc.calendar.catallaxy.com"));
  assert.ok(!calendarAllowed("http://alice.btc.calendar.opentimestamps.org"));
  assert.ok(!calendarAllowed("https://calendar.opentimestamps.org.evil.example"));
  assert.ok(!calendarAllowed("https://alice.btc.calendar.opentimestamps.org/../x"));
  assert.ok(!calendarAllowed("https://127.0.0.1"));
  assert.ok(!calendarAllowed("not a url"));
});
