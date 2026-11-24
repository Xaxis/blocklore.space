// The owner's links between published claims and threats (ADMIN.md, "Threat map"), in a copy of
// the real store: the job's own steps (edit, format as lint does, check) change one list of one
// threat file and nothing else, the gap closes in the view and the bundle, the undo gives the file
// back byte for byte, a command that does not fit is refused before anything is written, and a
// signed command is queued as a job under the tick lock.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ThreatCommand } from "@blocklore/core";
import { parseDocument } from "yaml";

const REAL = path.join(import.meta.dirname, "..", "..", "knowledge");
const ROOT = mkdtempSync(path.join(tmpdir(), "bl-threats-"));
const KNOWLEDGE = path.join(ROOT, "knowledge");
cpSync(REAL, KNOWLEDGE, { recursive: true });
process.env.BLOCKLORE_KNOWLEDGE = KNOWLEDGE;

const { compile } = await import("@blocklore/core");
const { signCommand } = await import("@blocklore/core/control");
const { loadStore } = await import("@blocklore/core/node");
const { controlStore } = await import("../src/control.ts");
const { dispatch } = await import("../src/daemon.ts");
const { formatYaml, LONG, needsLock } = await import("../src/jobs.ts");
const { checkThreat, editThreat, threatFile, threatView } = await import(
  "../src/security/threatlinks.ts"
);

/** One command as the job applies it: edit, format as lint does, check against the text before. */
const apply = (cmd: ThreatCommand) => {
  const file = threatFile(cmd.threat);
  const before = readFileSync(file, "utf8");
  const edit = editThreat(before, cmd, threatView("test"));
  const text = formatYaml(edit.text, file);
  checkThreat(before, text, cmd);
  return { before, text, message: edit.message };
};

const lines = (s: string) => s.split("\n");
const changed = (before: string, after: string) => ({
  added: lines(after).filter((l) => !lines(before).includes(l)),
  removed: lines(before).filter((l) => !lines(after).includes(l)),
});

// A made-up threat that names the first published claim by three plain words of its own statement,
// so the test holds whatever the owner links on the real map later. Each test that changes it
// starts from a fresh copy, so one failure does not spill into the next.
const { store } = loadStore(KNOWLEDGE);
const first = store.claims.find((c) => c.status !== "withdrawn");
assert.ok(first, "the store has a published claim");
const words = first.statement.split(/\s+/);
const at = words.findIndex((_, i) =>
  words.slice(i, i + 3).every((w) => /^[\p{L}\p{N}]{2,}$/u.test(w)),
);
assert.ok(at >= 0, "the claim has three plain words in a row");
const phrase = words.slice(at, at + 3).join(" ");
const MADE_UP = "made-up-threat-of-this-test";
const FIXTURE = [
  `id: ${MADE_UP}`,
  'title: "A made-up threat of this test"',
  "layer: people",
  "status: open",
  `topic: ${first.topics[0]}`,
  "claims: []",
  "mitigations: []",
  "history: []",
  "watches: []",
  "lab: []",
  `terms: [${phrase}]`,
  "",
].join("\n");
const fresh = () => writeFileSync(threatFile(MADE_UP), FIXTURE);
fresh();

test("every real threat file is as lint formats it, so an edit changes only its own line", () => {
  const dir = path.join(REAL, "security", "threats");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml"))) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.equal(formatYaml(text, path.join(dir, f)), text, f);
  }
});

test("linking a suggested claim closes the gap in the view and the bundle; unlinking gives the file back", () => {
  fresh();
  const before = threatView("test").threats.find((t) => t.id === MADE_UP);
  assert.deepEqual(before?.missing, ["claims", "mitigations"]);
  assert.ok(
    before?.suggestions.some((s) => s.id === first.id && s.onTopic),
    "code suggests the claim that names it, on its topic",
  );

  const link: ThreatCommand = {
    type: "threat.link",
    threat: MADE_UP,
    part: "claims",
    claim: first.id,
  };
  const linked = apply(link);
  assert.deepEqual(changed(linked.before, linked.text), {
    added: [`claims: [${first.id}]`],
    removed: ["claims: []"],
  });
  assert.match(linked.message, new RegExp(`^Link ${first.id.replace(".", "\\.")} to the threat`));
  writeFileSync(threatFile(MADE_UP), linked.text);

  const after = threatView("test").threats.find((t) => t.id === MADE_UP);
  assert.deepEqual(after?.missing, ["mitigations"], "it says what the threat is now");
  assert.deepEqual(
    after?.claims.map((c) => [c.id, c.published]),
    [[first.id, true]],
  );
  assert.ok(!after?.suggestions.some((s) => s.id === first.id), "no longer suggested");
  const { bundle, issues } = compile(loadStore(KNOWLEDGE).store, {
    time: "2026-11-24T12:00:00Z",
    height: 977500,
  });
  assert.deepEqual(
    issues.filter((i) => i.file.includes(MADE_UP)),
    [],
    "the linked map compiles",
  );
  const gap = bundle.security.gaps.find((g) => g.id === MADE_UP);
  assert.deepEqual(gap?.missing, ["mitigations"]);

  const unlinked = apply({ ...link, type: "threat.unlink" });
  assert.equal(unlinked.text, linked.before, "the undo gives the file back byte for byte");
  writeFileSync(threatFile(MADE_UP), unlinked.text);
});

