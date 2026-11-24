import assert from "node:assert/strict";
import { test } from "node:test";
import { type Bundle, type BundleSnapshot, compile, type Store } from "../src/bundle.ts";
import { digestDays } from "../src/digest.ts";
import { embargoReasons } from "../src/disclosure.ts";
import {
  ARTICLE_MAX_BYTES,
  type ChannelInput,
  channelNotes,
  channelProblems,
  channelStart,
  digestArticle,
  NOSTR_DOMAIN,
  type NostrChannel,
  nip05Document,
  noteScreen,
  npub,
  watchChanges,
} from "../src/nostr.ts";
import { EMPTY_RECORDS, OC_DOMAIN } from "../src/orangecheck.ts";
import type { Claim, Topic } from "../src/schema.ts";
import type { LabRun, WatchState } from "../src/security.ts";
import { hasDash } from "../src/style.ts";
import { claim } from "./fixtures.ts";

const D = "2026-11-21";
const at = (hhmm: string, height: number, day = D) => ({ time: `${day}T${hhmm}:00Z`, height });
const src = (url: string, title = "A source with a title") => ({
  tier: "T1" as const,
  kind: "docs" as const,
  title,
  url,
  locator: "a locator",
  quote: "some quoted words",
  accessed: "2026-11-20",
  supports: "direct" as const,
});
type When = ReturnType<typeof at>;
/** A claim created at `when`, with later revisions; last verified at its latest one. */
const created = (
  id: string,
  topic: string,
  statement: string,
  when: When,
  urls: string[],
  later: Claim["revisions"] = [],
  over: Partial<Claim> = {},
): Claim => {
  const revisions: Claim["revisions"] = [
    { rev: 1, at: when, run: "2026-11-21-seed", change: "created" },
    ...later,
  ];
  const last = (revisions.at(-1) as Claim["revisions"][number]).at;
  return claim({
    id,
    topics: [topic],
    statement,
    sources: urls.map((u) => src(u)),
    first_seen: when,
    last_verified: { ...last, run: "2026-11-21-seed", method: "quotes 1/1" },
    run: "2026-11-21-seed",
    revisions,
    ...over,
  });
};

const fourth = created(
  "halvings.fourth",
  "halvings",
  "The fourth halving happened at block 840,000, mined on 20 April 2024 by ViaBTC.",
  at("09:00", 977000),
  ["https://example.org/halving", "https://example.org/halving-2"],
);
const tapr = created(
  "taproot.activated",
  "taproot",
  "Taproot activated at block 709,632 in November 2021, after Speedy Trial locked it in.",
  at("10:00", 977010),
  ["https://example.org/taproot"],
);
const corrected = created(
  "halvings.subsidy-840000",
  "halvings",
  "The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000, mined on 20 April 2024.",
  at("12:00", 976700, "2026-11-20"),
  ["https://example.org/subsidy"],
  [
    {
      rev: 2,
      at: at("11:00", 977020),
      run: "2026-11-21-recheck",
      change: "corrected",
      note: "The block was mined on 20 April, not 19 April.",
      before: {
        statement:
          "The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000, mined on 19 April 2024.",
      },
    },
  ],
);
const resourced = created(
  "taproot.old",
  "taproot",
  "BIP 341 defines the spending rules of Taproot for outputs with witness version 1.",
  at("12:00", 976700, "2026-11-20"),
  ["https://example.org/bip341-new"],
  [
    {
      rev: 2,
      at: at("13:00", 977030),
      run: "2026-11-21-recheck",
      change: "sources",
      note: "The old link moved.",
      before: { sources: [src("https://example.org/bip341-old")] },
    },
  ],
);
const withdrawn = created(
  "halvings.withdrawn-one",
  "halvings",
  "A claim the owner later withdrew, written only for a test of the digest article.",
  at("14:00", 977040),
  ["https://example.org/withdrawn"],
  [
    {
      rev: 2,
      at: at("08:00", 977100, "2026-11-22"),
      run: "2026-11-22-revoke",
      change: "withdrawn",
      note: "The owner withdrew it: a test.",
      before: { status: "established" },
    },
  ],
  { status: "withdrawn" },
);

