import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { compile } from "../src/bundle.ts";
import { loadStore } from "../src/node/load.ts";
import { claim } from "./fixtures.ts";

test("an open failed recheck travels from knowledge/rechecks.json onto its bundle claim", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "blocklore-rechecks-"));
  try {
    const knowledge = path.join(dir, "knowledge");
    const c = claim();
    const other = claim({ id: "halvings.other" });
    mkdirSync(path.join(knowledge, "claims", "halvings"), { recursive: true });
    for (const x of [c, other])
      writeFileSync(path.join(knowledge, "claims", "halvings", `${x.id}.yaml`), stringify(x));
    const at = { time: "2026-11-21T03:00:00Z", height: 976900 };
    writeFileSync(
      path.join(knowledge, "rechecks.json"),
      JSON.stringify({ [c.id]: { at, problems: ["source 1: quote not found"] } }),
    );
    const { store, issues } = loadStore(knowledge);
    assert.deepEqual(
      issues.filter((i) => i.level === "error"),
      [],
    );
    const { bundle } = compile(store, at);
    assert.deepEqual(bundle.claims[c.id]?.recheck, { at, problems: ["source 1: quote not found"] });
    assert.equal(bundle.claims[other.id]?.recheck, null);

    writeFileSync(
      path.join(knowledge, "rechecks.json"),
      JSON.stringify({ [c.id]: { at, problems: [] } }),
    );
    const bad = loadStore(knowledge);
    assert.ok(bad.issues.some((i) => i.file === "knowledge/rechecks.json" && i.level === "error"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
