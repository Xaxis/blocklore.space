// The evaluator end to end, in temporary folders: a fake check and a fake verifier stand in for the
// network and the models; the store, the queue, the canary registry and the publisher are real.
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
import type { Claim, Topic } from "@blocklore/core";
import { candidateHash, DEFAULT_SETTINGS, type Settings } from "@blocklore/core/control";
import { parse, stringify } from "yaml";

const ROOT = mkdtempSync(path.join(tmpdir(), "bl-evaluator-"));
const KNOWLEDGE = path.join(ROOT, "knowledge");
const REVIEW = path.join(ROOT, "review");
const EVAL = path.join(ROOT, "evaluator");
process.env.BLOCKLORE_KNOWLEDGE = KNOWLEDGE;
process.env.BLOCKLORE_REVIEW_DIR = REVIEW;
process.env.BLOCKLORE_EVALUATOR_DIR = EVAL;
process.env.BLOCKLORE_AGENT_ROOT = path.join(ROOT, "agent");
process.env.BLOCKLORE_CONTROL_DIR = path.join(ROOT, "control");

const { compile, claimHash } = await import("@blocklore/core");
const { loadStore } = await import("@blocklore/core/node");
const ev = await import("../src/evaluator.ts");
const { canaryClash, canaryEntries } = await import("../src/canary.ts");
const { commitStore, publish } = await import("../src/publish.ts");
const { approveAt } = await import("../src/review.ts");
const { revokeAt } = await import("../src/revoke.ts");
const { afterJob } = await import("../src/daemon.ts");
const { controlStore } = await import("../src/control.ts");
const { readPending } = await import("../src/store.ts");
const { feedEvents: readFeed } = await import("../src/feed.ts");

const T0 = { time: "2026-11-20T12:00:00Z", height: 976700 };
const NOW = { time: "2026-11-21T12:00:00Z", height: 977000 };
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const pub = (id: string, statement: string, quote: string): Claim => ({
  id,
  statement,
  kind: "fact",
  topics: [id.split(".")[0] as string],
  depth: "user",
  status: "established",
  confidence: "high",
  people: [],
  sources: [
    {
      tier: "T1",
      kind: "bip",
      title: `${id} source`,
      url: `https://github.com/bitcoin/bips/blob/${COMMIT}/bip-0${id.length}.mediawiki`,
      locator: "Specification",
      quote,
      accessed: "2026-11-20",
      supports: "direct",
    },
  ],
  first_seen: T0,
  last_verified: { ...T0, run: "2026-11-20-seed-x", method: "quotes 1/1" },
  run: "2026-11-20-seed-x",
  revisions: [{ rev: 1, at: T0, run: "2026-11-20-seed-x", change: "created" }],
});

const PUBLISHED = [
  pub(
    "taproot.activation",
    "Taproot's consensus rules have been enforced on mainnet since block 709,632 under BIP 341, mined on 14 November 2021.",
    "min_activation_height = 709632",
  ),
  pub(
    "taproot.key-path",
    "BIP 341 lets a Taproot output be spent with one Schnorr signature, and nodes may typically accept about 2 spending paths for it.",
    "a key path spend",
  ),
  pub(
    "segwit.weight",
    "SegWit counts witness data at one quarter weight, so a block may typically hold about 2,000 transactions under BIP 141.",
    "witness data at one quarter weight",
  ),
  pub(
    "segwit.bech32",
    "BIP 173 defines Bech32 addresses for SegWit version 0 outputs, which can detect any error affecting at most 4 characters.",
    "guarantees detection of any error affecting at most 4 characters",
  ),
];

const topic = (slug: string, claims: string[]): Topic => ({
  slug,
  title: slug[0]?.toUpperCase() + slug.slice(1),
  lede: claims[0] as string,
  contested: slug === "covenants",
  safety: false,
  group: "protocol",
  sections: [{ id: "basics", title: "Basics", depth: "curious", claims }],
});

