// run.yaml in research's check report (brain/src/research.ts, checkRun): notes that do not parse
// used to vanish at publish without a word, so two 11-20 seed runs show no pages read. Now the
// report names run.yaml while research can still rewrite it, and a run whose notes parse gets no
// such report. In a temporary folder; nothing touches the network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";

const ROOT = mkdtempSync(path.join(tmpdir(), "bl-notes-"));
process.env.BLOCKLORE_KNOWLEDGE = path.join(ROOT, "knowledge");
process.env.BLOCKLORE_REVIEW_DIR = path.join(ROOT, "review");
process.env.BLOCKLORE_AGENT_ROOT = path.join(ROOT, "agent");
process.env.BLOCKLORE_CONTROL_DIR = path.join(ROOT, "control");
mkdirSync(path.join(ROOT, "knowledge", "claims"), { recursive: true });

const { checkRun, isNotesReport } = await import("../src/research.ts");

const chain = { name: "fake", tipHeight: async () => 977000 } as never;

function run(id: string, notes: string): string {
  const dir = path.join(ROOT, "agent", "staging", id);
  mkdirSync(path.join(dir, "claims"), { recursive: true });
  writeFileSync(path.join(dir, "run.yaml"), notes);
  return id;
}

const good = {
  summary: "Seeded the topic from the BOLTs and the implementations' docs.",
  read: [
    { url: "https://github.com/lightning/bolts/blob/master/00-introduction.md", why: "terms" },
  ],
  skipped: [],
  open: ["Network size needs a dated source with a method."],
  injections: [],
};

test("notes that do not match the format are reported as run.yaml, apart from the claims", async () => {
  // The 11-20 Lightning run's fault: an entry under open written as an object.
  const id = run(
    "2026-11-21-daily-lightning",
    stringify({ ...good, open: [{ question: "Network size", why: "no method" }] }),
  );
  const reports = await checkRun(id, chain, true);
  const notes = reports.filter(isNotesReport);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.id, "run.yaml");
  assert.equal(notes[0]?.ok, false);
  assert.match(notes[0]?.issues[0]?.message ?? "", /open\.0/);
});

test("notes that are not YAML at all are reported too", async () => {
  // The 11-20 self-custody run's fault: a quoted scalar followed by more text.
  const id = run(
    "2026-11-21-daily-self-custody",
    'summary: "Seeded the topic."\nopen:\n  - "Inheritance planning" covers only the technical side.\n',
  );
  const notes = (await checkRun(id, chain, true)).filter(isNotesReport);
  assert.equal(notes.length, 1);
  assert.match(notes[0]?.issues[0]?.message ?? "", /YAML|Unexpected/);
});

test("notes that parse add no report", async () => {
  const id = run("2026-11-21-daily-taproot", stringify(good));
  assert.deepEqual((await checkRun(id, chain, true)).filter(isNotesReport), []);
});
