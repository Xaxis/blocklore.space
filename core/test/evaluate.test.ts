import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, type Store } from "../src/bundle.ts";
import {
  batchPublishing,
  calibration,
  contentOf,
  decide,
  MIN_CANARIES,
  MUTATIONS,
  makeCanaries,
  mutate,
  type Stage,
  structuralRules,
  verdictStage,
} from "../src/evaluate.ts";
import { gate, type Scrutiny, scrutinyOf } from "../src/gate.ts";
import type { Claim, Source, Topic } from "../src/schema.ts";
import { validateClaim } from "../src/validate.ts";
import { claim } from "./fixtures.ts";

const ml = (n: string): Source => ({
  tier: "T1",
  kind: "mailing-list",
  title: "bitcoindev mailing list",
  url: `https://gnusha.org/pi/bitcoindev/${n}/`,
  locator: "the message",
  quote: "I argue that the cost is worth it.",
  published: "2025-06-09",
  accessed: "2026-11-20",
  supports: "direct",
});

const argument = (over: Partial<Claim> = {}): Claim =>
  claim({
    id: "covenants.obeirne-letter",
    statement:
      "James O'Beirne argued on the bitcoindev mailing list on 9 June 2025 that the cost of activating CTV is worth its benefit for vaults.",
    kind: "argument",
    topics: ["covenants"],
    status: "contested",
    people: ["James O'Beirne"],
    attributed_to: [{ name: "James O'Beirne", url: "https://gnusha.org/pi/bitcoindev/abc/" }],
    sources: [ml("abc")],
    checks: undefined,
    related: ["covenants.other-side"],
    ...over,
  });

const broken = (c: Claim, s: Scrutiny[]) =>
  structuralRules(c, new Set(s))
    .filter((r) => !r.ok)
    .map((r) => r.rule);

test("a well-formed argument passes every rule its gate reasons call for", () => {
  const c = argument();
  const topics = new Map([["covenants", { slug: "covenants", contested: true, safety: false }]]);
  const reasons = gate(c, topics, ["CTV"]);
  assert.deepEqual([...scrutinyOf(reasons)].sort(), ["contested", "person", "position"]);
  assert.deepEqual(broken(c, [...scrutinyOf(reasons)]), []);
});

test("each rule fails the claim it was written for", () => {
  const all: Scrutiny[] = ["contested", "position", "person", "safety"];
  // attributed without a link, and the link not a cited source
  assert.ok(
    broken(argument({ attributed_to: [{ name: "James O'Beirne" }] }), all).includes(
      "attributed with a link",
    ),
  );
  assert.ok(
    broken(
      argument({
        attributed_to: [{ name: "James O'Beirne", url: "https://example.com/elsewhere" }],
      }),
      all,
    ).includes("in their own words"),
  );
  // an argument stated as settled
  assert.ok(broken(argument({ status: "established" }), all).includes("not settled"));
  // undated: no date in the statement, none on the source
  const undated = argument({
    statement:
      "James O'Beirne argued on the bitcoindev mailing list that the cost of activating CTV is worth its benefit for vaults.",
    sources: [{ ...ml("abc"), published: undefined }],
  });
  assert.ok(broken(undated, all).includes("dated"));
  // a person listed but not named, and named but not attributed
  assert.ok(broken(argument({ people: ["Matt Corallo"] }), all).includes("named as listed"));
  assert.ok(
    broken(
      argument({
        people: ["James O'Beirne", "Matt Corallo"],
        statement: `${argument().statement} Matt Corallo replied.`,
      }),
      all,
    ).includes("person attributed"),
  );
  // a contested claim that links no side
  assert.ok(broken(argument({ related: undefined }), all).includes("links the sides"));
  // only social media behind a gated claim
  assert.ok(
    broken(argument({ sources: [{ ...ml("abc"), tier: "T4", kind: "social" }] }), all).includes(
      "primary evidence",
    ),
  );
});