const SOURCE_URL = "https://gnusha.org/pi/bitcoindev/letter-1/";
const GATED = [
  {
    id: "covenants.ctv-letter",
    statement:
      "James O'Beirne argued on the bitcoindev mailing list on 9 June 2025 that the benefits of activating CTV outweigh its review cost.",
    kind: "argument",
    topics: ["covenants"],
    depth: "builder",
    status: "contested",
    confidence: "medium",
    people: ["James O'Beirne"],
    attributed_to: [{ name: "James O'Beirne", url: SOURCE_URL }],
    related: ["covenants.what-ctv-does"],
    sources: [
      {
        tier: "T1",
        kind: "mailing-list",
        title: "CTV and CSFS letter",
        url: SOURCE_URL,
        locator: "the letter",
        quote: "we believe the benefits outweigh the cost",
        published: "2025-06-09",
        accessed: "2026-11-20",
        supports: "direct",
      },
    ],
  },
  {
    id: "covenants.what-ctv-does",
    statement:
      "BIP 119 specifies OP_CHECKTEMPLATEVERIFY, an opcode that commits to the exact outputs of the transaction that spends it.",
    kind: "fact",
    topics: ["covenants"],
    depth: "builder",
    status: "established",
    confidence: "high",
    people: [],
    related: ["covenants.ctv-letter"],
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
  },
];

