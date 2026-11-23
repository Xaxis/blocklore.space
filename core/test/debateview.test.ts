import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, type Store } from "../src/bundle.ts";
import { type DebateRule, debateProblems, debateView } from "../src/debateview.ts";
import type { GateTopic } from "../src/gate.ts";
import type { Claim, Debate, Topic } from "../src/schema.ts";
import { claim } from "./fixtures.ts";

// Debate maps (BACKLOG 24): a debate publishes and shows only while it keeps every rule, and the view
// is rebuilt from the claims as they stand, so a withdrawn claim leaves the map.

const t1 = { time: "2026-11-21T09:00:00Z", height: 976850 };
const t2 = { time: "2026-11-22T09:00:00Z", height: 977000 };
const LETTER = "https://gnusha.org/pi/bitcoindev/letter-1/";
const POST = "https://delvingbitcoin.org/t/limits/1200/4";

const review: Claim["review"] = {
  by: "evaluator",
  reasons: ["contested topic: data-carriers"],
  at: t1.time,
  batch: "2026-11-21-evaluate-abc123",
  checks: ["quotes confirmed again", "structural rules held", "two verifiers accepted"],
  models: ["opus", "sonnet"],
};

/** A claim first published at `at`, its history consistent with that. */
const stamped = (c: Claim, at = t1): Claim => ({
  ...c,
  first_seen: at,
  last_verified: { ...at, run: "2026-11-21-daily-data-carriers", method: "quotes 1/1" },
  run: "2026-11-21-daily-data-carriers",
  revisions: [{ rev: 1, at, run: "2026-11-21-daily-data-carriers", change: "created" }],
});

const position = (id: string, holder: string, url: string, published?: string): Claim =>
  stamped(
    claim({
      id,
      statement: `${holder} argued on 9 June 2025 that the default limit on data carrier outputs should stay as it is.`,
      kind: "argument",
      topics: ["data-carriers"],
      status: "contested",
      confidence: "medium",
      people: [holder],
      attributed_to: [{ name: holder, url }],
      sources: [
        {
          tier: "T1",
          kind: "mailing-list",
          title: "A post",
          url,
          locator: "the post",
          quote: "the limit should stay",
          ...(published ? { published } : {}),
          accessed: "2026-11-20",
          supports: "direct",
        },
      ],
      checks: undefined,
      review,
    }),
  );

const CLAIMS: Claim[] = [
  position("data-carriers.keep-limit", "Ada Lovelace", LETTER, "2025-06-09"),
  position("data-carriers.lift-limit", "Grace Hopper", POST),
  stamped(
    claim({
      id: "data-carriers.core30-default",
      statement:
        "Bitcoin Core 30.0 relays transactions with OP_RETURN outputs of up to 100,000 bytes by default, since its release on 10 October 2025.",
      kind: "fact",
      topics: ["data-carriers"],
      checks: undefined,
      review,
    }),
    t2,
  ),
  stamped(
    claim({
      id: "data-carriers.policy-definition",
      statement:
        "Relay policy is the set of rules a node applies to unconfirmed transactions before it relays them, apart from the consensus rules every block must meet.",
      kind: "definition",
      topics: ["data-carriers"],
      checks: undefined,
      review,
    }),
  ),
];

const DEBATE: Debate = {
  slug: "op-return-limit",
  question: "Should the default relay policy limit the size of OP_RETURN outputs?",
  topics: ["data-carriers"],
  positions: [
    { id: "keep", label: "Keep a small default limit" },
    { id: "lift", label: "Lift the default limit" },
  ],
  nodes: [
    { claim: "data-carriers.keep-limit", nature: "value", position: "keep" },
    { claim: "data-carriers.lift-limit", nature: "value", position: "lift" },
    { claim: "data-carriers.core30-default", nature: "empirical" },
    { claim: "data-carriers.policy-definition", nature: "definitional" },
  ],
  edges: [
    { from: "data-carriers.core30-default", to: "data-carriers.keep-limit", rel: "rebuts" },
    { from: "data-carriers.core30-default", to: "data-carriers.lift-limit", rel: "supports" },
  ],
};