test("contested facts keep Blocklore's voice neutral, uncounted and unpredicting", () => {
  const fact = (statement: string) =>
    claim({ id: "fees-and-mempool.x", topics: ["fees-and-mempool"], statement });
  const s: Scrutiny[] = ["contested"];
  assert.ok(
    broken(
      fact(
        "Bitcoin Core 30.0 relays transactions that embed data, which fills blocks with spam since block 900,000.",
      ),
      s,
    ).includes("neutral words"),
  );
  assert.deepEqual(
    broken(
      fact(
        "Bitcoin Core 30.0 relays transactions that embed arbitrary data, which critics call spam, since block 900,000.",
      ),
      s,
    ),
    [],
  );
  assert.ok(
    broken(
      fact(
        "Most developers support relaxing the OP_RETURN limit that Bitcoin Core enforced before version 30.0.",
      ),
      s,
    ).includes("counted with care"),
  );
  assert.ok(
    broken(
      fact(
        "BIP 119 will activate on mainnet because miners and node operators have signaled for it in 2026.",
      ),
      s,
    ).includes("no predicted outcome"),
  );
  assert.deepEqual(
    broken(
      fact(
        "BIP 9 deployments will activate if 95 percent of blocks in a retarget period signal for them.",
      ),
      s,
    ),
    [],
  );
});

test("safety claims need two independent sources and no advice voice", () => {
  const two: Source[] = [
    { ...ml("a"), quote: "a passphrase adds a factor" },
    {
      tier: "T2",
      kind: "stackexchange",
      title: "Bitcoin Stack Exchange answer",
      url: "https://bitcoin.stackexchange.com/a/1",
      locator: "answer",
      quote: "a passphrase adds a factor",
      accessed: "2026-11-20",
      supports: "partial",
    },
  ];
  const safe = (statement: string, sources: Source[] = two) =>
    claim({
      id: "self-custody.x",
      topics: ["self-custody"],
      statement,
      sources,
      checks: undefined,
    });
  const s: Scrutiny[] = ["safety"];
  const ok =
    "A BIP 39 passphrase adds a second factor, so a thief who finds the seed words alone cannot spend the coins it protects.";
  assert.deepEqual(broken(safe(ok), s), []);
  assert.ok(broken(safe(ok, [two[0] as Source]), s).includes("independent sources"));
  assert.ok(
    broken(
      safe(
        "You should always add a BIP 39 passphrase, so a thief who finds the seed words alone cannot spend the coins.",
      ),
      s,
    ).includes("no advice voice"),
  );
  assert.ok(
    broken(
      safe(
        "Use a BIP 39 passphrase, so that a thief who finds the seed words alone cannot spend the coins it protects.",
      ),
      s,
    ).includes("no advice voice"),
  );
});

const stage = (name: Stage["stage"], ok: boolean | null): Stage => ({
  stage: name,
  ok,
  detail: "d",
});
const all = (ok: boolean | null = true) =>
  (["recheck", "rules", "verifier-a", "verifier-b"] as const).map((n) => stage(n, ok));
const open = { allowed: true, why: null };

test("every stage must pass to publish; a failure rejects, a doubt holds, a gap holds", () => {
  assert.equal(decide(all(), open).outcome, "publish");
  for (const i of [0, 1, 2, 3]) {
    const failed = all();
    (failed[i] as Stage).ok = false;
    assert.equal(decide(failed, open).outcome, "reject", `stage ${i} failed`);
    const unsure = all();
    (unsure[i] as Stage).ok = null;
    assert.equal(decide(unsure, open).outcome, "hold", `stage ${i} could not run`);
    assert.equal(
      decide(
        all().filter((_, j) => j !== i),
        open,
      ).outcome,
      "hold",
      `stage ${i} missing`,
    );
  }
  assert.equal(decide(all(), { allowed: false, why: "paused" }).outcome, "hold");
});

test("both verifiers must accept: revise or reject from either does not publish", () => {
  const base = all().slice(0, 2);
  const accept = { verdict: "accept" as const, reason: "checked" };
  const revise = { verdict: "revise" as const, reason: "soften it" };
  const reject = { verdict: "reject" as const, reason: "wrong number" };
  const run = (a: typeof accept | typeof revise | typeof reject | null, b: typeof accept | null) =>
    decide(
      [...base, verdictStage("verifier-a", "opus", a), verdictStage("verifier-b", "sonnet", b)],
      open,
    ).outcome;
  assert.equal(run(accept, accept), "publish");
  assert.equal(run(revise, accept), "reject");
  assert.equal(run(reject, accept), "reject");
  assert.equal(run(null, accept), "hold", "no verdict is a doubt");
  assert.equal(run(accept, null), "hold");
});

