// Debate maps through the brain (BACKLOG 24), in temporary folders: brain check reports a run's
// debate rules, the publisher writes a debate only when it keeps them, a debate whose claims wait
// for the evaluator waits beside them and publishes with a later commit, a withdrawn claim leaves
// the map, and a debate built on a test claim never publishes. The real gate policy is read
// (covenants is contested there); nothing touches the network.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Claim, Debate, Topic } from "@blocklore/core";
import { parse, stringify } from "yaml";

const ROOT = mkdtempSync(path.join(tmpdir(), "bl-debates-"));
const KNOWLEDGE = path.join(ROOT, "knowledge");
const REVIEW = path.join(ROOT, "review");
const EVAL = path.join(ROOT, "evaluator");
process.env.BLOCKLORE_KNOWLEDGE = KNOWLEDGE;
process.env.BLOCKLORE_REVIEW_DIR = REVIEW;
process.env.BLOCKLORE_EVALUATOR_DIR = EVAL;
process.env.BLOCKLORE_AGENT_ROOT = path.join(ROOT, "agent");
process.env.BLOCKLORE_CONTROL_DIR = path.join(ROOT, "control");
process.env.BLOCKLORE_EMBARGO_DIR = path.join(ROOT, "embargo");

const { compile } = await import("@blocklore/core");
const { loadStore } = await import("@blocklore/core/node");
const { commitStore, createClaim, publicTopics, publish, reviewCounts } = await import(
  "../src/publish.ts"
);
const { checkRun } = await import("../src/research.ts");
const { revokeAt } = await import("../src/revoke.ts");
const { registerCanaries } = await import("../src/canary.ts");
const { isDebateReport, readWaitingDebates } = await import("../src/debates.ts");
const { loadPolicy, readPending, removePending } = await import("../src/store.ts");

const T0 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const NOW = { time: "2026-11-21T12:00:00Z", height: 977000 };
const LATER = { time: "2026-11-22T12:00:00Z", height: 977150 };
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const LETTER = "https://gnusha.org/pi/bitcoindev/letter-1/";
const OBJECTION = "https://delvingbitcoin.org/t/ctv-review/1500/7";
const chain = { name: "fake", tipHeight: async () => NOW.height } as never;

const review = (reasons: string[]): Claim["review"] => ({
  by: "evaluator",
  reasons,
  at: T0.time,
  batch: "2026-11-20-evaluate-abc123",
  checks: ["every quote confirmed again", "structural rules held", "two verifiers accepted"],
  models: ["opus", "sonnet"],
});

type Content = Omit<Claim, "first_seen" | "last_verified" | "run" | "revisions" | "review">;

const argument = (id: string, holder: string, url: string, says: string): Content => ({
  id,
  statement: `${holder} argued on 9 June 2025 that ${says}.`,
  kind: "argument",
  topics: ["covenants"],
  depth: "builder",
  status: "contested",
  confidence: "medium",
  people: [holder],
  attributed_to: [{ name: holder, url }],
  sources: [
    {
      tier: "T1",
      kind: url.includes("delving") ? "delving" : "mailing-list",
      title: `${holder}'s post`,
      url,
      locator: "the post",
      quote: says,
      published: "2025-06-09",
      accessed: "2026-11-20",
      supports: "direct",
    },
  ],
});

const LETTER_ARG = argument(
  "covenants.ctv-letter",
  "Ada Lovelace",
  LETTER,
  "the benefits of activating CTV outweigh the cost of its review",
);
const OBJECTION_ARG = argument(
  "covenants.ctv-objection",
  "Grace Hopper",
  OBJECTION,
  "a covenant opcode should wait until more designs have been compared in review",
);
const FACT: Content = {
  id: "covenants.what-ctv-does",
  statement:
    "BIP 119 specifies OP_CHECKTEMPLATEVERIFY, an opcode that commits to the exact outputs of the transaction that spends it.",
  kind: "fact",
  topics: ["covenants"],
  depth: "builder",
  status: "established",
  confidence: "high",
  people: [],
  sources: [
    {
      tier: "T1",
      kind: "bip",
      title: "BIP 119",
      url: `https://github.com/bitcoin/bips/blob/${COMMIT}/bip-0119.mediawiki`,
      locator: "Abstract",
      quote: "commits to the exact outputs",
      accessed: "2026-11-20",
      supports: "direct",
    },
  ],
};
const DEFINITION: Content = {
  ...FACT,
  id: "covenants.covenant-definition",
  statement:
    "A covenant is a rule an output places on how the transaction that spends it may itself be spent, beyond who may sign.",
  kind: "definition",
};

