import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  GatePolicy,
  type GatePolicyView,
  gatePolicyView,
  type PolicyCommand,
} from "@blocklore/core";
import { signCommand } from "@blocklore/core/control";
import { loadStore } from "@blocklore/core/node";
import { parse, parseDocument } from "yaml";
import { controlStore } from "../src/control.ts";
import { type DispatchDeps, dispatch } from "../src/daemon.ts";
import { formatYaml, LONG, needsLock } from "../src/jobs.ts";
import { checkPolicy, editPolicy } from "../src/policy.ts";
import { agenda } from "../src/research.ts";
import { POLICY_FILE } from "../src/store.ts";

// The owner's real gate policy, read and never written: every edit must keep its comments, its
// order and every line it does not touch, and an edit followed by its undo must give the file back
// byte for byte. A made-up topic stands for one the file does not list, so the test holds whatever
// the owner lists later.
const REAL = readFileSync(
  path.join(import.meta.dirname, "..", "..", "brain", "policy", "topics.yaml"),
  "utf8",
);
const UNLISTED = "made-up-topic-of-this-test";

/** The view as the daemon would build it from a checkout holding `text`. */
const viewOf = (text: string): GatePolicyView =>
  gatePolicyView({
    policy: GatePolicy.parse(parse(text)),
    agenda: [...agenda(), { slug: UNLISTED, title: "A made-up topic of this test" }],
    published: loadStore().store.topics.map((t) => ({ slug: t.slug, title: t.title })),
    waiting: new Map([[UNLISTED, 3]]),
    head: "test",
  });

/** One command as the job applies it: edit, format as lint does, check against the text before. */
const apply = (text: string, cmd: PolicyCommand) => {
  const edit = editPolicy(text, cmd, viewOf(text));
  const out = formatYaml(edit.text, POLICY_FILE);
  checkPolicy(text, out, cmd);
  return { text: out, message: edit.message };
};

const linesOf = (s: string) => s.split("\n");
const added = (before: string, after: string) =>
  linesOf(after).filter((l) => !linesOf(before).includes(l));
const removed = (before: string, after: string) =>
  linesOf(before).filter((l) => !linesOf(after).includes(l));
/** The comment and blank lines, in order: none may be lost or moved. */
const comments = (s: string) => linesOf(s).filter((l) => l.startsWith("#") || l.trim() === "");
const sections = (s: string) =>
  linesOf(s)
    .filter((l) => /^[a-z_]+:/.test(l))
    .map((l) => l.split(":")[0]);
const topicOrder = (s: string) => Object.keys(GatePolicy.parse(parse(s)).topics);

test("listing an unlisted topic adds its one line at the end of topics and keeps every comment", () => {
  assert.equal(formatYaml(REAL, POLICY_FILE), REAL, "the real policy is as lint formats it");
  const before = viewOf(REAL).topics.find((t) => t.slug === UNLISTED);
  assert.equal(before?.listed, null, "the made-up topic is not listed");
  assert.equal(before?.waiting, 3);

  const listed = apply(REAL, {
    type: "policy.topic",
    slug: UNLISTED,
    contested: false,
    safety: false,
  });
  assert.deepEqual(added(REAL, listed.text), [
    `  ${UNLISTED}: { contested: false, safety: false }`,
  ]);
  assert.deepEqual(removed(REAL, listed.text), []);
  assert.deepEqual(comments(listed.text), comments(REAL), "every comment and blank line kept");
  assert.deepEqual(sections(listed.text), sections(REAL), "sections in the owner's order");
  assert.deepEqual(topicOrder(listed.text), [...topicOrder(REAL), UNLISTED]);
  // Right after the last topic, before the blank line and the terms' comment.
  const lines = linesOf(listed.text);
  const at = lines.indexOf(`  ${UNLISTED}: { contested: false, safety: false }`);
  assert.match(
    lines[at - 1] ?? "",
    /^ {2}[a-z0-9-]+: \{ contested: (true|false), safety: (true|false) \}$/,
  );
  assert.equal(lines[at + 1], "");
  assert.match(
    listed.message,
    new RegExp(
      `^List ${UNLISTED} in the gate policy as neither contested nor safety advice, as the owner asked in the admin, so a new claim on it waits for the evaluator only for a reason of its own\\.$`,
    ),
  );
  assert.deepEqual(viewOf(listed.text).topics.find((t) => t.slug === UNLISTED)?.listed, {
    contested: false,
    safety: false,
  });

  const both = apply(REAL, { type: "policy.topic", slug: UNLISTED, contested: true, safety: true });
  assert.deepEqual(added(REAL, both.text), [`  ${UNLISTED}: { contested: true, safety: true }`]);
  assert.match(
    both.message,
    /as contested and safety advice, .* and needs two independent sources\.$/,
  );
});

