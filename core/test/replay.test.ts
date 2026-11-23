import assert from "node:assert/strict";
import { test } from "node:test";
import { type BundleClaim, bundleClaimAsOf, compile, type Store } from "../src/bundle.ts";
import { claimHash } from "../src/hash.ts";
import {
  asOfPath,
  claimAsOf,
  heightDay,
  isAfter,
  momentText,
  parseAsOf,
  topicAsOf,
} from "../src/replay.ts";
import type { Claim, Topic } from "../src/schema.ts";
import { validateClaim } from "../src/validate.ts";
import { claim } from "./fixtures.ts";

// The time machine (BACKLOG 25): a topic or a claim exactly as Blocklore stated it at a block
// height or a UTC date. The store has no revised or withdrawn claim yet, so these cases are built.

const t1 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const t2 = { time: "2026-11-21T09:00:00Z", height: 976850 };
const t3 = { time: "2026-11-22T15:30:00Z", height: 977050 };
const latest = { time: "2026-11-23T11:32:53Z", height: 977197 };
/** Between the first revisions and the later ones. */
const middle = { height: 976900 };

const made = (id: string, at = t1, over: Partial<Claim> = {}): Claim =>
  claim({
    id,
    topics: ["halvings"],
    first_seen: at,
    last_verified: { ...at, run: "2026-11-20-seed", method: "quotes 1/1, chain 1/1" },
    revisions: [{ rev: 1, at, run: "2026-11-20-seed", change: "created" }],
    ...over,
  });

const OLD =
  "The block subsidy fell to 3.125 BTC at block 840,000, the fourth halving, mined in April 2024.";

/** Created at t1, refined at t3: before t3 it said OLD. */
const revised = made("halvings.revised", t1, {
  last_verified: { ...t3, run: "2026-11-22-daily", method: "quotes 1/1" },
  run: "2026-11-22-daily",
  revisions: [
    { rev: 1, at: t1, run: "2026-11-20-seed", change: "created" },
    {
      rev: 2,
      at: t3,
      run: "2026-11-22-daily",
      change: "refined",
      note: "Named the day the fourth halving's block was mined.",
      before: { statement: OLD },
    },
  ],
});

const withdrawnAt = (id: string, at: typeof t1) =>
  made(id, t1, {
    status: "withdrawn",
    last_verified: { ...at, run: "2026-11-22-revoke", method: "withdrawn" },
    run: "2026-11-22-revoke",
    revisions: [
      { rev: 1, at: t1, run: "2026-11-20-seed", change: "created" },
      {
        rev: 2,
        at,
        run: "2026-11-22-revoke",
        change: "withdrawn",
        note: "Withdrawn by the owner: the source did not say this.",
        before: { status: "established" },
      },
    ],
  });

const kept = made("halvings.kept");
const late = made("halvings.late", t3);
/** Withdrawn after the moment: it shows as it was. */
const goneLater = withdrawnAt("halvings.gone-later", t3);
/** Withdrawn before the moment: it is absent. */
const goneEarly = withdrawnAt("halvings.gone-early", t2);

const topic: Topic = {
  slug: "halvings",
  title: "Halvings",
  lede: "halvings.late",
  contested: false,
  safety: false,
  group: "foundations",
  sections: [
    {
      id: "basics",
      title: "Basics",
      depth: "curious",
      claims: ["halvings.late", "halvings.kept", "halvings.gone-early"],
    },
    {
      id: "history",
      title: "History",
      depth: "user",
      claims: ["halvings.revised", "halvings.gone-later", "halvings.kept"],
    },
    { id: "later", title: "Later", depth: "builder", claims: ["halvings.late"] },
  ],
};
const all = [kept, revised, late, goneLater, goneEarly];
const find = (id: string) => all.find((c) => c.id === id);

test("the fixtures are valid claims", () => {
  for (const c of all)
    assert.deepEqual(
      validateClaim(c).filter((i) => i.level === "error"),
      [],
      c.id,
    );
});

