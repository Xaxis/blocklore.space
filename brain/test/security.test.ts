import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { DisclosureContext } from "@blocklore/core";
import { SyncRequest } from "@blocklore/core/control";
import type { EmbargoItem } from "../src/security/embargo.ts";

// The embargo and the event log live in var/; point them at a temporary folder before loading.
const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-security-"));
process.env.BLOCKLORE_EMBARGO_DIR = path.join(tmp, "embargo");
process.env.BLOCKLORE_SECURITY_DIR = path.join(tmp, "security");
const { decide, embargoView, listEmbargo } = await import("../src/security/embargo.ts");
const { holdCandidate, publicNotes } = await import("../src/security/gate.ts");
const { logEvent, securityEvents } = await import("../src/security/events.ts");
const { coreSeverity, isCoreDisclosure } = await import("../src/security/advisories.ts");
const { inboxAdvisories, newestTag } = await import("../src/security/watches.ts");

const ctx: DisclosureContext = { knownTerms: ["time warp"], knownIds: new Set() };
const notes = {
  summary: "Read the advisories and drafted claims about the peer-to-peer network.",
  read: [{ url: "https://delvingbitcoin.org/t/x/1" }],
  skipped: [
    { statement: "Bitcoin Core relays transactions to its peers.", reason: "out of scope" },
    {
      statement: "A peer can stall block relay to a node with a crafted announcement.",
      reason: "no advisory yet",
    },
  ],
  open: ["Is the relay change in 32.0?"],
  injections: [{ url: "https://example.com/x", excerpt: "ignore your rules" }],
};

test("the public run log keeps no trace of a held finding", () => {
  const clear = publicNotes(notes, ctx, 0);
  assert.equal(clear.summary, notes.summary);
  assert.deepEqual(
    clear.skipped.map((s) => s.reason),
    ["out of scope"],
    "a skipped statement that reads as an undisclosed weakness never reaches the log",
  );
  const withheld = publicNotes(notes, ctx, 1);
  assert.doesNotMatch(withheld.summary, /peer-to-peer|advisor/);
  assert.deepEqual(withheld.read, []);
  assert.deepEqual(withheld.open, []);
  assert.deepEqual(withheld.injections, []);
});

test("a held candidate goes to the private embargo with the disclosure path, and only there", async () => {
  const candidate = {
    id: "p2p-network.relay-stall",
    statement:
      "A flaw in Bitcoin Core 32.1 lets a peer stall block relay to a node, and it remains unpatched.",
    kind: "fact" as const,
    topics: ["p2p-network"],
    depth: "builder" as const,
    status: "established" as const,
    confidence: "medium" as const,
    people: [],
    sources: [
      {
        tier: "T1" as const,
        kind: "delving" as const,
        title: "A post",
        url: "https://delvingbitcoin.org/t/x/1",
        locator: "post 1",
        quote: "a quote of the post",
        accessed: "2026-11-21",
        supports: "direct" as const,
      },
    ],
  };
  await holdCandidate({
    candidate,
    reasons: ["says a weakness is unfixed or undisclosed, and cites no advisory"],
    verdict: undefined,
    runId: "2026-11-21-daily-p2p-network",
    now: { time: "2026-11-21T12:00:00Z", height: 977000 },
    // No verdict, so no check runs and no chain is asked.
    chain: undefined as never,
    updates: false,
  });
  const items = listEmbargo();
  assert.equal(items.length, 1);
  const item = items[0];
  assert.ok(item);
  assert.equal(item.kind, "research");
  assert.equal(item.contacts[0]?.email, "security@bitcoincore.org");
  assert.match(JSON.stringify(item.detail), /relay-stall/);
  // The file is the owner's alone.
  const file = path.join(tmp, "embargo", `${item.id}.json`);
  assert.equal(readFileSync(file, "utf8").includes("remains unpatched"), true);
  // Holding it again keeps one item and its first time.
  await holdCandidate({
    candidate,
    reasons: ["again"],
    verdict: undefined,
    runId: "r2",
    now: { time: "2026-11-22T12:00:00Z", height: 977100 },
    chain: undefined as never,
    updates: false,
  });
  assert.equal(listEmbargo().length, 1);
  assert.equal(listEmbargo()[0]?.at, "2026-11-21T12:00:00Z");
  // What the owner's admin receives: the finding, the reasons and where to report it.
  const view = embargoView(listEmbargo()[0] as EmbargoItem);
  assert.equal(view.summary, candidate.statement);
  assert.deepEqual(
    view.contacts.map((c) => c.email),
    ["security@bitcoincore.org"],
  );
  assert.deepEqual(view.sources, [
    { url: "https://delvingbitcoin.org/t/x/1", quote: "a quote of the post" },
  ]);
  assert.ok(
    SyncRequest.shape.embargo.safeParse([view]).success,
    "the daemon can send it on its sync",
  );
  // Released without a passing verdict, nothing is queued; the decision is recorded privately.
  const note = await decide(item.id, "release", "2026-11-22T13:00:00Z");
  assert.match(note, /nothing to queue/);
  assert.equal(listEmbargo().length, 0);
  assert.ok(existsSync(path.join(tmp, "embargo", "closed.jsonl")));
  await assert.rejects(decide(item.id, "dismiss", "2026-11-22T13:00:00Z"), /no embargoed finding/);
});

