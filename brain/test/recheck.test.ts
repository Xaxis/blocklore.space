import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim, Rechecks } from "@blocklore/core";
import type { ClaimReport } from "../src/check.ts";
import { applyRecheck, problems, stalest } from "../src/recheck.ts";

const at = (height: number, time = "2026-11-20T00:00:00Z") => ({ time, height });
const c = (id: string, height: number, time?: string) =>
  ({ id, topics: ["t"], last_verified: { ...at(height, time), run: "r", method: "m" } }) as Claim;
const report = (over: Partial<ClaimReport>): ClaimReport => ({
  id: "x",
  ok: true,
  issues: [],
  sources: [],
  checks: [],
  method: "quotes 2/2, checks 1/1",
  ...over,
});

test("rechecks reach the least recently verified claims first, and rotate by id", () => {
  const order = stalest(
    [c("b", 10), c("a", 10), c("z", 5), c("c", 10, "2026-11-19T00:00:00Z"), c("new", 99)],
    4,
  ).map((x) => x.id);
  assert.deepEqual(order, ["z", "c", "a", "b"]);
});

test("a pass refreshes last_verified and closes an open failure; a failure leaves the claim alone", () => {
  const now = at(976900, "2026-11-21T03:00:00Z");
  const rechecks: Rechecks = { a: { at: at(1), problems: ["old"] } };
  const passed = applyRecheck(c("a", 10), report({}), now, "2026-11-21-reverify", rechecks);
  assert.deepEqual(passed?.last_verified, {
    ...now,
    run: "2026-11-21-reverify",
    method: "recheck, quotes 2/2, checks 1/1",
  });
  assert.equal(rechecks.a, undefined);

  const failing = report({
    ok: false,
    issues: [
      { level: "warning", where: "related", message: "not published" },
      { level: "error", where: "statement", message: "too long" },
    ],
    sources: [
      { index: 0, ok: true, quoteFound: true, injections: [] },
      { index: 1, ok: false, quoteFound: false, injections: [] },
      { index: 2, ok: false, quoteFound: false, injections: [], error: "HTTP 404" },
    ],
    checks: [
      { index: 0, type: "chain.subsidy", ok: false, detail: "got 0", command: "", backend: "" },
    ],
  });
  assert.equal(applyRecheck(c("b", 10), failing, now, "run", rechecks), null);
  assert.deepEqual(rechecks.b, {
    at: now,
    problems: [
      "statement: too long",
      "source 2: quote not found",
      "source 3: HTTP 404",
      "check 1 (chain.subsidy): got 0",
    ],
  });
  assert.deepEqual(problems(failing), rechecks.b?.problems);
});