test("calibration: too few canaries calibrates, a low catch rate pauses, a missed canary holds the batch", () => {
  const s = { window: 10, minCatchRate: 0.9 };
  const r = (caught: boolean, i: number) => ({
    at: `2026-11-21T00:00:${String(i).padStart(2, "0")}Z`,
    kind: "number",
    caught,
  });
  const few = calibration([r(true, 1), r(true, 2)], s);
  assert.equal(few.publishing, false);
  assert.match(few.why ?? "", /calibrating/);
  const good = calibration(
    Array.from({ length: 10 }, (_, i) => r(true, i)),
    s,
  );
  assert.equal(good.publishing, true);
  const bad = calibration(
    Array.from({ length: 10 }, (_, i) => r(i > 1, i)),
    s,
  );
  assert.equal(bad.rate, 0.8);
  assert.equal(bad.publishing, false);
  assert.match(bad.why ?? "", /paused: the evaluator caught 8 of the last 10/);
  // old misses fall out of the window
  const recovered = calibration(
    [r(false, 0), r(false, 1), ...Array.from({ length: 10 }, (_, i) => r(true, i + 2))],
    s,
  );
  assert.equal(recovered.publishing, true);
  assert.equal(recovered.total, 12);
  assert.equal(batchPublishing(good, 1).allowed, false);
  assert.equal(batchPublishing(good, 0).allowed, true);
  assert.ok(MIN_CANARIES >= 3);
});

const published: Claim[] = [
  claim(),
  claim({
    id: "taproot.activation",
    topics: ["taproot"],
    statement:
      "Taproot's rules are enforced on mainnet since block 709,632 under BIP 341, and nodes may reject spends that break them.",
    sources: [
      {
        ...ml("t"),
        tier: "T1",
        kind: "optech",
        url: "https://bitcoinops.org/en/topics/taproot/",
        quote: "Taproot activated at block 709,632",
      },
    ],
    checks: undefined,
  }),
  claim({
    id: "segwit.weight",
    topics: ["segwit"],
    statement:
      "SegWit counts witness data at one quarter weight, so a block may typically hold about 2,000 transactions under BIP 141.",
    sources: [
      {
        ...ml("s"),
        tier: "T1",
        kind: "optech",
        url: "https://bitcoinops.org/en/topics/segwit/",
        quote: "witness data at one quarter weight",
      },
    ],
    checks: undefined,
  }),
];

test("canaries are deterministic, well formed, fresh, and each says something its source does not", () => {
  const taken = new Set(published.map((c) => c.id));
  const pool = published.map(contentOf);
  const a = makeCanaries("seed-1", pool, [], 5, taken);
  const b = makeCanaries("seed-1", pool, [], 5, taken);
  assert.deepEqual(a, b, "same seed, same canaries");
  assert.equal(a.length, 5);
  assert.notDeepEqual(makeCanaries("seed-2", pool, [], 5, taken), a);
  const ids = new Set<string>();
  for (const c of a) {
    assert.ok(!taken.has(c.id) && !ids.has(c.id), `${c.id} is fresh`);
    ids.add(c.id);
    const source = published.find((p) => p.id === c.source) as Claim;
    assert.ok(c.id.startsWith(`${source.topics[0]}.`));
    assert.ok(
      c.candidate.statement !== source.statement ||
        JSON.stringify(c.candidate.sources) !== JSON.stringify(source.sources),
      `${c.kind} changes something`,
    );
    const at = source.first_seen;
    const errors = validateClaim({
      ...c.candidate,
      first_seen: at,
      last_verified: source.last_verified,
      run: "x",
      revisions: source.revisions,
    }).filter((i) => i.level === "error");
    assert.deepEqual(errors, [], `${c.kind} canary passes the schema's rules`);
  }
  assert.ok(new Set(a.map((c) => c.kind)).size >= 3, "kinds rotate");
});