const FLAGS = new Map<string, GateTopic>([
  ["data-carriers", { slug: "data-carriers", contested: true, safety: false }],
  ["fees-and-mempool", { slug: "fees-and-mempool", contested: false, safety: false }],
]);

const byId = (list: Claim[]) => new Map(list.map((c) => [c.id, c]));
const rules = (d: Debate, list: Claim[] = CLAIMS, flags = FLAGS) =>
  debateProblems(d, byId(list), flags).map((p) => p.rule);
const swap = (id: string, over: Partial<Claim>) =>
  CLAIMS.map((c) => (c.id === id ? { ...c, ...over } : c));

test("a debate over published claims of the right kinds keeps every rule", () => {
  assert.deepEqual(debateProblems(DEBATE, byId(CLAIMS), FLAGS), []);
});

test("every node is a published claim the owner has not withdrawn, named once", () => {
  const missing = CLAIMS.filter((c) => c.id !== "data-carriers.core30-default");
  const p = debateProblems(DEBATE, byId(missing), FLAGS);
  assert.deepEqual(
    p.map((x) => [x.rule, x.claim]),
    [["published", "data-carriers.core30-default"]],
  );
  assert.deepEqual(rules(DEBATE, swap("data-carriers.core30-default", { status: "withdrawn" })), [
    "published",
  ]);
  const twice = { ...DEBATE, nodes: [...DEBATE.nodes, DEBATE.nodes[2] as Debate["nodes"][number]] };
  assert.deepEqual(rules(twice), ["published"]);
});

test("a value node is a stance or an argument attributed to who holds it", () => {
  assert.deepEqual(rules(DEBATE, swap("data-carriers.keep-limit", { kind: "fact" })), [
    "value node",
  ]);
  assert.deepEqual(rules(DEBATE, swap("data-carriers.keep-limit", { attributed_to: undefined })), [
    "value node",
  ]);
  assert.deepEqual(rules(DEBATE, swap("data-carriers.keep-limit", { kind: "stance" })), []);
});

test("an empirical node is a fact, mechanism, event or trace; a definitional one a definition", () => {
  for (const kind of ["mechanism", "event", "trace"] as const)
    assert.deepEqual(rules(DEBATE, swap("data-carriers.core30-default", { kind })), []);
  assert.deepEqual(rules(DEBATE, swap("data-carriers.core30-default", { kind: "definition" })), [
    "empirical node",
  ]);
  assert.deepEqual(rules(DEBATE, swap("data-carriers.core30-default", { kind: "open-question" })), [
    "empirical node",
  ]);
  assert.deepEqual(rules(DEBATE, swap("data-carriers.policy-definition", { kind: "fact" })), [
    "definitional node",
  ]);
});

test("value nodes sit under a position of the debate; shared ground under none", () => {
  const nodes = (f: (n: Debate["nodes"][number]) => Debate["nodes"][number]) => ({
    ...DEBATE,
    nodes: DEBATE.nodes.map(f),
  });
  const unplaced = nodes((n) =>
    n.claim === "data-carriers.keep-limit" ? { claim: n.claim, nature: "value" } : n,
  );
  // The keep side is then empty too.
  assert.deepEqual(rules(unplaced), ["position", "every side"]);
  const elsewhere = nodes((n) =>
    n.claim === "data-carriers.keep-limit" ? { ...n, position: "abolish" } : n,
  );
  assert.deepEqual(rules(elsewhere), ["position", "every side"]);
  const sided = nodes((n) =>
    n.claim === "data-carriers.core30-default" ? { ...n, position: "keep" } : n,
  );
  assert.deepEqual(rules(sided), ["position"]);
  const doubled = { ...DEBATE, positions: [...DEBATE.positions, { id: "keep", label: "Again" }] };
  assert.deepEqual(rules(doubled), ["position"]);
});

test("every edge joins two nodes of this debate, never a node to itself, once", () => {
  const e = (edges: Debate["edges"]) => rules({ ...DEBATE, edges });
  const self = "data-carriers.keep-limit";
  assert.deepEqual(e([{ from: self, to: self, rel: "supports" }]), ["edges"]);
  assert.deepEqual(e([{ from: "data-carriers.elsewhere", to: self, rel: "rebuts" }]), ["edges"]);
  const one = DEBATE.edges[0] as Debate["edges"][number];
  assert.deepEqual(e([one, one]), ["edges"]);
  assert.deepEqual(e([]), []);
});