test("flipping a listed topic's flags changes only its line, and flipping back gives the file back byte for byte", () => {
  const [slug, flags] = Object.entries(GatePolicy.parse(parse(REAL)).topics)[0] ?? [];
  assert.ok(slug && flags);
  const flipped = { contested: !flags.contested, safety: !flags.safety };
  const once = apply(REAL, { type: "policy.topic", slug, ...flipped });
  assert.deepEqual(added(REAL, once.text), [
    `  ${slug}: { contested: ${flipped.contested}, safety: ${flipped.safety} }`,
  ]);
  assert.deepEqual(removed(REAL, once.text), [
    `  ${slug}: { contested: ${flags.contested}, safety: ${flags.safety} }`,
  ]);
  assert.deepEqual(comments(once.text), comments(REAL));
  assert.deepEqual(topicOrder(once.text), topicOrder(REAL), "the topic keeps its place");
  assert.match(once.message, new RegExp(`^Set ${slug} in the gate policy to `));

  const back = apply(once.text, { type: "policy.topic", slug, ...flags });
  assert.equal(back.text, REAL, "the undo gives the owner's file back byte for byte");

  // One flag at a time, too.
  const safety = apply(REAL, { type: "policy.topic", slug, ...flags, safety: !flags.safety });
  assert.equal(added(REAL, safety.text).length, 1);
  assert.equal(apply(safety.text, { type: "policy.topic", slug, ...flags }).text, REAL);
});

