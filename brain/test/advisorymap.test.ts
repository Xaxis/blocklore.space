import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  type AdvisoryAdminView,
  type AdvisoryCommand,
  AdvisoryMap,
  type AdvisoryRecord,
  advisoryAdminView,
  advisoryReport,
  type Threat,
} from "@blocklore/core";
import { signCommand } from "@blocklore/core/control";
import { loadStore } from "@blocklore/core/node";
import { parse, parseDocument } from "yaml";
import { controlStore } from "../src/control.ts";
import { type DispatchDeps, dispatch } from "../src/daemon.ts";
import { formatYaml, LONG, needsLock } from "../src/jobs.ts";
import {
  ADVISORY_MAP_FILE,
  checkAdvisoryMap,
  editAdvisoryMap,
} from "../src/security/advisorymap.ts";

// The owner's real map: every edit must keep its comments, its order and every line it does not
// touch, and an edit followed by its undo must give the file back byte for byte.
const REAL = readFileSync(
  path.join(import.meta.dirname, "..", "..", "knowledge", "security", "advisory-map.yaml"),
  "utf8",
);

const threat = (id: string, title: string, layer: Threat["layer"] = "network"): Threat => ({
  id,
  title,
  layer,
  status: "watching",
  topic: "p2p-network",
  claims: [],
  mitigations: [],
  history: [],
  watches: [],
  lab: [],
  terms: [],
});

// The real threat map (the owner's map names its threats), and one made-up threat whose record
// names a made-up CVE id, so the findings below are this test's own whatever NVD says later.
const threats = [
  ...(loadStore().store.security?.threats ?? []),
  {
    ...threat("made-up-threat", "A made-up threat of this test", "cryptography"),
    history: [
      {
        ref: "CVE-2099-0002",
        url: "https://nvd.nist.gov/vuln/detail/CVE-2099-0002",
        date: "2015-01-09",
      },
    ],
  },
];

const advisory: AdvisoryRecord = {
  source: "Bitcoin Core",
  title: "CVE-2099-0001 - A made-up advisory no rule files",
  url: "https://bitcoincore.org/en/2099/01/01/disclose-cve-2099-0001/",
  published: "2099-01-01T00:00:00Z",
  severity: "low",
  ids: ["CVE-2099-0001"],
};

/** The view as the daemon would build it from a checkout holding `text`. */
const viewOf = (text: string): AdvisoryAdminView => {
  const map = AdvisoryMap.parse(parse(text));
  const report = advisoryReport({
    threats,
    log: {
      updated: "2099-01-02T00:00:00Z",
      advisories: [advisory],
      nvd: [
        {
          id: "CVE-2099-0002",
          checked: "2099-01-02T00:00:00Z",
          found: true,
          status: "Modified",
          published: "2099-01-01T00:00:00Z",
          products: ["tukaani:xz", "red_hat:enterprise_linux"],
          description: "A made-up record of another project.",
        },
      ],
    },
    map,
  });
  return advisoryAdminView({ threats, report, map, head: "test" });
};

/** One command as the job applies it: edit, format as lint does, check, and the next view. */
const apply = (text: string, cmd: AdvisoryCommand) => {
  const edit = editAdvisoryMap(text, cmd, viewOf(text));
  const out = formatYaml(edit.text, ADVISORY_MAP_FILE);
  checkAdvisoryMap(out, cmd, threats);
  return { text: out, message: edit.message };
};

const linesOf = (s: string) => s.split("\n");
const added = (before: string, after: string) =>
  linesOf(after).filter((l) => !linesOf(before).includes(l));
const removed = (before: string, after: string) =>
  linesOf(before).filter((l) => !linesOf(after).includes(l));
/** Whether the real map's section is empty today (`assign: {}`), so an edit opens it as a block. */
const empty = (section: string) => linesOf(REAL).includes(`${section}: {}`);

test("filing an advisory adds one line under assign, keeps every comment, and its undo restores the file", () => {
  assert.equal(formatYaml(REAL, ADVISORY_MAP_FILE), REAL, "the real map is as lint formats it");
  const filed = apply(REAL, {
    type: "advisory.assign",
    advisory: "CVE-2099-0001",
    threats: ["peer-dos", "eclipse-attack"],
  });
  assert.deepEqual(added(REAL, filed.text), [
    ...(empty("assign") ? ["assign:"] : []),
    "  CVE-2099-0001: [peer-dos, eclipse-attack]",
  ]);
  assert.deepEqual(removed(REAL, filed.text), empty("assign") ? ["assign: {}"] : []);
  for (const comment of linesOf(REAL).filter((l) => l.startsWith("#")))
    assert.ok(linesOf(filed.text).includes(comment), `kept: ${comment}`);
  // Sections stay in the owner's order.
  const order = (t: string) =>
    linesOf(t)
      .filter((l) => /^[a-z]+:/.test(l))
      .map((l) => l.split(":")[0]);
  assert.deepEqual(order(filed.text), order(REAL));
  assert.match(
    filed.message,
    /^File CVE-2099-0001 under peer-dos and eclipse-attack, as the owner asked in the admin/,
  );
  assert.deepEqual(AdvisoryMap.parse(parse(filed.text)).assign["CVE-2099-0001"], [
    "peer-dos",
    "eclipse-attack",
  ]);
  assert.equal(viewOf(filed.text).unmatched.length, 0, "it is no longer an advisory to map");

  const undone = apply(filed.text, { type: "advisory.unassign", advisory: "CVE-2099-0001" });
  assert.equal(undone.text, REAL, "the undo gives the owner's file back byte for byte");
  assert.match(undone.message, /as the owner asked in the admin, so the rules file it again/);
  assert.equal(viewOf(undone.text).unmatched.length, 1);

  const none = apply(REAL, { type: "advisory.assign", advisory: "CVE-2099-0001", threats: [] });
  assert.deepEqual(added(REAL, none.text), [
    ...(empty("assign") ? ["assign:"] : []),
    "  CVE-2099-0001: []",
  ]);
  assert.match(none.message, /concerns no threat/);
});