test("a link to a real threat's list appends to it, and its undo restores the file", () => {
  const view = threatView("test");
  const t = view.threats.find((x) => x.claims.length > 0 && x.id !== MADE_UP);
  assert.ok(t, "a real threat lists a claim");
  const claim = view.published.find(
    (id) => !t.claims.some((c) => c.id === id) && !t.mitigations.some((c) => c.id === id),
  );
  assert.ok(claim);
  const cmd: ThreatCommand = { type: "threat.link", threat: t.id, part: "claims", claim };
  const linked = apply(cmd);
  const ids = t.claims.map((c) => c.id);
  assert.deepEqual(changed(linked.before, linked.text), {
    added: [`claims: [${[...ids, claim].join(", ")}]`],
    removed: [`claims: [${ids.join(", ")}]`],
  });
  writeFileSync(threatFile(t.id), linked.text);
  const undone = apply({ ...cmd, type: "threat.unlink" });
  assert.equal(undone.text, linked.before);
  writeFileSync(threatFile(t.id), undone.text);
});

test("a command that does not fit the map is refused before anything is written", () => {
  fresh();
  const view = threatView("test");
  const text = readFileSync(threatFile(MADE_UP), "utf8");
  const refused = (cmd: ThreatCommand, why: RegExp) =>
    assert.throws(() => editThreat(text, cmd, view), why);
  const base = { threat: MADE_UP, part: "claims" as const, claim: first.id };
  refused({ type: "threat.link", ...base, threat: "no-such-threat" }, /no threat no-such-threat/);
  refused({ type: "threat.link", ...base, claim: "self-custody.made-up" }, /not a published/);
  refused({ type: "threat.unlink", ...base }, /does not list/);
  // The file the command names must be that threat's, whatever the view says.
  assert.throws(
    () =>
      editThreat(
        readFileSync(threatFile("phishing"), "utf8"),
        { type: "threat.link", ...base },
        view,
      ),
    /not the threat made-up-threat-of-this-test/,
  );
  assert.equal(readFileSync(threatFile(MADE_UP), "utf8"), text);
});

test("the job refuses an edit whose result does not parse, says something else, or changes another line", () => {
  fresh();
  const cmd: ThreatCommand = {
    type: "threat.link",
    threat: MADE_UP,
    part: "mitigations",
    claim: first.id,
  };
  const { before, text: good } = apply(cmd);
  assert.deepEqual(checkThreat(before, good, cmd).mitigations, [first.id]);
  assert.throws(() => checkThreat(before, `${good}\nclaims: [`, cmd), /does not parse/);
  const edited = (key: string, value: unknown) => {
    const doc = parseDocument(good);
    doc.set(key, value);
    return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  };
  assert.throws(() => checkThreat(before, edited("status", "fine"), cmd), /schema/);
  assert.throws(
    () => checkThreat(before, edited("claims", [first.id]), cmd),
    /does not say what the owner asked, and only that/,
  );
  assert.throws(
    () =>
      checkThreat(
        before,
        good.replace('title: "A made-up', "title: 'A made-up").replace('test"', "test'"),
        cmd,
      ),
    /changes lines of the threat other than the list/,
  );
});

test("a signed threat command is queued as a job under the tick lock; a forged one is not", () => {
  for (const t of ["threat.link", "threat.unlink"] as const) {
    assert.ok(LONG.has(t), t);
    assert.ok(needsLock(t), t);
  }
  const KEY = "d".repeat(64);
  const now = new Date("2026-11-24T12:00:00.000Z");
  const control = controlStore(mkdtempSync(path.join(tmpdir(), "bl-control-")));
  const cmd: ThreatCommand = {
    type: "threat.link",
    threat: "phishing",
    part: "claims",
    claim: first.id,
  };
  const signed = signCommand(KEY, {
    id: "00000000-0000-4000-8000-000000000021",
    at: "2026-11-24T11:59:30.000Z",
    by: "owner@example.com",
    cmd,
  });
  const forged = {
    ...signed,
    id: "00000000-0000-4000-8000-000000000022",
    cmd: { ...cmd, part: "mitigations" },
  };
  const deps = {
    control,
    key: KEY,
    now: () => now,
    pending: () => [],
    stopSession: () => ({ ok: true, message: "" }),
    host: "devbox",
    head: () => "abc123",
  };
  const phishing = readFileSync(threatFile("phishing"), "utf8");
  assert.deepEqual(dispatch(forged, deps), []);
  assert.deepEqual(control.jobs(), []);
  const [r] = dispatch(signed, deps);
  assert.equal(r?.phase, "received");
  assert.deepEqual(
    control.jobs().map((j) => [j.type, j.by]),
    [["threat.link", "owner"]],
  );
  assert.deepEqual(control.readJobCommand(signed.id), cmd);
  assert.equal(readFileSync(threatFile("phishing"), "utf8"), phishing, "nothing here wrote it");
});