const topic = (slug: string, title: string, claims: string[]): Topic => ({
  slug,
  title,
  lede: claims[0] as string,
  contested: false,
  safety: false,
  group: "foundations",
  sections: [{ id: "main", title: "The main section", depth: "user", claims }],
});

function store(claims: Claim[] = [fourth, tapr, corrected, resourced, withdrawn]): Store {
  return {
    wire: null,
    bips: null,
    claims,
    topics: [
      { slug: "halvings", title: "Halvings and supply" },
      { slug: "taproot", title: "Taproot" },
    ].flatMap(({ slug, title }) => {
      const ids = claims
        .filter((c) => c.topics[0] === slug && c.status !== "withdrawn")
        .map((c) => c.id);
      return ids.length ? [topic(slug, title, ids)] : [];
    }),
    proposals: [],
    debates: [],
    runs: [],
    snapshots: [],
    orangecheck: EMPTY_RECORDS,
    review: [],
  };
}

const built = (s = store()) => {
  const { bundle, issues } = compile(s, at("23:00", 977200, "2026-11-22"));
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
  );
  return bundle;
};

const none = { knownTerms: [], knownIds: new Set<string>() };
const screen = (embargoed: string[] = [], released: string[] = []) =>
  noteScreen({ disclosure: none, embargoed, released: (c) => released.includes(c.id) });

const dayOf = (b: Bundle, date: string) => {
  const d = digestDays(
    b.events,
    b.runs,
    [],
    b.topics.map((t) => t.slug),
  ).find((x) => x.date === date);
  assert.ok(d, `a digest for ${date}`);
  return d;
};

test("npub is NIP-19 bech32: the spec's own vector", () => {
  assert.equal(
    npub("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"),
    "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
  );
  assert.throws(() => npub("not hex"));
  assert.equal(NOSTR_DOMAIN, OC_DOMAIN, "NIP-05 and OrangeCheck name the same domain");
});

test("NIP-05 names the channel key for _ and blocklore, the records key for records, with relays", () => {
  assert.deepEqual(nip05Document(null), { names: {} });
  const c: NostrChannel = {
    pubkey: "a".repeat(64),
    records: "b".repeat(64),
    relays: ["wss://nos.lol", "wss://relay.primal.net"],
    posting: true,
    changed: "2026-11-21T00:00:00Z",
  };
  assert.deepEqual(nip05Document(c), {
    names: { _: "a".repeat(64), blocklore: "a".repeat(64), records: "b".repeat(64) },
    relays: {
      ["a".repeat(64)]: ["wss://nos.lol", "wss://relay.primal.net"],
      ["b".repeat(64)]: ["wss://nos.lol", "wss://relay.primal.net"],
    },
  });
  assert.deepEqual(channelProblems(c), []);
  assert.deepEqual(
    channelProblems({ ...c, relays: ["ws://relay.example", "ws://127.0.0.1:7447"] }).map(
      (p) => p.level,
    ),
    ["error", "warning"],
  );
  assert.equal(channelProblems({ ...c, records: c.pubkey })[0]?.level, "error");
});