const published = (c: Content): Claim =>
  createClaim(
    c,
    T0,
    "2026-11-20-seed-covenants",
    "quotes 1/1",
    review(["contested topic: covenants"]),
  );

const DEBATE: Debate = {
  slug: "ctv-activation",
  question: "Should Bitcoin activate OP_CHECKTEMPLATEVERIFY as a soft fork?",
  topics: ["covenants"],
  positions: [
    { id: "activate", label: "Activate CTV" },
    { id: "wait", label: "Wait for further review" },
  ],
  nodes: [
    { claim: "covenants.ctv-letter", nature: "value", position: "activate" },
    { claim: "covenants.ctv-objection", nature: "value", position: "wait" },
    { claim: "covenants.what-ctv-does", nature: "empirical" },
    { claim: "covenants.covenant-definition", nature: "definitional" },
  ],
  edges: [{ from: "covenants.what-ctv-does", to: "covenants.ctv-letter", rel: "supports" }],
};

const topic = (claims: string[]): Topic => ({
  slug: "covenants",
  title: "Covenant proposals",
  lede: claims[0] as string,
  contested: true,
  safety: false,
  group: "protocol",
  sections: [{ id: "basics", title: "Basics", depth: "curious", claims }],
});

/** A fresh store: these claims published on covenants; `waiting` in the evaluator's queue. */
function reset(claims: Content[], waiting: Content[] = []) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(path.join(KNOWLEDGE, "claims", "covenants"), { recursive: true });
  for (const c of claims)
    writeFileSync(
      path.join(KNOWLEDGE, "claims", "covenants", `${c.id}.yaml`),
      stringify(published(c)),
    );
  mkdirSync(path.join(KNOWLEDGE, "topics"), { recursive: true });
  writeFileSync(
    path.join(KNOWLEDGE, "topics", "covenants.yaml"),
    stringify(topic(claims.map((c) => c.id))),
  );
  mkdirSync(path.join(REVIEW, "claims"), { recursive: true });
  for (const c of waiting)
    writeFileSync(
      path.join(REVIEW, "claims", `${c.id}.yaml`),
      stringify({
        candidate: c,
        reasons: ["contested topic: covenants", "an argument"],
        run: "2026-11-21-daily-covenants",
        proposed: NOW,
        verdict: { id: c.id, verdict: "accept", reason: "the research run's verifier accepted it" },
        method: "quotes 1/1",
        updates: false,
      }),
    );
}

/** A research run folder holding only these debate files. */
function run(id: string, debates: Record<string, unknown>): string {
  const dir = path.join(ROOT, "agent", "staging", id);
  mkdirSync(path.join(dir, "debates"), { recursive: true });
  for (const [name, d] of Object.entries(debates))
    writeFileSync(path.join(dir, "debates", `${name}.yaml`), stringify(d));
  return id;
}

const debateFile = (slug: string) => path.join(KNOWLEDGE, "debates", `${slug}.yaml`);
const runLog = (id: string) =>
  parse(readFileSync(path.join(KNOWLEDGE, "runs", id.slice(0, 4), `${id}.yaml`), "utf8"));
const shown = () => {
  const { store, issues } = loadStore(KNOWLEDGE);
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
  );
  const c = compile(store, LATER);
  assert.deepEqual(
    c.issues.filter((i) => i.level === "error"),
    [],
  );
  return c.bundle.debates;
};