test("settling an NVD finding makes a project from NVD's pair and expects it; the undo removes both", () => {
  const before = viewOf(REAL);
  assert.equal(before.findings[0]?.finding, "product");
  const settled = apply(REAL, {
    type: "advisory.expect",
    cve: "CVE-2099-0002",
    project: "xz",
    cpe: ["tukaani:xz"],
  });
  assert.deepEqual(
    added(REAL, settled.text).sort(),
    [
      '    cpe: ["tukaani:xz"]',
      "    pages: []",
      "    words: []",
      "  CVE-2099-0002: [xz]",
      "  xz:",
      ...(empty("expect") ? ["expect:"] : []),
    ].sort(),
  );
  assert.deepEqual(removed(REAL, settled.text), empty("expect") ? ["expect: {}"] : []);
  const after = viewOf(settled.text);
  assert.deepEqual(after.findings, [], "the finding is settled");
  assert.deepEqual(after.expected[0]?.made, ["xz"]);
  assert.match(settled.message, /^Expect NVD to name xz \(tukaani:xz\) for CVE-2099-0002/);

  const undone = apply(settled.text, { type: "advisory.unexpect", cve: "CVE-2099-0002" });
  assert.equal(undone.text, REAL, "the expectation and the project it made are gone");
  assert.match(undone.message, /and the project xz it made/);
  assert.equal(viewOf(undone.text).findings[0]?.finding, "product", "the finding is open again");
});

test("an edit that does not fit the map is refused before anything is written", () => {
  const refused = (cmd: AdvisoryCommand, why: RegExp) =>
    assert.throws(() => editAdvisoryMap(REAL, cmd, viewOf(REAL)), why);
  refused(
    { type: "advisory.assign", advisory: "CVE-2099-0001", threats: ["no-such-threat"] },
    /no threat no-such-threat/,
  );
  refused(
    { type: "advisory.assign", advisory: "CVE-2099-9999", threats: ["peer-dos"] },
    /not an advisory to map/,
  );
  refused({ type: "advisory.unassign", advisory: "CVE-2099-0001" }, /not placed/);
  refused(
    { type: "advisory.expect", cve: "CVE-2099-0002", project: "Bitcoin Core", cpe: ["tukaani:xz"] },
    /already has a project/,
  );
  refused(
    { type: "advisory.expect", cve: "CVE-2099-0002", project: "xz", cpe: ["openssl:openssl"] },
    /does not list openssl:openssl/,
  );
  refused({ type: "advisory.unexpect", cve: "CVE-2099-0002" }, /no expectation/);

  // The written text is checked as the file it becomes: its schema, the threat map, the style.
  const cmd: AdvisoryCommand = { type: "advisory.unexpect", cve: "CVE-2099-0002" };
  const changed = (key: string, path: string[], value: unknown) => {
    const doc = parseDocument(REAL);
    doc.setIn([key, ...path], value);
    return doc.toString();
  };
  assert.throws(
    () => checkAdvisoryMap(changed("expect", ["CVE-2099-0003"], ["Nobody"]), cmd, threats),
    /no product Nobody/,
  );
  assert.throws(
    () => checkAdvisoryMap(changed("assign", ["CVE-2099-0001"], ["ghost"]), cmd, threats),
    /no threat ghost/,
  );
  assert.throws(
    () => checkAdvisoryMap(changed("assign", [], ["oops"]), cmd, threats),
    /does not match its schema/,
  );
  const dash = String.fromCharCode(0x2014);
  assert.throws(() => checkAdvisoryMap(`# ${dash}\n${REAL}`, cmd, threats), /dash/);
  assert.throws(
    () =>
      checkAdvisoryMap(
        REAL,
        { type: "advisory.assign", advisory: "CVE-2099-0001", threats: ["peer-dos"] },
        threats,
      ),
    /does not say what the owner asked/,
  );
});

test("a signed advisory map command is queued as a job under the tick lock; a forged one is not", () => {
  for (const t of [
    "advisory.assign",
    "advisory.unassign",
    "advisory.expect",
    "advisory.unexpect",
  ] as const) {
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
  const cmd: AdvisoryCommand = {
    type: "advisory.assign",
    advisory: "CVE-2099-0001",
    threats: ["peer-dos"],
  };
  const signed = signCommand(KEY, {
    id: "00000000-0000-4000-8000-000000000001",
    at: "2026-11-23T11:59:30.000Z",
    by: "owner@example.com",
    cmd,
  });
  const forged = {
    ...signed,
    id: "00000000-0000-4000-8000-000000000002",
    cmd: { ...cmd, threats: ["eclipse-attack"] },
  };
  assert.deepEqual(dispatch(forged, deps), []);
  assert.deepEqual(control.jobs(), []);
  const [r] = dispatch(signed, deps);
  assert.equal(r?.phase, "received");
  assert.deepEqual(
    control.jobs().map((j) => [j.type, j.by]),
    [["advisory.assign", "owner"]],
  );
  assert.deepEqual(control.readJobCommand(signed.id), cmd);
});