test("the digest article says exactly what /digest/<date> says: corrections, new claims by topic, other revisions", () => {
  const b = built();
  const a = digestArticle(dayOf(b, D), b, screen());
  assert.deepEqual(a.held, []);
  assert.ok(a.note);
  assert.equal(a.note.id, `digest:${D}`);
  assert.equal(a.note.kind, 30023);
  assert.deepEqual(a.note.tags, [
    ["d", D],
    ["title", "Blocklore digest, 21 November 2026"],
    [
      "summary",
      "3 new claims, 1 correction and 1 other revision. Every line links to its evidence.",
    ],
    ["published_at", String(Date.parse("2026-11-22T00:00:00Z") / 1000)],
    ["t", "bitcoin"],
    ["r", `https://blocklore.space/digest/${D}`],
    [
      "alt",
      `Long-form article: Blocklore digest, 21 November 2026, https://blocklore.space/digest/${D}`,
    ],
  ]);
  assert.equal(
    a.note.content,
    [
      "3 new claims, 1 correction and 1 other revision. Every line links to its evidence.",
      "",
      `Blocks 977,000 to 977,040. The digest on the site: https://blocklore.space/digest/${D}`,
      "",
      "## Corrections",
      "",
      "These replace something Blocklore said before.",
      "",
      "- The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000, mined on 20 April 2024.",
      "  - Before: The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000, mined on 19 April 2024.",
      "  - Note: The block was mined on 20 April, not 19 April.",
      "  - Claim: https://blocklore.space/claims/halvings.subsidy-840000",
      "  - Source: https://example.org/subsidy",
      "",
      "## Halvings and supply",
      "",
      "2 new claims on the topic page: https://blocklore.space/topics/halvings",
      "",
      "- The fourth halving happened at block 840,000, mined on 20 April 2024 by ViaBTC.",
      "  - Claim: https://blocklore.space/claims/halvings.fourth",
      "  - Source: https://example.org/halving",
      "  - Source: https://example.org/halving-2",
      "- A claim the owner later withdrew, written only for a test of the digest article.",
      "  - Claim: https://blocklore.space/claims/halvings.withdrawn-one",
      "  - Source: https://example.org/withdrawn",
      "  - Since withdrawn by the owner",
      "",
      "## Taproot",
      "",
      "1 new claim on the topic page: https://blocklore.space/topics/taproot",
      "",
      "- Taproot activated at block 709,632 in November 2021, after Speedy Trial locked it in.",
      "  - Claim: https://blocklore.space/claims/taproot.activated",
      "  - Source: https://example.org/taproot",
      "",
      "## Other revisions",
      "",
      "What changed in claims published before.",
      "",
      "- BIP 341 defines the spending rules of Taproot for outputs with witness version 1.",
      "  - Note: The old link moved.",
      "  - Claim: https://blocklore.space/claims/taproot.old",
      "  - Source: https://example.org/bip341-new",
    ].join("\n"),
  );
  assert.equal(hasDash(a.note.content), false);
});

test("a claim the disclosure gate would hold now is left out of the article; an owner's release passes", () => {
  const finding = created(
    "taproot.finding",
    "taproot",
    "A remote crash in Taproot validation remains unpatched in every release of the software.",
    at("15:00", 977050),
    ["https://example.org/finding"],
  );
  const b = built(store([fourth, tapr, corrected, resourced, withdrawn, finding]));
  assert.ok(embargoReasons(finding, none).length > 0, "the gate reads it as a finding");
  const held = digestArticle(dayOf(b, D), b, screen());
  assert.deepEqual(
    held.held.map((h) => h.id),
    [`digest:${D}:taproot.finding`],
  );
  assert.ok(!held.note?.content.includes("taproot.finding"));
  assert.ok(!held.note?.content.includes("unpatched"));
  assert.ok(held.note?.content.startsWith("3 new claims"), "the counts leave it out too");

  const released = digestArticle(dayOf(b, D), b, screen([], ["taproot.finding"]));
  assert.deepEqual(released.held, []);
  assert.ok(released.note?.content.includes("taproot.finding"));

  // Anything the embargo holds now is never named, whatever the gate says of its words.
  const plain = built();
  const named = digestArticle(dayOf(plain, D), plain, screen(["halvings.fourth"]));
  assert.deepEqual(
    named.held.map((h) => [h.id, h.reasons]),
    [[`digest:${D}:halvings.fourth`, ["names something the embargo holds"]]],
  );
  assert.ok(!named.note?.content.includes("The fourth halving"));
});