test("adding a term adds one line at the end of the list; removing it gives the file back byte for byte", () => {
  const terms = GatePolicy.parse(parse(REAL)).contested_terms;
  const plus = apply(REAL, { type: "policy.term", term: "made-up term", add: true });
  assert.deepEqual(added(REAL, plus.text), ["  - made-up term"]);
  assert.deepEqual(removed(REAL, plus.text), []);
  assert.deepEqual(comments(plus.text), comments(REAL));
  assert.deepEqual(GatePolicy.parse(parse(plus.text)).contested_terms, [...terms, "made-up term"]);
  assert.match(
    plus.message,
    /^Add "made-up term" to the gate policy's contested terms, as the owner asked in the admin, so a new claim that names it waits for the evaluator on any topic\.$/,
  );
  const minus = apply(plus.text, { type: "policy.term", term: "made-up term", add: false });
  assert.equal(minus.text, REAL, "the undo gives the owner's file back byte for byte");
  assert.match(minus.message, /^Take "made-up term" off the gate policy's contested terms/);

  // A term YAML would read as something else is quoted, and still reads back as the words.
  const odd = apply(REAL, { type: "policy.term", term: "null: #1", add: true });
  assert.equal(GatePolicy.parse(parse(odd.text)).contested_terms.at(-1), "null: #1");

  // Removing one of the owner's own terms takes out its line and nothing else.
  const first = terms[0] ?? "";
  const gone = apply(REAL, { type: "policy.term", term: first, add: false });
  assert.deepEqual(removed(REAL, gone.text), [`  - ${first}`]);
  assert.deepEqual(added(REAL, gone.text), []);
  assert.deepEqual(GatePolicy.parse(parse(gone.text)).contested_terms, terms.slice(1));
});

test("a command that does not fit the policy is refused before anything is written", () => {
  const refused = (cmd: PolicyCommand, why: RegExp) =>
    assert.throws(() => editPolicy(REAL, cmd, viewOf(REAL)), why);
  refused(
    { type: "policy.topic", slug: "no-such-topic", contested: false, safety: false },
    /no-such-topic is neither on the agenda nor published/,
  );
  const [slug, flags] = Object.entries(GatePolicy.parse(parse(REAL)).topics)[0] ?? [];
  assert.ok(slug && flags);
  refused({ type: "policy.topic", slug, ...flags }, /already sets/);
  const term = GatePolicy.parse(parse(REAL)).contested_terms[0] ?? "";
  refused({ type: "policy.term", term: term.toLowerCase(), add: true }, /already a contested term/);
  refused({ type: "policy.term", term: "made-up term", add: false }, /not a contested term/);
});

test("the job refuses an edit whose result does not parse, says something else, or changes another line", () => {
  const cmd: PolicyCommand = {
    type: "policy.topic",
    slug: UNLISTED,
    contested: false,
    safety: false,
  };
  const good = apply(REAL, cmd).text;
  assert.equal(checkPolicy(REAL, good, cmd).topics[UNLISTED]?.contested, false);
  assert.throws(() => checkPolicy(REAL, `${good}\ntopics: [`, cmd), /does not parse/);
  const changed = (path: (string | number)[], value: unknown) => {
    const doc = parseDocument(good);
    doc.setIn(path, value);
    return doc.toString({ lineWidth: 100 });
  };
  assert.throws(
    () => checkPolicy(REAL, changed(["topics", UNLISTED, "contested"], "no"), cmd),
    /does not match its schema/,
  );
  const [other] = Object.keys(GatePolicy.parse(parse(REAL)).topics);
  assert.throws(
    () => checkPolicy(REAL, changed(["topics", other ?? "", "safety"], true), cmd),
    /does not say what the owner asked, and only that/,
  );
  assert.throws(
    () => checkPolicy(REAL, changed(["contested_terms", 0], "something else"), cmd),
    /does not say what the owner asked/,
  );
  // Same data, but a comment lost or another entry rewritten: the lines tell.
  assert.throws(
    () => checkPolicy(REAL, good.replace(/^# .*\n/m, ""), cmd),
    /changes lines of the gate policy other than the one it is for/,
  );
  assert.throws(
    () => checkPolicy(REAL, good.replace(`  ${other}: { contested`, `  ${other}: {contested`), cmd),
    /changes lines/,
  );
});

test("a signed gate policy command is queued as a job under the tick lock; a forged one is not", () => {
  for (const t of ["policy.topic", "policy.term"] as const) {
    assert.ok(LONG.has(t), t);
    assert.ok(needsLock(t), t);
  }
  const KEY = "c".repeat(64);
  const now = new Date("2026-11-23T12:00:00.000Z");
  const control = controlStore(mkdtempSync(path.join(tmpdir(), "bl-control-")));
  const deps: DispatchDeps = {
    control,
    key: KEY,
    now: () => now,
    pending: () => [],
    stopSession: () => ({ ok: true, message: "" }),
    host: "devbox",
    head: () => "abc123",
  };
  const cmd: PolicyCommand = {
    type: "policy.topic",
    slug: "p2p-network",
    contested: false,
    safety: false,
  };
  const signed = signCommand(KEY, {
    id: "00000000-0000-4000-8000-000000000011",
    at: "2026-11-23T11:59:30.000Z",
    by: "owner@example.com",
    cmd,
  });
  const forged = {
    ...signed,
    id: "00000000-0000-4000-8000-000000000012",
    cmd: { ...cmd, safety: true },
  };
  assert.deepEqual(dispatch(forged, deps), []);
  assert.deepEqual(control.jobs(), []);
  const [r] = dispatch(signed, deps);
  assert.equal(r?.phase, "received");
  assert.deepEqual(
    control.jobs().map((j) => [j.type, j.by]),
    [["policy.topic", "owner"]],
  );
  assert.deepEqual(control.readJobCommand(signed.id), cmd);
  assert.equal(readFileSync(POLICY_FILE, "utf8"), REAL, "nothing here wrote the owner's file");
});