test("brain check reports a run's debate rules in the report research repairs from", async () => {
  reset([FACT, DEFINITION, LETTER_ARG], [OBJECTION_ARG]);
  const broken: Debate = {
    ...DEBATE,
    slug: "ctv-broken",
    positions: [
      { id: "activate", label: "Lovelace's side" },
      DEBATE.positions[1] as Debate["positions"][number],
    ],
    nodes: [...DEBATE.nodes, { claim: "covenants.nowhere", nature: "empirical" }],
  };
  const id = run("2026-11-21-daily-covenants", {
    "ctv-activation": DEBATE,
    "ctv-broken": broken,
    misnamed: { ...DEBATE, slug: "ctv-other" },
    "not-a-debate": { question: "?" },
  });
  const reports = await checkRun(id, chain, true);
  const by = new Map(reports.map((r) => [r.id, r]));
  // A node waiting for the evaluator is fine at check time: the publisher holds the debate for it.
  assert.equal(by.get("debate ctv-activation")?.ok, true);
  const b = by.get("debate ctv-broken");
  assert.equal(b?.ok, false);
  assert.deepEqual(
    b?.issues.map((i) => i.where),
    ["debate: published", "debate: own voice"],
  );
  assert.match(b?.issues[1]?.message ?? "", /names Lovelace/);
  assert.equal(
    by.get("debate misnamed")?.issues[0]?.message,
    "the file must be named ctv-other.yaml",
  );
  assert.equal(by.get("debate not-a-debate")?.issues[0]?.where, "debate schema");
  const written = JSON.parse(
    readFileSync(path.join(ROOT, "agent", "staging", id, "checks.json"), "utf8"),
  );
  // beside them, a report on run.yaml, which this fixture leaves out
  assert.equal(written.filter(isDebateReport).length, 4, "checks.json holds the debate reports");
});

test("publish writes a debate that keeps every rule, and the site shows it", async () => {
  reset([FACT, DEFINITION, LETTER_ARG, OBJECTION_ARG]);
  const id = run("2026-11-21-daily-covenants", { "ctv-activation": DEBATE });
  assert.equal(await publish(id, { commit: false, push: false }, chain), 0);
  assert.deepEqual(parse(readFileSync(debateFile("ctv-activation"), "utf8")), DEBATE);
  assert.deepEqual(readWaitingDebates(), []);
  const debates = shown();
  assert.deepEqual(
    debates.map((d) => [d.slug, d.claims.length]),
    [["ctv-activation", 4]],
  );
});

test("publish refuses a debate that breaks a rule, and logs it by slug and rule only", async () => {
  reset([FACT, DEFINITION, LETTER_ARG, OBJECTION_ARG]);
  const loaded = { ...DEBATE, question: "Should nodes treat covenant outputs as spam?" };
  const id = run("2026-11-21-daily-covenants", { "ctv-activation": loaded });
  assert.equal(await publish(id, { commit: false, push: false }, chain), 0);
  assert.equal(existsSync(debateFile("ctv-activation")), false);
  assert.deepEqual(readWaitingDebates(), []);
  const log = runLog(id);
  assert.deepEqual(log.rejected, [
    {
      statement: "(debate ctv-activation: withheld, it touches a gated subject)",
      reason: "it breaks the debate rules: own voice",
    },
  ]);
  assert.ok(!JSON.stringify(log).includes("spam"), "the debate's words stay out of the log");
});

test("a debate whose claim waits for the evaluator waits too, and publishes with a later commit", async () => {
  reset([FACT, DEFINITION, LETTER_ARG], [OBJECTION_ARG]);
  const id = run("2026-11-21-daily-covenants", { "ctv-activation": DEBATE });
  assert.equal(await publish(id, { commit: false, push: false }, chain), 0);
  assert.equal(
    existsSync(debateFile("ctv-activation")),
    false,
    "never in knowledge/ while waiting",
  );
  const waiting = readWaitingDebates();
  assert.deepEqual(
    waiting.map((w) => [w.debate.slug, w.waiting, w.run]),
    [["ctv-activation", ["covenants.ctv-objection"], id]],
  );
  assert.ok(existsSync(path.join(REVIEW, "debates", "ctv-activation.yaml")));
  assert.deepEqual(runLog(id).open, [
    "debate ctv-activation waits for 1 of its claims to pass the evaluator",
  ]);
  assert.deepEqual(shown(), []);

  // A commit that publishes nothing it waits for leaves it waiting.
  const before = loadStore(KNOWLEDGE).store;
  assert.equal(
    commitStore(
      { store: before, claims: new Map(), writeClaims: [], extraFiles: [], message: "x" },
      LATER,
      { commit: false, push: false },
    ),
    0,
  );
  assert.equal(readWaitingDebates().length, 1);

  // The evaluator passes the objection: the commit that publishes it publishes the debate too.
  const { store } = loadStore(KNOWLEDGE);
  const claims = new Map(store.claims.map((c) => [c.id, c]));
  const passed = createClaim(OBJECTION_ARG, LATER, id, "quotes 1/1", review(["an argument"]));
  claims.set(passed.id, passed);
  removePending(passed.id);
  assert.equal(
    commitStore(
      {
        store: {
          ...store,
          claims: [...claims.values()],
          topics: publicTopics(store, claims, loadPolicy()),
          review: reviewCounts(readPending()),
        },
        claims,
        writeClaims: [passed],
        extraFiles: [],
        message: "Publish what the evaluator passed.",
      },
      LATER,
      { commit: false, push: false },
    ),
    0,
  );
  assert.deepEqual(parse(readFileSync(debateFile("ctv-activation"), "utf8")), DEBATE);
  assert.deepEqual(readWaitingDebates(), [], "the waiting file goes once it publishes");
  assert.deepEqual(
    shown().map((d) => d.slug),
    ["ctv-activation"],
  );
});