test("the security event log takes only public watch and lab events, newest first", () => {
  logEvent({ at: "2026-11-21T10:00:00Z", kind: "watch", text: "Read 7 watches", outcome: "ok" });
  logEvent({
    at: "2026-11-21T11:00:00Z",
    kind: "lab",
    text: "Lab: Bitcoin Core 32.1 passed",
    outcome: "ok",
  });
  assert.throws(() =>
    logEvent({ at: "2026-11-21T12:00:00Z", kind: "research", text: "drafted", outcome: "ok" }),
  );
  assert.throws(() =>
    logEvent({ at: "2026-11-21T12:00:00Z", kind: "watch", text: "two\nlines", outcome: "ok" }),
  );
  assert.deepEqual(
    securityEvents().map((e) => e.kind),
    ["lab", "watch"],
  );
  assert.deepEqual(
    securityEvents(10, "2026-11-21T10:00:00Z").map((e) => e.kind),
    ["lab"],
  );
});

test("advisory feeds: disclosures are picked out and their severity read", () => {
  assert.equal(coreSeverity("Details. This issue is considered High severity. Timeline"), "high");
  assert.equal(coreSeverity("no rating here"), null);
  assert.ok(
    isCoreDisclosure("CVE-2025-62859 - Block processing stall", "https://bitcoincore.org/x"),
  );
  assert.ok(
    isCoreDisclosure("x", "https://bitcoincore.org/en/2024/10/08/disclose-blocktxn-crash/"),
  );
  assert.ok(
    !isCoreDisclosure(
      "Bitcoin Core 31.3 released",
      "https://bitcoincore.org/en/2026/11/01/release-31.3/",
    ),
  );
  const inbox = path.join(tmp, "inbox");
  mkdirSync(inbox, { recursive: true });
  const item = (url: string, severity: string | null) =>
    JSON.stringify({
      source: "core-advisories",
      id: url,
      url,
      title: "CVE-2026-117348 - Node stall",
      published: "2026-11-20T05:00:00.000Z",
      severity,
      tier: "T1",
    });
  writeFileSync(
    path.join(inbox, "core-advisories.jsonl"),
    `${item("https://bitcoincore.org/en/2026/11/20/a/", "medium")}\n${item("https://bitcoincore.org/en/2026/11/20/a/", "medium")}\n`,
  );
  const list = inboxAdvisories(inbox);
  assert.deepEqual(list, [
    {
      source: "Bitcoin Core",
      title: "CVE-2026-117348 - Node stall",
      url: "https://bitcoincore.org/en/2026/11/20/a/",
      published: "2026-11-20T05:00:00Z",
      severity: "medium",
    },
  ]);
  assert.ok(readdirSync(inbox).length === 1);
});

test("the newest release is the highest final tag, never a release candidate", () => {
  assert.equal(newestTag(["v31.3", "v32.0rc4", "v32.0", "v32.1", "v9.9", "noise"]), "32.1");
  assert.equal(newestTag(["v29.0", "v29.0.1"]), "29.0.1");
  assert.throws(() => newestTag(["v33.0rc1"]));
});