test("every position has a value node, so no side is left empty", () => {
  const third = {
    ...DEBATE,
    positions: [...DEBATE.positions, { id: "remove", label: "Remove OP_RETURN relay" }],
  };
  const p = debateProblems(third, byId(CLAIMS), FLAGS);
  assert.deepEqual(
    p.map((x) => x.rule),
    ["every side"],
  );
  assert.match(p[0]?.detail ?? "", /remove/);
});

test("the debate's own words pass the style check, name no person and use no loaded word", () => {
  const ask = (question: string, label = "Keep a small default limit") =>
    debateProblems(
      { ...DEBATE, question, positions: [{ id: "keep", label }, DEBATE.positions[1] as never] },
      byId(CLAIMS),
      FLAGS,
    );
  const dash = String.fromCharCode(0x2014);
  assert.deepEqual(
    ask(`Should the default policy${dash}in Bitcoin Core${dash}limit OP_RETURN?`).map(
      (p) => p.rule,
    ),
    ["own voice"],
  );
  assert.deepEqual(
    ask("Should relay policy simply drop large OP_RETURN outputs?").map((p) => p.rule),
    ["own voice"],
  );
  // Full names in any case, surnames as written.
  assert.match(ask("Is Ada Lovelace right about OP_RETURN limits?")[0]?.detail ?? "", /Ada/);
  assert.match(ask("Should nodes follow Hopper on OP_RETURN limits?")[0]?.detail ?? "", /Hopper/);
  assert.deepEqual(ask("Should nodes keep a hopper of OP_RETURN outputs?"), []);
  // A label is the debate's voice too.
  assert.match(
    ask(DEBATE.question, "Lovelace's side")[0]?.detail ?? "",
    /position keep's label names Lovelace/,
  );
  // All six of EDITORIAL's loaded words, unless reported as what people call things.
  for (const word of ["spam", "filters", "censorship", "attack", "bloat", "ossification"])
    assert.deepEqual(
      ask(`Should relay policy treat large OP_RETURN outputs as ${word}?`).map((p) => p.rule),
      ["own voice"],
      word,
    );
  assert.deepEqual(ask('Should relay policy refuse what critics call "spam"?'), []);
  assert.deepEqual(ask("Should relay policy refuse what critics call spam?"), []);
});

test("a debate needs a contested topic, by the gate flags of topics that exist", () => {
  assert.deepEqual(rules({ ...DEBATE, topics: ["fees-and-mempool"] }), ["contested"]);
  assert.deepEqual(rules({ ...DEBATE, topics: ["made-up"] }), ["contested"]);
  assert.deepEqual(rules({ ...DEBATE, topics: ["fees-and-mempool", "data-carriers"] }), []);
});

test("the view groups value nodes by position, then the shared ground, with holders and edges", () => {
  const { view, problems } = debateView(DEBATE, byId(CLAIMS), FLAGS);
  assert.deepEqual(problems, []);
  assert.ok(view);
  assert.deepEqual(
    view.positions.map((p) => [p.id, p.claims]),
    [
      ["keep", ["data-carriers.keep-limit"]],
      ["lift", ["data-carriers.lift-limit"]],
    ],
  );
  assert.deepEqual(view.empirical, ["data-carriers.core30-default"]);
  assert.deepEqual(view.definitional, ["data-carriers.policy-definition"]);
  const keep = view.nodes["data-carriers.keep-limit"];
  assert.deepEqual(keep?.holders, [{ name: "Ada Lovelace", url: LETTER, stated: "2025-06-09" }]);
  assert.deepEqual(view.nodes["data-carriers.lift-limit"]?.holders, [
    { name: "Grace Hopper", url: POST, stated: null },
  ]);
  assert.deepEqual(keep?.rebuttedBy, ["data-carriers.core30-default"]);
  const fact = view.nodes["data-carriers.core30-default"];
  assert.deepEqual(
    [fact?.rebuts, fact?.supports, fact?.holders],
    [["data-carriers.keep-limit"], ["data-carriers.lift-limit"], []],
  );
  assert.deepEqual(
    view.claims.map((id) => view.nodes[id]?.n),
    [1, 2, 3, 4],
  );
  assert.deepEqual(view.updated, t2, "the newest revision among its claims");
});