function reset() {
  rmSync(ROOT, { recursive: true, force: true });
  for (const c of PUBLISHED) {
    const dir = path.join(KNOWLEDGE, "claims", c.topics[0] as string);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${c.id}.yaml`), stringify(c));
  }
  mkdirSync(path.join(KNOWLEDGE, "topics"), { recursive: true });
  for (const t of [
    topic("taproot", ["taproot.activation", "taproot.key-path"]),
    topic("segwit", ["segwit.weight", "segwit.bech32"]),
  ])
    writeFileSync(path.join(KNOWLEDGE, "topics", `${t.slug}.yaml`), stringify(t));
  mkdirSync(path.join(REVIEW, "claims"), { recursive: true });
  mkdirSync(path.join(REVIEW, "layouts"), { recursive: true });
  for (const g of GATED)
    writeFileSync(
      path.join(REVIEW, "claims", `${g.id}.yaml`),
      stringify({
        candidate: g,
        reasons: ["contested topic: covenants"],
        run: "2026-11-20-daily-covenants",
        proposed: T0,
        verdict: { id: g.id, verdict: "accept", reason: "the research run's verifier accepted it" },
        method: "quotes 1/1",
        updates: false,
      }),
    );
  writeFileSync(
    path.join(REVIEW, "layouts", "covenants.yaml"),
    stringify(
      topic(
        "covenants",
        GATED.map((g) => g.id),
      ),
    ),
  );
}

const settings = (over: Partial<Settings["evaluator"]> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  evaluator: { ...DEFAULT_SETTINGS.evaluator, ...over },
});

const okReport = (id: string) => ({
  id,
  ok: true,
  issues: [],
  sources: [],
  checks: [],
  method: "quotes 1/1",
});

/** A verifier that writes a verdict per candidate, as `decide(id)` says. */
function fakeVerifier(
  decide: (id: string, model: string) => "accept" | "revise" | "reject" | null,
) {
  const seen: Array<{ dir: string; model: string; ids: string[] }> = [];
  const verify = async (dir: string, _task: string, model: string) => {
    const ids = readdirSync(path.join(dir, "claims")).map((f) => f.replace(/\.yaml$/, ""));
    seen.push({ dir, model, ids });
    for (const id of ids) {
      const v = decide(id, model);
      if (v)
        writeFileSync(
          path.join(dir, "verdicts", `${id}.yaml`),
          stringify({ id, verdict: v, reason: `${model} says ${v}` }),
        );
    }
    return undefined;
  };
  return { verify, seen };
}

const isCanary = (id: string) => canaryEntries(EVAL).some((c) => c.id === id);

function deps(
  verify: ReturnType<typeof fakeVerifier>["verify"],
  opts: { s?: Settings; ready?: boolean; check?: (id: string) => ReturnType<typeof okReport> } = {},
) {
  return {
    files: ev.evaluatorFiles(EVAL),
    settings: () => opts.s ?? settings(),
    now: async () => NOW,
    check: async (c: { id: string }) => (opts.check ?? okReport)(c.id),
    verify,
    modelReady: () => opts.ready ?? true,
    store: () => loadStore(KNOWLEDGE).store,
    pending: readPending,
  };
}

const knowledgeIds = () =>
  readdirSync(path.join(KNOWLEDGE, "claims"), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => path.basename(f, ".yaml"));

test("a passing batch publishes, with the evaluator's review record, and the canaries never do", async () => {
  reset();
  const v = fakeVerifier((id) => (isCanary(id) ? "reject" : "accept"));
  const r = await ev.evaluateBatch(deps(v.verify));
  assert.ok(r.batch, r.message);
  const canaries = r.decisions.filter((d) => d.canary);
  assert.ok(canaries.length >= 5, "a calibrating evaluator mixes in enough canaries");
  // Both verifiers saw the same candidates, canaries mixed in, in separate folders, on two models.
  assert.equal(v.seen.length, 2);
  assert.notEqual(v.seen[0]?.dir, v.seen[1]?.dir);
  assert.deepEqual(
    v.seen.map((s) => s.model),
    ["opus", "sonnet"],
  );
  assert.deepEqual(v.seen[0]?.ids, v.seen[1]?.ids);
  assert.ok(v.seen[0]?.ids.some(isCanary) && v.seen[0]?.ids.some((id) => !isCanary(id)));
  // Nothing in a verifier's folder marks a canary.
  for (const id of v.seen[0]?.ids ?? []) {
    const text = readFileSync(path.join(v.seen[0]?.dir as string, "claims", `${id}.yaml`), "utf8");
    assert.ok(!/canary|test claim|mutat/i.test(text), `${id} carries no marker`);
  }
  assert.ok(canaries.every((d) => d.outcome === "reject" && d.why.startsWith("caught")));
  const real = r.decisions.filter((d) => !d.canary);
  assert.deepEqual(
    real.map((d) => d.outcome),
    ["publish", "publish"],
  );

  const applied = ev.applyBatch(
    r.batch,
    NOW,
    { commit: false, push: false },
    settings(),
    ev.evaluatorFiles(EVAL),
  );
  assert.equal(applied.code, 0, applied.message);
  assert.deepEqual(applied.published.sort(), GATED.map((g) => g.id).sort());
  const { store, issues } = loadStore(KNOWLEDGE);
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
  );
  const c = store.claims.find((x) => x.id === "covenants.ctv-letter") as Claim;
  assert.equal(c.review?.by, "evaluator");
  assert.deepEqual(c.review?.by === "evaluator" && c.review.models, ["opus", "sonnet"]);
  assert.ok(c.review?.by === "evaluator" && c.review.checks.length >= 4);
  assert.equal(readPending().length, 0, "published claims leave the queue");
  // No canary reached knowledge/, by id or by statement.
  for (const id of canaries.map((d) => d.id)) assert.ok(!knowledgeIds().includes(id), id);
  assert.deepEqual(canaryClash(store.claims, EVAL), []);
  // The public record and the run log.
  const record = JSON.parse(readFileSync(path.join(KNOWLEDGE, "evaluator.json"), "utf8"));
  assert.equal(record.canaries.caught, canaries.length);
  assert.equal(record.days[0].published, 2);
  assert.ok(existsSync(path.join(KNOWLEDGE, "runs", "2026", `${r.batch}.yaml`)));
  const log = parse(readFileSync(path.join(KNOWLEDGE, "runs", "2026", `${r.batch}.yaml`), "utf8"));
  assert.ok(
    !JSON.stringify(log).includes(canaries[0]?.statement ?? "x"),
    "no canary text in the log",
  );
  // Readers see the published ids, nothing unpublished.
  const feed = readFeed(new Date(NOW.time));
  const pub = feed.find((e) => e.kind === "publish");
  assert.deepEqual(pub?.claims?.sort(), GATED.map((g) => g.id).sort());
  assert.equal(pub?.n, 2);
  for (const c of canaries)
    assert.ok(!JSON.stringify(feed).includes(c.id), "no test claim in the feed");
  // And the store still compiles with them.
  assert.deepEqual(
    compile(store, NOW).issues.filter((i) => i.level === "error"),
    [],
  );
});

test("a canary the verifiers miss never publishes, and holds its whole batch", async () => {
  reset();
  const v = fakeVerifier(() => "accept");
  const r = await ev.evaluateBatch(deps(v.verify));
  assert.ok(r.batch);
  const canaries = r.decisions.filter((d) => d.canary);
  assert.ok(canaries.length > 0);
  assert.ok(
    canaries.every(
      (d) => d.raw === "publish" && d.outcome === "hold" && d.why.startsWith("missed"),
    ),
  );
  assert.ok(r.decisions.filter((d) => !d.canary).every((d) => d.outcome === "hold"));
  const batch = ev.evaluatorFiles(EVAL).readBatch(r.batch);
  assert.ok(
    batch.items.every((i) => !isCanary(i.id)),
    "the batch file holds real claims only",
  );
  const applied = ev.applyBatch(
    r.batch,
    NOW,
    { commit: false, push: false },
    settings(),
    ev.evaluatorFiles(EVAL),
  );
  assert.equal(applied.code, 0);
  assert.deepEqual(applied.published, []);
  assert.equal(readPending().length, 2, "held claims keep waiting");
  for (const d of canaries) assert.ok(!knowledgeIds().includes(d.id));
  const record = JSON.parse(readFileSync(path.join(KNOWLEDGE, "evaluator.json"), "utf8"));
  assert.equal(record.canaries.caught, 0);
  assert.ok(record.paused);
});

test("the publisher refuses a canary on every path: a research run, a commit, an approval", async () => {
  reset();
  const v = fakeVerifier((id) => (isCanary(id) ? "reject" : "accept"));
  const r = await ev.evaluateBatch(deps(v.verify));
  const canary = r.decisions.find((d) => d.canary) as (typeof r.decisions)[number];
  const folder = v.seen[0]?.dir as string;
  const candidate = parse(readFileSync(path.join(folder, "claims", `${canary.id}.yaml`), "utf8"));

  // 1. A research run that somehow proposes the canary, with an accepting verdict.
  const run = "2026-11-21-daily-taproot";
  const dir = path.join(ROOT, "agent", "staging", run);
  mkdirSync(path.join(dir, "claims"), { recursive: true });
  mkdirSync(path.join(dir, "verdicts"), { recursive: true });
  writeFileSync(path.join(dir, "claims", `${canary.id}.yaml`), stringify(candidate));
  writeFileSync(
    path.join(dir, "verdicts", `${canary.id}.yaml`),
    stringify({ id: canary.id, verdict: "accept", reason: "looks right" }),
  );
  const chain = { name: "fake", tipHeight: async () => NOW.height } as never;
  assert.equal(await publish(run, { commit: false, push: false }, chain), 0);
  assert.ok(!knowledgeIds().includes(canary.id), "publish rejected it before any check");
  const log = parse(readFileSync(path.join(KNOWLEDGE, "runs", "2026", `${run}.yaml`), "utf8"));
  assert.ok(log.rejected.some((x: { reason: string }) => x.reason.includes("test claims")));
  // An evaluation batch's folder is never a research run.
  assert.equal(await publish(path.basename(folder), { commit: false, push: false }, chain), 1);

  // 2. A commit that carries it, under another id with the same statement: nothing is written.
  const { store } = loadStore(KNOWLEDGE);
  const forged: Claim = {
    ...(store.claims[0] as Claim),
    id: "taproot.renamed",
    statement: canary.statement,
  };
  const code = commitStore(
    {
      store: { ...store, claims: [...store.claims, forged] },
      claims: new Map(),
      writeClaims: [forged],
      extraFiles: [],
      message: "x",
    },
    NOW,
    { commit: false, push: false },
  );
  assert.equal(code, 1);
  assert.ok(!knowledgeIds().includes("taproot.renamed"));

  // 3. The canary copied into the queue and approved by hand.
  writeFileSync(
    path.join(REVIEW, "claims", `${canary.id}.yaml`),
    stringify({
      candidate,
      reasons: ["contested topic: x"],
      run: "2026-11-20-daily-x",
      proposed: T0,
      verdict: { id: canary.id, verdict: "accept", reason: "the owner read it" },
      method: "m",
      updates: false,
    }),
  );
  assert.equal(approveAt([{ id: canary.id }], undefined, NOW, { commit: false, push: false }), 1);
  assert.ok(!knowledgeIds().includes(canary.id));
});

test("any failing check keeps a claim out: recheck, rules, either verifier", async () => {
  // A quote no longer found rejects; an unreadable page holds.
  reset();
  let v = fakeVerifier((id) => (isCanary(id) ? "reject" : "accept"));
  let r = await ev.evaluateBatch(
    deps(v.verify, {
      check: (id) =>
        id === "covenants.ctv-letter"
          ? {
              ...okReport(id),
              ok: false,
              sources: [
                {
                  index: 0,
                  ok: false,
                  quoteFound: false,
                  injections: [],
                  error: "quote not found at the locator",
                },
              ] as never,
            }
          : id === "covenants.what-ctv-does"
            ? {
                ...okReport(id),
                ok: false,
                sources: [
                  { index: 0, ok: false, quoteFound: false, injections: [], error: "HTTP 503" },
                ] as never,
              }
            : okReport(id),
    }),
  );
  const out = (id: string) => r.decisions.find((d) => d.id === id)?.outcome;
  assert.equal(out("covenants.ctv-letter"), "reject");
  assert.equal(out("covenants.what-ctv-does"), "hold");
  assert.ok(
    !v.seen.some((s) => s.ids.includes("covenants.ctv-letter")),
    "code failures never reach a model",
  );

  // A broken structural rule rejects: the argument loses its link.
  reset();
  const file = path.join(REVIEW, "claims", "covenants.ctv-letter.yaml");
  const p = parse(readFileSync(file, "utf8"));
  p.candidate.attributed_to = [{ name: "James O'Beirne" }];
  writeFileSync(file, stringify(p));
  v = fakeVerifier((id) => (isCanary(id) ? "reject" : "accept"));
  r = await ev.evaluateBatch(deps(v.verify));
  const d = r.decisions.find((x) => x.id === "covenants.ctv-letter");
  assert.equal(d?.outcome, "reject");
  assert.match(d?.why ?? "", /rules: attributed with a link/);

  // One verifier revising is enough to keep it out; a missing verdict holds.
  reset();
  v = fakeVerifier((id, model) =>
    isCanary(id)
      ? "reject"
      : model === "sonnet" && id === "covenants.ctv-letter"
        ? "revise"
        : model === "sonnet"
          ? null
          : "accept",
  );
  r = await ev.evaluateBatch(deps(v.verify));
  assert.equal(out("covenants.ctv-letter"), "reject");
  assert.equal(out("covenants.what-ctv-does"), "hold");
  assert.match(
    r.decisions.find((x) => x.id === "covenants.ctv-letter")?.why ?? "",
    /verifier-b: revise/,
  );

  // A verifier that cannot run holds everything it would have seen.
  reset();
  r = await ev.evaluateBatch(
    deps(async () => {
      throw new Error("budget: 0 left");
    }),
  );
  assert.ok(r.decisions.every((x) => x.outcome === "hold"));
  assert.match(r.decisions[0]?.why ?? "", /could not run: budget/);
});

test("without the subscription token, or with the owner deciding, nothing is evaluated", async () => {
  reset();
  const v = fakeVerifier(() => "accept");
  const waiting = await ev.evaluateBatch(deps(v.verify, { ready: false }));
  assert.equal(waiting.batch, null);
  assert.match(waiting.message, /waiting for the subscription token/);
  const owner = await ev.evaluateBatch(deps(v.verify, { s: settings({ decides: "owner" }) }));
  assert.equal(owner.batch, null);
  assert.equal(v.seen.length, 0);
  assert.equal(canaryEntries(EVAL).length, 0);
  const view = ev.evaluatorView(settings(), NOW.time, ev.evaluatorFiles(EVAL), false);
  assert.equal(view.state, "waiting");
  assert.equal(view.backlog, 2);
  assert.equal(
    ev.evaluatorView(settings({ decides: "owner" }), NOW.time, ev.evaluatorFiles(EVAL), true).state,
    "owner",
  );
});

test("hold for the owner: approve publishes by hand with the owner's review record", () => {
  reset();
  const item = readPending().find((p) => p.candidate.id === "covenants.what-ctv-does");
  assert.ok(item);
  const code = approveAt(
    [{ id: item.candidate.id, hash: candidateHash(item.candidate) }],
    "fine",
    NOW,
    {
      commit: false,
      push: false,
    },
  );
  assert.equal(code, 0);
  const c = loadStore(KNOWLEDGE).store.claims.find((x) => x.id === "covenants.what-ctv-does");
  assert.deepEqual(c?.review, {
    by: "owner",
    reasons: ["contested topic: covenants"],
    at: NOW.time,
    note: "fine",
  });
  assert.equal(readPending().length, 1);
});

test("revoking appends a withdrawn revision, hides the claim, and teaches research", () => {
  reset();
  const { store } = loadStore(KNOWLEDGE);
  const old = store.claims.find((c) => c.id === "taproot.key-path") as Claim;
  assert.equal(
    revokeAt(old.id, "0".repeat(64), "wrong", NOW, { commit: false, push: false }).code,
    1,
    "a stale hash withdraws nothing",
  );
  const r = revokeAt(
    old.id,
    claimHash(old),
    `It overstates what nodes accept ${String.fromCharCode(0x2014)} two paths is wrong.`,
    NOW,
    {
      commit: false,
      push: false,
    },
  );
  assert.equal(r.code, 0, r.message);
  const after = loadStore(KNOWLEDGE);
  assert.deepEqual(
    after.issues.filter((i) => i.level === "error"),
    [],
  );
  const c = after.store.claims.find((x) => x.id === old.id) as Claim;
  assert.equal(c.status, "withdrawn");
  assert.equal(c.statement, old.statement, "nothing else is edited");
  assert.deepEqual(c.revisions.slice(0, 1), old.revisions);
  const rev = c.revisions[1];
  assert.equal(rev?.change, "withdrawn");
  assert.deepEqual(rev?.before, { status: "established" });
  assert.match(
    rev?.note ?? "",
    /^Withdrawn by the owner: It overstates what nodes accept, two paths is wrong\.$/,
  );
  // Hidden from its topic, kept on its own page.
  const t = after.store.topics.find((x) => x.slug === "taproot") as Topic;
  assert.ok(!t.sections.some((s) => s.claims.includes(old.id)));
  const { bundle } = compile(after.store, NOW);
  assert.equal(bundle.claims[old.id], undefined);
  assert.ok(bundle.withdrawn[old.id]?.withdrawal);
  // A canary case for the evaluator, a lesson for research, and no second withdrawal.
  assert.equal(ev.evaluatorFiles(EVAL).cases()[0]?.claim.statement, old.statement);
  const control = controlStore(path.join(ROOT, "control"));
  const msg = afterJob(
    control,
    { type: "claim.revoke", id: old.id, hash: claimHash(old), reason: "overstated" },
    NOW.time,
  );
  assert.match(msg, /lesson/);
  assert.equal(control.settings().lessons[0]?.from, "revoke");
  assert.equal(revokeAt(old.id, null, "again", NOW, { commit: false, push: false }).code, 1);
});