test("a long day lists whole claims within the byte budget and links the rest", () => {
  const many = Array.from({ length: 400 }, (_, i) =>
    created(
      `halvings.many-${String(i).padStart(3, "0")}`,
      "halvings",
      `Claim number ${i} of a seed day, long enough to count, at block 840,000 and some more words here.`,
      at("09:00", 977000),
      [`https://example.org/many/${i}`],
    ),
  );
  const b = built(store(many));
  const a = digestArticle(dayOf(b, D), b, screen());
  assert.ok(a.note);
  assert.ok(new TextEncoder().encode(a.note.content).length <= ARTICLE_MAX_BYTES);
  const listed = a.note.content.split("\n").filter((l) => l.startsWith("- ")).length;
  assert.ok(listed > 50 && listed < 400);
  assert.ok(
    a.note.content.endsWith(
      `The rest of this day, ${400 - listed} more claims, is on the site: https://blocklore.space/digest/${D}`,
    ),
  );
});

const snap = (n: number, time: string, blocks: number[]): BundleSnapshot => ({
  n,
  at: { time, height: 977000 + n },
  commit: "0".repeat(40),
  count: 230,
  root: "ab".repeat(32),
  previous: null,
  file: `${n}.json`,
  proof: blocks.length
    ? {
        file: `${n}.json.ots`,
        digest: "cd".repeat(32),
        blocks: blocks.map((h) => ({ height: h, merkleRoot: "ef".repeat(32) })),
        pending: [],
      }
    : {
        file: `${n}.json.ots`,
        digest: "cd".repeat(32),
        blocks: [],
        pending: ["https://alice.btc.calendar.opentimestamps.org"],
      },
  signature: null,
});

const point = (time: string, status: WatchState["status"], value: number | null) => ({
  at: time,
  status,
  value,
});
const hashrate = (history: ReturnType<typeof point>[]) =>
  ({
    id: "hashrate",
    at: history.at(-1)?.at,
    height: null,
    status: history.at(-1)?.status,
    value: 31.2,
    history,
  }) as unknown as WatchState;

const lab = (time: string, failed: string[] = []): LabRun => ({
  at: time,
  project: "bitcoin-core",
  version: "32.1",
  platform: "x86_64-linux-gnu",
  verified: { sha256: true, signatures: 8, signers: 40 },
  jobs: 3,
  seconds: 300,
  tests: ["feature_block.py", "p2p_invalid_block.py", ...failed].map((name) => ({
    name,
    ok: !failed.includes(name),
    seconds: 3,
  })),
});

function input(over: Partial<ChannelInput> = {}): ChannelInput {
  const b = built();
  return {
    bundle: {
      ...b,
      snapshots: [
        snap(1, "2026-11-19T10:00:00Z", [976800]),
        snap(2, "2026-11-21T18:00:00Z", [977060]),
        snap(3, "2026-11-22T18:00:00Z", []),
      ],
      security: {
        ...b.security,
        watches: [
          hashrate([
            point("2026-11-19T10:00:00Z", "ok", 25),
            point("2026-11-19T12:00:00Z", "elevated", 30.5),
            point("2026-11-21T10:00:00Z", "unknown", null),
            point("2026-11-21T11:00:00Z", "elevated", 30.8),
            point("2026-11-22T09:00:00Z", "ok", 29.1),
            point("2026-11-22T10:00:00Z", "unknown", null),
            point("2026-11-22T11:00:00Z", "ok", 29),
          ]),
        ],
        labRuns: [lab("2026-11-22T01:00:00Z"), lab("2026-11-22T05:00:00Z", ["feature_taproot.py"])],
      },
    },
    relays: ["wss://nos.lol", "wss://relay.primal.net"],
    at: "2026-11-22T12:00:00Z",
    since: "2026-11-22T06:00:00Z",
    screen: screen(),
    ...over,
  };
}