test("each mutation changes what it says it changes", () => {
  const pool = published.map(contentOf);
  const seg = pool[2] as ReturnType<typeof contentOf>;
  const n = mutate("number", seg, pool, "s");
  assert.ok(n && n.statement !== seg.statement && /\d/.test(n.statement));
  const h = mutate("hedge", seg, pool, "s");
  assert.ok(
    (h &&
      !/\b(may|typically|about)\b/.test(h.statement) !==
        !/\b(may|typically|about)\b/.test(seg.statement)) ||
      h?.statement !== seg.statement,
  );
  const name = mutate("name", pool[1] as ReturnType<typeof contentOf>, pool, "s");
  assert.ok(name && /BIP \d+/.test(name.statement) && !name.statement.includes("BIP 341"));
  const q = mutate("quote", seg, pool, "s");
  assert.ok(q && q.statement === seg.statement && q.sources[0]?.url !== seg.sources[0]?.url);
  const stance = mutate("stance", contentOf(argument()), pool, "s");
  assert.ok(
    stance && stance.kind === "fact" && stance.status === "established" && !stance.attributed_to,
  );
  assert.ok(MUTATIONS.includes("revoked"));
  const revoked = makeCanaries("r", [], [contentOf(argument())], 1, new Set());
  assert.equal(revoked[0]?.kind, "revoked");
  assert.equal(revoked[0]?.candidate.statement, argument().statement);
});

test("a withdrawn claim leaves every topic, list and search, and keeps its page and history", () => {
  const at = { time: "2026-11-21T12:00:00Z", height: 977000 };
  const gone = claim({
    id: "halvings.gone",
    status: "withdrawn",
    revisions: [
      ...claim().revisions,
      {
        rev: 2,
        at,
        run: "2026-11-21-revoke-halvings-gone",
        change: "withdrawn",
        note: "Withdrawn by the owner: wrong date.",
        before: { status: "established" },
      },
    ],
    last_verified: { ...at, run: "2026-11-21-revoke-halvings-gone", method: "withdrawn" },
  });
  const kept = claim({ related: ["halvings.gone"] });
  const topic: Topic = {
    slug: "halvings",
    title: "Halvings",
    lede: "halvings.gone",
    contested: false,
    safety: false,
    group: "foundations",
    sections: [
      { id: "basics", title: "Basics", depth: "curious", claims: ["halvings.gone", kept.id] },
    ],
  };
  const store: Store = {
    wire: null,
    bips: null,
    claims: [gone, kept],
    topics: [topic],
    proposals: [],
    debates: [],
    runs: [],
    snapshots: [],
    review: [],
  };
  const { bundle, issues } = compile(store, at);
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
  );
  assert.equal(bundle.claims["halvings.gone"], undefined);
  assert.equal(
    bundle.withdrawn["halvings.gone"]?.withdrawal?.note,
    "Withdrawn by the owner: wrong date.",
  );
  assert.deepEqual(bundle.topics[0]?.sections[0]?.claims, [kept.id]);
  assert.equal(bundle.topics[0]?.lede, kept.id);
  assert.deepEqual(bundle.claims[kept.id]?.related, []);
  assert.equal(bundle.stats.claims, 1);
  assert.equal(bundle.stats.withdrawn, 1);
  assert.ok(bundle.events.some((e) => e.claim === "halvings.gone" && e.change === "withdrawn"));
});

test("withdrawn is a state only a withdrawn revision reaches, and never leaves", () => {
  const errors = (c: Claim) =>
    validateClaim(c)
      .filter((i) => i.level === "error")
      .map((i) => i.message);
  assert.ok(errors(claim({ status: "withdrawn" })).some((m) => m.includes("withdrawn revision")));
  const at = { time: "2026-11-21T12:00:00Z", height: 977000 };
  const back = claim({
    revisions: [
      ...claim().revisions,
      { rev: 2, at, run: "r", change: "withdrawn", note: "Withdrawn by the owner: x." },
    ],
    last_verified: { ...at, run: "r", method: "m" },
  });
  assert.ok(errors(back).some((m) => m.includes("stays withdrawn")));
});
