import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOwnerAction,
  applyReportUpdate,
  cleanNote,
  intakeReport,
  publicReport,
  REPORT_SITE_DAY,
  REPORT_STATUSES,
  REPORT_VISITOR_DAY,
  type ReportItem,
  type ReportStore,
  ReportUpdate,
  readReport,
  reportId,
  reportOrder,
  reportOutcomeText,
  reportUpdateProblem,
} from "../src/report.ts";
import { hasDash } from "../src/style.ts";

const SEED = "abandon ability able about above absent absorb abstract absurd abuse access accident";
const HASH = "a".repeat(64);
const CLAIM = { id: "halvings.subsidy-840000", hash: HASH };
const NOW = new Date("2026-11-23T10:00:00Z");

/** The site's store in memory, with every write recorded, so a test can prove nothing was kept. */
function memory(): ReportStore & {
  items: Map<string, ReportItem>;
  fresh: Set<string>;
  counts: Map<string, number>;
  writes: number;
} {
  const items = new Map<string, ReportItem>();
  const fresh = new Set<string>();
  const counts = new Map<string, number>();
  const s = {
    items,
    fresh,
    counts,
    writes: 0,
    get: async (id: string) => items.get(id) ?? null,
    async put(item: ReportItem, isFresh: boolean) {
      s.writes++;
      items.set(item.id, item);
      if (isFresh) fresh.add(item.id);
    },
    async count(who: string, day: string) {
      const k = `${who}:${day}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k) ?? 0;
    },
  };
  return s;
}

const file = (store: ReportStore, body: unknown, visitor = "v1", now = NOW, claim = CLAIM) =>
  intakeReport({ claim, body, visitor, now }, store);

test("a report that holds a seed phrase is refused without echo, kept nowhere and counted nowhere", async () => {
  const store = memory();
  const r = await file(store, { kind: "wrong", note: `my words are ${SEED}` });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.status === 400);
  assert.ok(!r.ok && /seed phrase/.test(r.error));
  assert.ok(!r.ok && !r.error.includes("abandon"));
  assert.equal(store.writes, 0);
  assert.equal(store.counts.size, 0);

  // Before the shape is read: a secret in a field the API does not take is still a secret.
  const hidden = readReport({ kind: "wrong", extra: SEED });
  assert.ok("secret" in hidden && hidden.secret);
  for (const note of [
    "send it to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq please",
    "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8 is mine",
    "write to me at reader@example.org",
  ])
    assert.ok("secret" in readReport({ kind: "unclear", note }), note.slice(0, 20));
});

test("the body is a kind and an optional note, nothing else", () => {
  assert.deepEqual(readReport({ kind: "outdated" }), { kind: "outdated", note: null });
  for (const bad of [
    { kind: "spam" },
    { kind: "wrong", note: "x", email: "no" },
    { note: "no kind" },
    { kind: "wrong", note: "x".repeat(501) },
    "wrong",
    null,
  ]) {
    const r = readReport(bad);
    assert.ok("error" in r && r.status === 400 && /^Send JSON/.test(r.error), JSON.stringify(bad));
  }
});

test("links, handles, Nostr keys and hidden characters are stripped from a note", () => {
  const zw = String.fromCharCode(0x200b);
  const rlo = String.fromCharCode(0x202e);
  assert.equal(
    cleanNote(
      `See https://example.com/x and bitcoin${zw}ops.org for${rlo} it,\nasks @someone and npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m`,
    ),
    "See and for it, asks and",
  );
  assert.deepEqual(readReport({ kind: "unclear", note: "  https://example.com  " }), {
    kind: "unclear",
    note: null,
  });
});