test("a withdrawn claim drops out of the view, and a debate that then breaks a rule is not shown", () => {
  const factGone = swap("data-carriers.core30-default", { status: "withdrawn" });
  const { view } = debateView(DEBATE, byId(factGone), FLAGS);
  assert.ok(view, "the map still keeps every rule without the fact");
  assert.equal(view.nodes["data-carriers.core30-default"], undefined);
  assert.deepEqual(view.empirical, []);
  assert.deepEqual(view.edges, [], "its edges go with it");

  const sideGone = swap("data-carriers.lift-limit", { status: "withdrawn" });
  const r = debateView(DEBATE, byId(sideGone), FLAGS);
  assert.equal(r.view, null);
  assert.deepEqual(
    r.problems.map((p) => p.rule),
    ["every side"] satisfies DebateRule[],
  );
});

const topic = (slug: string, contested: boolean, claims: string[]): Topic => ({
  slug,
  title: slug,
  lede: claims[0] as string,
  contested,
  safety: false,
  group: "protocol",
  sections: [{ id: "basics", title: "Basics", depth: "curious", claims }],
});

const store = (claims: Claim[], debates: Debate[], contested = true): Store => ({
  wire: null,
  bips: null,
  claims,
  topics: [
    topic(
      "data-carriers",
      contested,
      CLAIMS.map((c) => c.id),
    ),
  ],
  proposals: [],
  debates,
  runs: [],
  snapshots: [],
  review: [],
});

test("the bundle carries only the debates that keep every rule, and links their claims to them", () => {
  const shown = compile(store(CLAIMS, [DEBATE]), t2);
  assert.deepEqual(
    shown.issues.filter((i) => i.level === "error"),
    [],
  );
  assert.deepEqual(
    shown.bundle.debates.map((d) => d.slug),
    ["op-return-limit"],
  );
  assert.ok(
    shown.bundle.claims["data-carriers.keep-limit"]?.shownIn.some(
      (s) => s.kind === "debate" && s.slug === "op-return-limit",
    ),
  );

  // The owner withdraws one side's only argument: the debate leaves the site, the file stays.
  const withdrawn = CLAIMS.map((c) =>
    c.id === "data-carriers.lift-limit"
      ? {
          ...c,
          status: "withdrawn" as const,
          revisions: [
            ...c.revisions,
            {
              rev: 2,
              at: t2,
              run: "2026-11-22-revoke-x",
              change: "withdrawn" as const,
              note: "Withdrawn by the owner: misquoted.",
              before: { status: "contested" as const },
            },
          ],
        }
      : c,
  );
  const gone = compile(store(withdrawn, [DEBATE]), t2);
  assert.deepEqual(gone.bundle.debates, []);
  assert.ok(
    gone.issues.some(
      (i) =>
        i.file === "debate op-return-limit" &&
        i.level === "warning" &&
        /no value node/.test(i.message),
    ),
  );
  assert.ok(
    !gone.bundle.claims["data-carriers.keep-limit"]?.shownIn.some((s) => s.kind === "debate"),
  );

  // A topic the owner no longer marks contested takes its debates off the site.
  assert.deepEqual(compile(store(CLAIMS, [DEBATE], false), t2).bundle.debates, []);
});

test("a debate naming a claim that does not exist is an error in the store", () => {
  const broken = {
    ...DEBATE,
    nodes: [...DEBATE.nodes, { claim: "data-carriers.nowhere", nature: "empirical" as const }],
  };
  const { issues } = compile(store(CLAIMS, [broken]), t2);
  assert.ok(
    issues.some((i) => i.level === "error" && i.message === "no claim data-carriers.nowhere"),
  );
  const twice = compile(store(CLAIMS, [DEBATE, DEBATE]), t2);
  assert.ok(twice.issues.some((i) => i.level === "error" && i.message === "is used twice"));
});