test("the channel covers the day before it began and after: complete digests, sealed editions, watch changes, lab runs", () => {
  assert.equal(channelStart("2026-11-22T06:00:00Z"), "2026-11-21T00:00:00Z");
  const { notes, held } = channelNotes(input());
  assert.deepEqual(
    notes.map((n) => n.id),
    [
      notes[0]?.id,
      notes[1]?.id,
      "edition:2",
      // the digest of 21 November is posted once that day is over; 22 November's is not yet
      `digest:${D}`,
      "lab:2026-11-22T01:00:00Z",
      "watch:hashrate:2026-11-22T09:00:00Z",
    ],
  );
  assert.match(notes[0]?.id ?? "", /^profile:[0-9a-f]{16}$/);
  assert.match(notes[1]?.id ?? "", /^relays:[0-9a-f]{16}$/);
  assert.deepEqual(notes[1]?.tags, [
    ["r", "wss://nos.lol"],
    ["r", "wss://relay.primal.net"],
  ]);
  // Snapshot 3 has no block yet; snapshot 1 and the 19 November change are before the channel.
  assert.deepEqual(
    held.map((h) => [h.id, h.reasons]),
    [["lab:2026-11-22T05:00:00Z", ["failed: feature_taproot.py"]]],
    "a lab run with a failure never goes out",
  );
  const profile = JSON.parse(notes[0]?.content ?? "{}");
  assert.equal(profile.nip05, "_@blocklore.space");
  assert.equal(profile.website, "https://blocklore.space");
  assert.equal(profile.bot, true);
  const edition = notes.find((n) => n.id === "edition:2");
  assert.equal(
    edition?.content,
    `Edition 2 of Blocklore's store is sealed in Bitcoin block 977,060: 230 claims under Merkle root ${"ab".repeat(32)}, timestamped with OpenTimestamps.\n\nThe snapshot: https://blocklore.space/snapshots/2.json\nCheck it yourself: https://blocklore.space/verify#snapshot-2`,
  );
  const watch = notes.find((n) => n.id.startsWith("watch:"));
  assert.equal(
    watch?.content,
    "Blocklore's security watch: Mining pool concentration went from elevated to ok. The largest mining pool's share of the blocks found over the last week: 29.1%.\n\nIts thresholds and history: https://blocklore.space/security#watch-hashrate",
  );
  assert.equal(
    notes.find((n) => n.id.startsWith("lab:"))?.content,
    "Blocklore's security lab ran 2 functional tests from Bitcoin Core 32.1 in regtest, against the release binaries: all 2 passed. The release matched its SHA256SUMS, with 8 good builder signatures.\n\nThe tests and what they cover: https://blocklore.space/security#lab",
  );
  for (const n of notes) {
    assert.equal(hasDash(n.content), false, `${n.id} keeps the house style`);
    assert.equal(hasDash(JSON.stringify(n.tags)), false);
  }
});

test("an LND run is a note in its own words; a failing one is held like Core's", () => {
  const lnd = (at: string, ok: boolean): LabRun => ({
    at,
    project: "lnd",
    version: "0.21.8-beta",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 4, signers: 16 },
    jobs: 3,
    seconds: 110,
    tests: [
      { name: "lnd/contractcourt", ok, seconds: 35 },
      { name: "lnd/sweep", ok: true, seconds: 3 },
    ],
  });
  const base = input();
  const labRuns = [lnd("2026-11-22T02:00:00Z", true), lnd("2026-11-22T03:00:00Z", false)];
  const { notes, held } = channelNotes({
    ...base,
    bundle: { ...base.bundle, security: { ...base.bundle.security, labRuns } },
  });
  const note = notes.find((n) => n.id === "lab:lnd:2026-11-22T02:00:00Z");
  assert.equal(note?.label, "The lab on LND 0.21.8-beta: 2 of 2 passed");
  assert.equal(
    note?.content,
    "Blocklore's security lab built LND 0.21.8-beta from its source and ran its own unit tests of 2 packages: all 2 passed. The source matched the release's signed manifest, with 4 good maintainer signatures.\n\nThe tests and what they cover: https://blocklore.space/security#lab",
  );
  assert.equal(hasDash(note?.content ?? ""), false);
  assert.deepEqual(
    held.map((h) => [h.id, h.reasons]),
    [["lab:lnd:2026-11-22T03:00:00Z", ["failed: lnd/contractcourt"]]],
  );
});