test("a repeat of the same kind on the same claim counts instead of adding; notes collect", async () => {
  const store = memory();
  const a = await file(store, { kind: "wrong", note: "The height is off by one." }, "v1");
  const b = await file(store, { kind: "wrong", note: "The height is off by one." }, "v2");
  const c = await file(store, { kind: "wrong", note: "Release notes say otherwise." }, "v3");
  assert.ok(a.ok && a.added && b.ok && !b.added && c.ok && !c.added);
  assert.equal(store.items.size, 1);
  const item = [...store.items.values()][0];
  assert.equal(item?.count, 3);
  assert.equal(item?.id, reportId(CLAIM.id, "wrong", HASH));
  assert.deepEqual(
    item?.notes.map((n) => n.text),
    ["The height is off by one.", "Release notes say otherwise."],
  );
  // Another kind, or a new version of the claim, is its own report.
  await file(store, { kind: "unclear" }, "v4");
  await file(store, { kind: "wrong" }, "v5", NOW, { id: CLAIM.id, hash: "b".repeat(64) });
  assert.equal(store.items.size, 3);
  // A repeat goes back to the brain's next pull, since it may bring a note.
  store.fresh.clear();
  await file(store, { kind: "wrong" }, "v6");
  assert.deepEqual([...store.fresh], [reportId(CLAIM.id, "wrong", HASH)]);
});

test("each visitor files at most 5 a day and the site 200; the counters roll over at 00:00 UTC", async () => {
  const store = memory();
  for (let n = 1; n <= REPORT_VISITOR_DAY; n++)
    assert.ok((await file(store, { kind: "unclear" }, "busy")).ok, `report ${n}`);
  const sixth = await file(store, { kind: "unclear" }, "busy");
  assert.ok(!sixth.ok && sixth.status === 429 && /5 problems a day/.test(sixth.error));
  assert.ok((await file(store, { kind: "unclear" }, "someone-else")).ok);
  assert.ok((await file(store, { kind: "unclear" }, "busy", new Date("2026-11-24T00:00:01Z"))).ok);

  const site = memory();
  for (let n = 1; n <= REPORT_SITE_DAY; n++)
    assert.ok((await file(site, { kind: "outdated" }, `visitor-${n}`)).ok, `report ${n}`);
  const over = await file(site, { kind: "outdated" }, "visitor-new");
  assert.ok(!over.ok && over.status === 429 && /all the reports it can today/.test(over.error));

  // A refusal for its content counts toward neither cap.
  const quiet = memory();
  await file(quiet, { kind: "nope" }, "v");
  await file(quiet, { kind: "wrong" }, "v", NOW, null as unknown as typeof CLAIM);
  assert.equal(quiet.counts.size, 0);
});

test("an unknown claim is 404 and nothing is kept", async () => {
  const store = memory();
  const r = await intakeReport(
    { claim: null, body: { kind: "wrong" }, visitor: "v", now: NOW },
    store,
  );
  assert.ok(!r.ok && r.status === 404);
  assert.equal(store.writes, 0);
});

test("a reader's note is never part of what the public sees", async () => {
  const store = memory();
  const note = "PRIVATE-NOTE-MARKER the subsidy changed";
  const r = await file(store, { kind: "outdated", note });
  assert.ok(r.ok);
  assert.ok(!JSON.stringify(r.item).includes("PRIVATE-NOTE-MARKER"));
  const item = [...store.items.values()][0] as ReportItem;
  assert.equal(item.notes[0]?.text, note);
  const updated = applyReportUpdate(
    item,
    {
      id: item.id,
      status: "researching",
      outcome: {
        at: { time: "2026-11-23T11:00:00Z", height: 977100 },
        run: "2026-11-23-reverify",
        checked: "quotes 2/2, chain 1/1",
        problems: [],
        changed: null,
      },
    },
    "2026-11-23T11:00:00Z",
  );
  const pub = publicReport(updated);
  assert.deepEqual(Object.keys(pub).sort(), [
    "at",
    "claim",
    "count",
    "hash",
    "id",
    "kind",
    "last",
    "outcome",
    "status",
    "updated",
  ]);
  assert.ok(!JSON.stringify(pub).includes("PRIVATE-NOTE-MARKER"));
  assert.ok(!("notes" in pub));
});