test("a moment parses from a height or a UTC date, and nothing past the store's newest stamp", () => {
  assert.deepEqual(parseAsOf("976771", latest), { asOf: { height: 976771 } });
  assert.deepEqual(parseAsOf(" 0 ", latest), { asOf: { height: 0 } });
  assert.deepEqual(parseAsOf(String(latest.height), latest), {
    asOf: { height: latest.height },
  });
  assert.deepEqual(parseAsOf("2026-11-21", latest), {
    asOf: { date: "2026-11-21", time: "2026-11-21T23:59:59.999Z" },
  });
  // The store's own newest day is not the future: its end shows everything compiled.
  assert.ok("asOf" in parseAsOf("2026-11-23", latest));

  const refused = (text: string) => {
    const r = parseAsOf(text, latest);
    assert.ok("error" in r, `${text} should be refused`);
    assert.match(r.error, /A moment is a block height in digits, up to 977197, or a UTC date/);
    return r.error;
  };
  assert.match(refused("977198"), /Block 977198 is past block 977197/);
  assert.match(refused("2026-11-24"), /2026-11-24 is after 2026-11-23/);
  assert.match(refused("2026-02-30"), /not a date on the calendar/);
  for (const bad of ["", "yesterday", "-5", "97.6", "1e6", "12345678901", "2026-1-2", "tip"])
    refused(bad);
  // Text that is neither a height nor a date is never repeated: it could be anything a reader pasted.
  const pasted =
    "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
  assert.ok(!refused(pasted).includes(pasted.slice(0, 12)));

  assert.equal(asOfPath({ height: 976771 }), "976771");
  assert.equal(asOfPath({ date: "2026-11-21", time: "2026-11-21T23:59:59.999Z" }), "2026-11-21");
  assert.equal(momentText(" block 976,771 "), "976771");
  assert.equal(momentText("976 771"), "976771");
  assert.equal(momentText("2026-11-21"), "2026-11-21");
});

test("a date means the end of that UTC day, to the millisecond", () => {
  const day = { time: "2026-11-21T23:59:59.999Z" };
  assert.equal(isAfter({ time: "2026-11-21T23:59:59Z", height: 1 }, day), false);
  assert.equal(isAfter({ time: "2026-11-21T23:59:59.5Z", height: 1 }, day), false);
  assert.equal(isAfter({ time: "2026-11-22T00:00:00Z", height: 1 }, day), true);
  // A stamp at the moment's own height is in it.
  assert.equal(isAfter(t2, { height: t2.height }), false);
  assert.equal(isAfter(t2, { height: t2.height - 1 }), true);
});

test("a claim revised later shows the revision in force at the moment", () => {
  assert.equal(claimAsOf(revised, { height: t1.height - 1 }), null);
  const then = claimAsOf(revised, middle);
  assert.equal(then?.statement, OLD);
  assert.equal(then?.revisions.length, 1);
  assert.equal(then?.run, "2026-11-20-seed");
  assert.equal(
    claimAsOf(revised, { time: "2026-11-22T23:59:59.999Z" })?.statement,
    revised.statement,
  );
  // Nothing after the moment: the claim comes back as it is, the same object.
  assert.equal(claimAsOf(revised, { height: t3.height }), revised);
});

test("a topic at a moment: later claims absent, revisions undone, withdrawals in their place", () => {
  const then = topicAsOf(topic, find, middle);
  assert.deepEqual(
    then.claims.map((c) => c.id),
    ["halvings.kept", "halvings.revised", "halvings.gone-later"],
  );
  assert.equal(then.claims.find((c) => c.id === "halvings.revised")?.statement, OLD);
  assert.equal(then.claims.find((c) => c.id === "halvings.gone-later")?.status, "established");
  // The lede did not exist yet, so the first claim then opens the topic, as compile does today.
  assert.equal(then.lede?.id, "halvings.kept");
  // A section with nothing in it then is left out.
  assert.deepEqual(
    then.sections.map((s) => [s.id, s.claims.map((c) => c.id)]),
    [
      ["basics", ["halvings.kept"]],
      ["history", ["halvings.revised", "halvings.gone-later", "halvings.kept"]],
    ],
  );
  assert.deepEqual(then.since, {
    added: ["halvings.late"],
    revised: ["halvings.revised"],
    withdrawn: ["halvings.gone-later"],
  });

  // By date: the end of 21 November is after t2 (gone-early withdrawn) and before t3.
  const byDate = topicAsOf(topic, find, { time: "2026-11-21T23:59:59.999Z" });
  assert.deepEqual(
    byDate.claims.map((c) => c.id),
    then.claims.map((c) => c.id),
  );
  // On 20 November gone-early was still published.
  assert.ok(
    topicAsOf(topic, find, { time: "2026-11-20T23:59:59.999Z" }).claims.some(
      (c) => c.id === "halvings.gone-early",
    ),
  );

  const before = topicAsOf(topic, find, { height: t1.height - 1 });
  assert.equal(before.lede, null);
  assert.deepEqual(before.sections, []);
  assert.deepEqual(before.claims, []);
  assert.deepEqual(before.since.added, ["halvings.late", "halvings.kept", "halvings.revised"]);

  const now = topicAsOf(topic, find, latest);
  assert.equal(now.lede?.id, "halvings.late");
  assert.deepEqual(
    now.claims.map((c) => c.id),
    ["halvings.late", "halvings.kept", "halvings.revised"],
  );
  assert.deepEqual(now.since, { added: [], revised: [], withdrawn: [] });
});