test("a waiting debate whose claim the evaluator rejects is dropped", async () => {
  reset([FACT, DEFINITION, LETTER_ARG], [OBJECTION_ARG]);
  const id = run("2026-11-21-daily-covenants", { "ctv-activation": DEBATE });
  assert.equal(await publish(id, { commit: false, push: false }, chain), 0);
  assert.equal(readWaitingDebates().length, 1);
  removePending("covenants.ctv-objection");
  const { store } = loadStore(KNOWLEDGE);
  assert.equal(
    commitStore(
      { store, claims: new Map(), writeClaims: [], extraFiles: [], message: "x" },
      LATER,
      { commit: false, push: false },
    ),
    0,
  );
  assert.deepEqual(readWaitingDebates(), []);
  assert.equal(existsSync(debateFile("ctv-activation")), false);
});

test("a withdrawn claim drops out of the map; a side left empty takes the map off the site", async () => {
  reset([FACT, DEFINITION, LETTER_ARG, OBJECTION_ARG]);
  const id = run("2026-11-21-daily-covenants", { "ctv-activation": DEBATE });
  assert.equal(await publish(id, { commit: false, push: false }, chain), 0);
  const file = readFileSync(debateFile("ctv-activation"), "utf8");

  const first = revokeAt("covenants.what-ctv-does", null, "Withdrawn in a test.", LATER, {
    commit: false,
    push: false,
  });
  assert.equal(first.code, 0, first.message);
  const [d] = shown();
  assert.ok(d, "the map still keeps every rule without the fact");
  assert.equal(d.nodes["covenants.what-ctv-does"], undefined);
  assert.deepEqual(d.empirical, []);
  assert.deepEqual(d.edges, []);

  const second = revokeAt("covenants.ctv-objection", null, "Withdrawn in a test.", LATER, {
    commit: false,
    push: false,
  });
  assert.equal(second.code, 0, second.message);
  assert.deepEqual(shown(), [], "the wait side has no argument left");
  assert.equal(readFileSync(debateFile("ctv-activation"), "utf8"), file, "the file is not edited");
});

test("a debate built on a test claim never publishes, nor waits", async () => {
  reset([FACT, DEFINITION, LETTER_ARG], [OBJECTION_ARG]);
  registerCanaries(
    [
      {
        id: "covenants.ctv-objection",
        kind: "stance",
        source: "covenants.ctv-letter",
        candidate: OBJECTION_ARG as never,
      },
    ],
    "2026-11-21-evaluate-test",
    NOW.time,
    EVAL,
  );
  const id = run("2026-11-21-daily-covenants", { "ctv-activation": DEBATE });
  assert.equal(await publish(id, { commit: false, push: false }, chain), 0);
  assert.equal(existsSync(debateFile("ctv-activation")), false);
  assert.deepEqual(readWaitingDebates(), []);
  assert.deepEqual(runLog(id).rejected, [
    {
      statement: "(debate ctv-activation: withheld, it touches a gated subject)",
      reason: "it is built on one of the evaluator's test claims",
    },
  ]);
  assert.ok(!readdirSync(KNOWLEDGE).includes("debates"));
});
