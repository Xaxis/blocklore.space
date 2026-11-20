import assert from "node:assert/strict";
import { test } from "node:test";
import { btc, nextHalvingHeight, nextRetargetHeight, subsidySats } from "../src/chain.ts";

test("the subsidy follows GetBlockSubsidy at every boundary", () => {
  assert.equal(subsidySats(0), 5_000_000_000);
  assert.equal(subsidySats(209_999), 5_000_000_000);
  assert.equal(subsidySats(210_000), 2_500_000_000);
  assert.equal(subsidySats(840_000), 312_500_000);
  assert.equal(subsidySats(1_050_000), 156_250_000);
  assert.equal(subsidySats(6_929_999), 1, "33rd era pays one sat");
  assert.equal(subsidySats(6_930_000), 0);
  assert.equal(subsidySats(64 * 210_000), 0, "64 halvings and on is zero, not a wrapped shift");
});

test("halving and retarget heights, and BTC text", () => {
  assert.equal(nextHalvingHeight(976_754), 1_050_000);
  assert.equal(nextHalvingHeight(840_000), 1_050_000);
  assert.equal(nextRetargetHeight(976_754), 977_760);
  assert.equal(btc(312_500_000), "3.125");
  assert.equal(btc(5_000_000_000), "50");
  assert.equal(btc(1), "0.00000001");
});