test("a compiled claim at a moment carries its hash then, and only what had happened by then", () => {
  const store: Store = {
    wire: null,
    bips: null,
    claims: all,
    topics: [topic],
    proposals: [],
    debates: [],
    runs: [],
    snapshots: [],
    review: [],
    rechecks: {
      "halvings.kept": { at: t3, problems: ["The quote was not found at the source."] },
    },
  };
  const { bundle, issues } = compile(store, latest);
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
  );
  // Compiled topics leave withdrawn claims out; the written ones keep them, for the time machine.
  assert.ok(!bundle.topics[0]?.sections.some((s) => s.claims.includes("halvings.gone-later")));
  assert.ok(
    bundle.writtenTopics[0]?.sections.some((s) => s.claims.includes("halvings.gone-later")),
  );

  const b = bundle.claims["halvings.revised"] as BundleClaim;
  assert.equal(b.hashes.length, 2);
  assert.equal(b.hashes[1], b.hash);
  // The created state, written out by hand: the hash a snapshot taken then would list.
  assert.equal(
    b.hashes[0],
    claimHash({
      ...revised,
      statement: OLD,
      revisions: revised.revisions.slice(0, 1),
      run: "2026-11-20-seed",
    }),
  );

  const then = bundleClaimAsOf(b, middle);
  assert.equal(then?.statement, OLD);
  assert.equal(then?.hash, b.hashes[0]);
  assert.notEqual(then?.hash, b.hash);
  // Its newest check came after the moment; then, the last check was the revision's publication.
  assert.deepEqual(then?.last_verified, {
    ...t1,
    run: "2026-11-20-seed",
    method: "checked when this revision was published",
  });
  assert.equal(bundleClaimAsOf(b, { height: t3.height })?.hash, b.hash);

  const k = bundle.claims["halvings.kept"] as BundleClaim;
  assert.ok(k.recheck);
  assert.equal(bundleClaimAsOf(k, middle)?.recheck, null);
  assert.deepEqual(bundleClaimAsOf(k, { height: t3.height })?.recheck, k.recheck);

  const g = bundle.withdrawn["halvings.gone-later"] as BundleClaim;
  assert.ok(g.withdrawal);
  assert.equal(bundleClaimAsOf(g, middle)?.withdrawal, null);
  assert.equal(bundleClaimAsOf(g, middle)?.status, "established");
  assert.equal(bundleClaimAsOf(g, latest)?.status, "withdrawn");

  // The same topic through compiled claims, current or withdrawn.
  const lookup = (id: string) => bundle.claims[id] ?? bundle.withdrawn[id];
  const view = topicAsOf(bundle.writtenTopics[0] as Topic, lookup, middle, bundleClaimAsOf);
  assert.deepEqual(
    view.claims.map((c) => [c.id, c.hash === lookup(c.id)?.hashes[0]]),
    [
      ["halvings.kept", true],
      ["halvings.revised", true],
      ["halvings.gone-later", true],
    ],
  );
});

test("the day a block came, from the store's own stamps", () => {
  const stamps = [t1, t2, t3, { time: "2026-11-21T20:00:00Z", height: 976950 }];
  // The tip was 976850 at t2, and below it at t1: the block came between the two days.
  assert.deepEqual(heightDay(976850, stamps), { between: ["2026-11-20", "2026-11-21"] });
  assert.deepEqual(heightDay(976900, stamps), { on: "2026-11-21" });
  assert.deepEqual(heightDay(977000, stamps), { between: ["2026-11-21", "2026-11-22"] });
  assert.deepEqual(heightDay(900000, stamps), { before: "2026-11-20" });
  assert.equal(heightDay(977051, stamps), null);
});