test("the brain's updates are checked: the owner's dismissal wins, the words are public", () => {
  const base: ReportItem = {
    id: "0123456789abcdef",
    claim: CLAIM.id,
    kind: "wrong",
    hash: HASH,
    at: "2026-11-23T10:00:00.000Z",
    last: "2026-11-23T10:00:00.000Z",
    count: 1,
    status: "received",
    outcome: null,
    notes: [],
    updated: "2026-11-23T10:00:00.000Z",
  };
  const outcome = {
    at: { time: "2026-11-23T11:00:00Z", height: 977100 },
    run: "2026-11-23-reverify",
    checked: "quotes 1/1",
    problems: [],
    changed: null,
  };
  const u = (over: Partial<ReportUpdate> = {}): ReportUpdate => ({
    id: base.id,
    status: "holds",
    outcome,
    ...over,
  });
  assert.equal(reportUpdateProblem(base, u()), null);
  assert.match(reportUpdateProblem(null, u()) ?? "", /No report/);
  const dismissed = applyOwnerAction(base, { id: base.id, action: "dismiss" }, "t");
  assert.equal(dismissed.status, "dismissed");
  assert.match(reportUpdateProblem(dismissed, u()) ?? "", /dismissed/);
  assert.match(reportUpdateProblem(base, u({ status: "failed" })) ?? "", /says what failed/);
  assert.match(
    reportUpdateProblem(base, u({ outcome: { ...outcome, problems: ["source 1: HTTP 404"] } })) ??
      "",
    /Only a failed/,
  );
  const dash = String.fromCharCode(8212);
  assert.match(
    reportUpdateProblem(base, u({ outcome: { ...outcome, checked: `quotes 1/1 ${dash} ok` } })) ??
      "",
    /dash/,
  );
  assert.match(
    reportUpdateProblem(base, u({ outcome: { ...outcome, checked: SEED } })) ?? "",
    /secret/,
  );
  // A failed chain check may print a block or transaction hash: public data, not refused.
  assert.equal(
    reportUpdateProblem(
      base,
      u({
        status: "failed",
        outcome: { ...outcome, problems: [`check 1 (chain.block-hash): got ${"f".repeat(64)}`] },
      }),
    ),
    null,
  );
  assert.ok(!ReportUpdate.safeParse({ ...u(), status: "received" }).success);
  assert.ok(!ReportUpdate.safeParse({ ...u(), notes: [] }).success);
  const reopened = applyOwnerAction(
    applyReportUpdate(base, u(), "t1"),
    { id: base.id, action: "reopen" },
    "t2",
  );
  assert.equal(reopened.status, "received");
  assert.equal(reopened.outcome, null);
});

test("every outcome reads in the house style, and the newest report comes first", () => {
  const r = (status: ReportItem["status"], last: string, changed: boolean | null = null) =>
    publicReport({
      id: last.replace(/\D/g, "").padEnd(16, "0").slice(0, 16),
      claim: CLAIM.id,
      kind: "outdated",
      hash: HASH,
      at: last,
      last,
      count: 1,
      status,
      outcome:
        status === "received"
          ? null
          : {
              at: { time: last, height: 977100 },
              run: "2026-11-23-reverify",
              checked: "quotes 1/1",
              problems: status === "failed" ? ["source 1: quote not found"] : [],
              changed,
            },
      notes: [],
      updated: last,
    });
  for (const s of REPORT_STATUSES) {
    const text = reportOutcomeText(r(s, "2026-11-23T10:00:00Z", true));
    assert.ok(text.length > 10 && !hasDash(text) && !text.includes("!"), s);
  }
  assert.match(reportOutcomeText(r("holds", "2026-11-23T10:00:00Z")), /block 977,100/);
  assert.match(reportOutcomeText(r("researched", "2026-11-23T10:00:00Z", false)), /no newer/);
  const sorted = [
    r("holds", "2026-11-20T10:00:00Z"),
    r("failed", "2026-11-23T10:00:00Z"),
    r("received", "2026-11-21T10:00:00Z"),
  ].sort(reportOrder);
  assert.deepEqual(
    sorted.map((x) => x.status),
    ["failed", "received", "holds"],
  );
});