test("an LDK run is a note in its own words, naming the signed tag it was built from", () => {
  const ldk: LabRun = {
    at: "2026-11-24T06:00:00Z",
    project: "ldk",
    version: "0.2.8",
    platform: "x86_64-linux-gnu",
    verified: { sha256: true, signatures: 1, signers: 6 },
    jobs: 3,
    seconds: 90,
    tests: [
      { name: "ldk/chain/package", ok: true, seconds: 0.1 },
      { name: "ldk/ln/monitor_tests", ok: true, seconds: 40 },
    ],
  };
  const base = input();
  const { notes } = channelNotes({
    ...base,
    bundle: { ...base.bundle, security: { ...base.bundle.security, labRuns: [ldk] } },
  });
  const note = notes.find((n) => n.id === "lab:ldk:2026-11-24T06:00:00Z");
  assert.equal(note?.label, "The lab on LDK 0.2.8: 2 of 2 passed");
  assert.equal(
    note?.content,
    "Blocklore's security lab built LDK 0.2.8 from its release tag and ran its own tests of 2 modules of the lightning crate: all 2 passed. The source was the commit the tag names, and the tag's signature was good, by a maintainer LDK's SECURITY.md lists.\n\nThe tests and what they cover: https://blocklore.space/security#lab",
  );
  assert.equal(hasDash(note?.content ?? ""), false);
});

test("a watch reading that failed is no change; every real change is", () => {
  const w = hashrate([
    point("2026-11-19T10:00:00Z", "ok", 25),
    point("2026-11-19T11:00:00Z", "unknown", null),
    point("2026-11-19T12:00:00Z", "ok", 25),
    point("2026-11-19T13:00:00Z", "alert", 41),
    point("2026-11-19T14:00:00Z", "elevated", 35),
  ]);
  assert.deepEqual(
    watchChanges([w]).map((c) => `${c.from}>${c.to}@${c.at.slice(11, 13)}`),
    ["ok>alert@13", "alert>elevated@14"],
  );
});

test("the screen holds any note that names an embargoed finding or breaks the house style", () => {
  const dash = String.fromCharCode(0x2013);
  // A note in Blocklore's own words that names what the embargo holds stays back, with why.
  const { notes, held } = channelNotes(input({ screen: screen(["Mining pool concentration"]) }));
  assert.ok(!notes.some((n) => n.id.startsWith("watch:")));
  assert.deepEqual(
    held.filter((h) => h.id.startsWith("watch:")).map((h) => h.reasons),
    [["names something the embargo holds"]],
  );
  // A source link with a dash in it holds the whole article.
  const base = input().bundle;
  const tapr = base.claims["taproot.activated"] as Bundle["claims"][string];
  const claims = {
    ...base.claims,
    "taproot.activated": { ...tapr, sources: [src(`https://example.org/a${dash}b`)] },
  };
  const article = channelNotes(input({ bundle: { ...base, claims } }));
  assert.ok(!article.notes.some((n) => n.id === `digest:${D}`));
  assert.deepEqual(
    article.held.filter((h) => h.id === `digest:${D}`).map((h) => h.reasons),
    [["has a dash the house style refuses"]],
  );
  const s = screen();
  assert.deepEqual(s.text(`a range of 2${dash}4 blocks`), ["has a dash the house style refuses"]);
  assert.ok(
    s.text("A remote crash remains unpatched.").length > 0,
    "the gate reads Blocklore's own words",
  );
  assert.deepEqual(
    s.note("A remote crash remains unpatched."),
    [],
    "an article's claims were screened one by one",
  );
});
