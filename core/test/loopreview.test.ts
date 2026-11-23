import assert from "node:assert/strict";
import { test } from "node:test";
import { Command, DEFAULT_SETTINGS, LoopReviewView, type Settings } from "../src/control.ts";
import { RULE_TEXT } from "../src/evaluate.ts";
import {
  compileLoopReview,
  type DecisionLine,
  type Finding,
  findingText,
  type LoopReviewInput,
  proposalDone,
  quoteFailures,
  type RunLine,
  ruleLesson,
  type SessionLine,
  weekOf,
} from "../src/loopreview.ts";
import { hasDash } from "../src/style.ts";

// Hand-built weeks: the week of Monday 2026-11-16, compiled as the weekly tick does, just after it
// ended, unless a test says otherwise.
const WEEK = "2026-11-16";
const AT = "2026-11-23T05:10:00Z";
const AGENDA = [
  { slug: "segwit", title: "Segregated Witness (SegWit)" },
  { slug: "taproot", title: "Taproot" },
];

const research = (
  id: string,
  start: string,
  end: string,
  over: Partial<RunLine> = {},
): RunLine => ({
  id,
  kind: "daily",
  started: { time: start },
  finished: { time: end },
  published: ["x.one", "x.two"],
  revised: [],
  rejected: [{ statement: "s", reason: "the verifier said no" }],
  gated: [{ topic: "segwit", count: 1, reasons: ["contested"] }],
  ...over,
});

const evaluatorSession = (id: string, start: string): SessionLine => ({
  id,
  kind: "evaluate",
  topic: "the evaluator",
  started: start,
  finished: start.replace(
    /T(\d\d)/,
    (_m, h: string) => `T${String(Number(h) + 1).padStart(2, "0")}`,
  ),
  status: "done",
  published: 1,
  gated: 0,
  rejected: 3,
});

const decision = (over: Partial<DecisionLine> & { id: string; at: string }): DecisionLine => ({
  batch: "2026-11-21-evaluate-aaaa",
  topic: over.id.split(".")[0] as string,
  canary: null,
  stages: [{ stage: "recheck", ok: true, detail: "found again: quotes 1/1" }],
  raw: "publish",
  outcome: "publish",
  ...over,
});

const ruleFail = (id: string, at: string, detail: string): DecisionLine =>
  decision({
    id,
    at,
    raw: "reject",
    outcome: "reject",
    stages: [
      { stage: "recheck", ok: true, detail: "found again" },
      { stage: "rules", ok: false, detail },
    ],
  });

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  research: { ...DEFAULT_SETTINGS.research, mode: "continuous" },
  ...over,
});

/** A quiet week: research every day on both topics, the evaluator keeping up, nothing waiting. */
function quiet(over: Partial<LoopReviewInput> = {}): LoopReviewInput {
  const runs: RunLine[] = [];
  for (let d = 16; d <= 22; d++)
    for (const [n, slug] of ["segwit", "taproot"].entries())
      runs.push(
        research(
          `2026-11-${d}-daily-${slug}`,
          `2026-11-${d}T0${6 + n * 2}:00:00Z`,
          `2026-11-${d}T0${7 + n * 2}:00:00Z`,
        ),
      );
  return {
    week: WEEK,
    at: AT,
    sessions: [],
    runs,
    decisions: [
      decision({ id: "segwit.a", at: "2026-11-18T10:00:00Z" }),
      decision({
        id: "taproot.canary",
        at: "2026-11-18T10:00:00Z",
        canary: { kind: "number", source: "taproot.b" },
        raw: "reject",
        outcome: "reject",
      }),
    ],
    rechecks: {},
    reports: [],
    agenda: AGENDA,
    gaps: [
      { slug: "segwit", score: 4 },
      { slug: "taproot", score: 9 },
    ],
    pending: [
      { id: "segwit.waits", topic: "segwit", proposed: "2026-11-22T10:00:00Z", sources: [] },
    ],
    claims: [],
    subscription: true,
    settings: settings(),
    ...over,
  };
}

const codes = (fs: Finding[]) => fs.map((f) => f.code);
const find = (fs: Finding[], code: Finding["code"]) => fs.find((f) => f.code === code);

test("a quiet week yields its counts and no finding", () => {
  const r = compileLoopReview(quiet());
  assert.deepEqual(r.findings, []);
  assert.equal(r.week, WEEK);
  assert.equal(r.from, "2026-11-16T00:00:00Z");
  assert.equal(r.to, "2026-11-23T00:00:00Z");
  assert.equal(r.asOf, "2026-11-23T00:00:00Z", "a finished week counts to its end");
  assert.deepEqual(r.research, {
    sessions: 14,
    failed: 0,
    last: "2026-11-22T09:00:00Z",
    daysSince: 0.6,
  });
  assert.deepEqual(r.evaluator, {
    sessions: 0,
    published: 1,
    rejected: 0,
    held: 0,
    caught: 1,
    missed: 0,
  });
  // 14 runs, each 2 published, 1 rejected, 1 held: 4 drafted; and the evaluator's one publish.
  assert.deepEqual(
    { ...r.claims, topics: r.claims.topics.length },
    { drafted: 56, published: 29, rejected: 14, held: 14, topics: 2 },
  );
  assert.deepEqual(r.queue, { waiting: 1, oldestDays: 0.6 });
  assert.deepEqual(r.agenda, { topics: 2, stale: 0 });
  assert.doesNotThrow(() => LoopReviewView.parse(r));
});

test("no research for three days while the evaluator took every session is the first finding", () => {
  const input = quiet({
    // Research stopped on the 20th; the evaluator ran four times after.
    runs: [
      research("2026-11-19-daily-segwit", "2026-11-19T22:00:00Z", "2026-11-19T23:00:00Z"),
      research("2026-11-20-daily-taproot", "2026-11-19T23:30:00Z", "2026-11-20T00:00:00Z"),
    ],
    sessions: [
      evaluatorSession("2026-11-21-evaluate-aaaa", "2026-11-21T10:00:00Z"),
      evaluatorSession("2026-11-21-evaluate-bbbb", "2026-11-21T12:00:00Z"),
      evaluatorSession("2026-11-22-evaluate-cccc", "2026-11-22T10:00:00Z"),
      evaluatorSession("2026-11-22-evaluate-dddd", "2026-11-22T12:00:00Z"),
    ],
  });
  const r = compileLoopReview(input);
  const f = r.findings[0] as Finding;
  assert.equal(f.code, "research.starved");
  assert.equal(f.subject, "evaluator-took-the-slots");
  assert.deepEqual(f.numbers, { days: 3, sessions: 2, evaluator: 4 });
  assert.deepEqual(f.evidence.slice(0, 2), [
    { kind: "session", id: "2026-11-20-daily-taproot" },
    { kind: "batch", id: "2026-11-21-evaluate-aaaa" },
  ]);
  assert.deepEqual(f.proposal?.command, { type: "research.start", topic: null });
  assert.equal(r.research.daysSince, 3);
  assert.equal(r.evaluator.sessions, 4);
  assert.match(findingText(f), /^No research session for 3 days\. 2 research sessions this week/);
  assert.match(findingText(f), /Every session since went to the evaluator\./);

  // Mid-week, the same records counted to the moment of compiling: 3.5 days.
  const mid = compileLoopReview({ ...input, week: "2026-11-16", at: "2026-11-22T12:00:00Z" });
  assert.equal(mid.asOf, "2026-11-22T12:00:00Z");
  assert.equal(find(mid.findings, "research.starved")?.numbers.days, 2.5);
});

test("the cause of a research gap picks the proposal: paused, every topic in review, research off", () => {
  const gap = {
    runs: [research("2026-11-18-daily-segwit", "2026-11-18T06:00:00Z", "2026-11-18T07:00:00Z")],
  };
  const paused = compileLoopReview(quiet({ ...gap, settings: settings({ paused: true }) }));
  const p = find(paused.findings, "research.starved");
  assert.equal(p?.subject, "paused");
  assert.deepEqual(p?.proposal?.command, { type: "settings", patch: { paused: false } });

  const waits = compileLoopReview(
    quiet({
      ...gap,
      pending: AGENDA.map((t) => ({
        id: `${t.slug}.waits`,
        topic: t.slug,
        proposed: "2026-11-22T10:00:00Z",
        sources: [],
      })),
    }),
  );
  const w = find(waits.findings, "research.starved");
  assert.equal(w?.subject, "every-topic-waits");
  assert.deepEqual(w?.proposal?.command, {
    type: "settings",
    patch: { research: { skipPending: false } },
  });

  const off = compileLoopReview(
    quiet({ ...gap, settings: settings({ research: { ...DEFAULT_SETTINGS.research } }) }),
  );
  assert.equal(find(off.findings, "research.starved")?.subject, "research-off");

  const token = compileLoopReview(quiet({ ...gap, subscription: false }));
  const t = find(token.findings, "research.starved");
  assert.equal(t?.subject, "no-subscription");
  assert.equal(t?.proposal, null, "connecting the token takes the form on Research: no button");
  assert.match(findingText(t as Finding), /no Claude subscription token/);

  const never = compileLoopReview(quiet({ runs: [] }));
  const n = find(never.findings, "research.starved");
  assert.deepEqual(n?.numbers, { never: 1, sessions: 0, evaluator: 0 });
  assert.match(findingText(n as Finding), /^No research session has run\./);
});

test("a rule broken three times proposes its own description as a lesson, unless it is kept", () => {
  const detail =
    "person attributed: Murch: not attributed with a link to where they said or did it";
  const decisions = [
    ruleFail("segwit.one", "2026-11-17T10:00:00Z", detail),
    ruleFail(
      "segwit.two",
      "2026-11-18T10:00:00Z",
      `not settled: a argument is contested; ${detail}`,
    ),
    ruleFail("taproot.three", "2026-11-19T10:00:00Z", detail),
    ruleFail("taproot.four", "2026-11-19T11:00:00Z", "not settled: a argument is contested"),
    // A canary breaking it, and a decision last week, count for nothing.
    {
      ...ruleFail("taproot.c", "2026-11-19T10:00:00Z", detail),
      canary: { kind: "name", source: "taproot.x" },
    },
    ruleFail("taproot.old", "2026-11-15T23:59:59Z", detail),
  ] as DecisionLine[];
  const r = compileLoopReview(quiet({ decisions }));
  assert.deepEqual(
    r.rules.map((x) => [x.rule, x.count]),
    [
      ["person attributed", 3],
      ["not settled", 2],
    ],
  );
  assert.deepEqual(codes(r.findings), ["rule.broken"]);
  const f = r.findings[0] as Finding;
  assert.equal(f.subject, "person attributed");
  assert.deepEqual(f.numbers, { claims: 3, kept: 0 });
  assert.deepEqual(
    f.evidence.map((e) => e.id),
    ["taproot.three", "segwit.two", "segwit.one"],
  );
  const text = ruleLesson("person attributed");
  assert.equal(
    text,
    `The evaluator rejects every gated claim that breaks its rule "person attributed": ${RULE_TEXT["person attributed"]}.`,
  );
  assert.deepEqual(f.proposal?.command, { type: "lesson.add", text });
  assert.ok(
    Command.safeParse(f.proposal?.command).success,
    "the lesson is a command the brain takes",
  );
  assert.ok(!text.includes("Murch"), "the lesson is the rule's words, not a claim's");

  const kept = compileLoopReview(
    quiet({
      decisions,
      settings: settings({
        lessons: [{ id: "aaaaaaaa", text, at: "2026-11-20T00:00:00Z", from: "owner" }],
      }),
    }),
  );
  const k = kept.findings[0] as Finding;
  assert.equal(k.proposal, null);
  assert.equal(k.numbers.kept, 1);
  assert.match(findingText(k), /already a standing lesson/);
});

test("a canary let through proposes more test claims a batch, up to ten", () => {
  const slipped = decision({
    id: "taproot.canary2",
    at: "2026-11-19T10:00:00Z",
    canary: { kind: "hedge", source: "taproot.b" },
  });
  const r = compileLoopReview(quiet({ decisions: [...quiet().decisions, slipped] }));
  const f = find(r.findings, "evaluator.canary-missed");
  assert.deepEqual(f?.numbers, { missed: 1, caught: 1 });
  assert.deepEqual(f?.evidence, [{ kind: "decision", id: "taproot.canary2" }]);
  assert.deepEqual(f?.proposal?.command, {
    type: "settings",
    patch: { evaluator: { canaries: 4 } },
  });
  assert.equal(r.evaluator.missed, 1);
  const top = compileLoopReview(
    quiet({
      decisions: [slipped],
      settings: settings({ evaluator: { ...DEFAULT_SETTINGS.evaluator, canaries: 10 } }),
    }),
  );
  assert.equal(find(top.findings, "evaluator.canary-missed")?.proposal, null);
});

test("a long wait in the review queue proposes a batch while the evaluator decides", () => {
  const pending = [
    { id: "segwit.old", topic: "segwit", proposed: "2026-11-18T12:00:00Z", sources: [] },
    { id: "segwit.older", topic: "segwit", proposed: "2026-11-17T12:00:00Z", sources: [] },
    { id: "taproot.new", topic: "taproot", proposed: "2026-11-22T12:00:00Z", sources: [] },
  ];
  const r = compileLoopReview(quiet({ pending }));
  const f = find(r.findings, "queue.waiting");
  assert.deepEqual(f?.numbers, { days: 5.5, waiting: 3, older: 2 });
  assert.deepEqual(
    f?.evidence.map((e) => e.id),
    ["segwit.older", "segwit.old", "taproot.new"],
  );
  assert.deepEqual(f?.proposal?.command, { type: "evaluator.run" });
  const owner = compileLoopReview(
    quiet({
      pending,
      settings: settings({ evaluator: { ...DEFAULT_SETTINGS.evaluator, decides: "owner" } }),
    }),
  );
  assert.equal(
    find(owner.findings, "queue.waiting")?.proposal,
    null,
    "the owner decides: no button",
  );
});

test("failed rechecks count once per run that read the claim, and a source failing twice is named", () => {
  const url = "https://example.org/moved";
  const reverify = (day: number, open: string[], read: string[]): RunLine => ({
    id: `2026-11-${day}-reverify`,
    kind: "reverify",
    started: { time: `2026-11-${day}T04:20:00Z` },
    finished: { time: `2026-11-${day}T04:21:00Z` },
    published: [],
    revised: [],
    rejected: [],
    gated: [],
    open,
    read: read.map((id) => ({ url: "https://example.org/x", why: `recheck of ${id}` })),
  });
  const r = compileLoopReview(
    quiet({
      runs: [
        ...quiet().runs,
        reverify(17, ["segwit.a: source 2: quote not found"], ["segwit.a"]),
        // Still listed as open on the 18th, but not read again: no second failure.
        reverify(18, ["segwit.a: source 2: quote not found"], ["segwit.b"]),
        reverify(
          19,
          ["taproot.c: source 1: quote not found at the locator; check 1 (chain.subsidy): no"],
          ["taproot.c"],
        ),
      ],
      rechecks: {
        "taproot.c": {
          at: { time: "2026-11-19T04:20:00Z", height: 1 },
          problems: ["source 1: quote not found at the locator"],
        },
      },
      claims: [
        {
          id: "segwit.a",
          topic: "segwit",
          sources: ["https://example.org/a", url],
          revisions: [{ at: "2026-11-20T00:00:00Z", change: "corrected" }],
        },
        {
          id: "taproot.c",
          topic: "taproot",
          sources: [url],
          revisions: [{ at: "2026-11-01T00:00:00Z", change: "created" }],
        },
      ],
    }),
  );
  assert.deepEqual(r.rechecks, { failed: 2, open: 1, changed: 1 });
  const rf = find(r.findings, "recheck.failed");
  assert.deepEqual(rf?.numbers, { failed: 2, open: 1, changed: 1 });
  assert.deepEqual(
    rf?.evidence.map((e) => e.id),
    ["taproot.c", "segwit.a"],
  );
  assert.deepEqual(rf?.proposal?.command, { type: "research.start", topic: "taproot" });
  const sf = find(r.findings, "source.quote-failing");
  assert.deepEqual(sf?.numbers, { sources: 1, failures: 2 });
  assert.deepEqual(sf?.evidence, [{ kind: "source", id: url }]);
  assert.equal(sf?.proposal, null, "no command fits: no button");
});

test("the evaluator's recheck numbers sources from 0, a recheck's from 1", () => {
  assert.deepEqual(
    quoteFailures("no longer holds as cited: source 0: quote not found at the locator", 0),
    [0],
  );
  assert.deepEqual(quoteFailures("source 2: quote not found; source 3: no url", 1), [1]);
  const url = "https://example.org/gone";
  const r = compileLoopReview(
    quiet({
      decisions: [1, 2].map((d) =>
        decision({
          id: "segwit.w",
          at: `2026-11-1${7 + d}T10:00:00Z`,
          raw: "reject",
          outcome: "reject",
          stages: [
            {
              stage: "recheck",
              ok: false,
              detail: "no longer holds as cited: source 1: quote not found at the locator",
            },
          ],
        }),
      ),
      pending: [
        {
          id: "segwit.w",
          topic: "segwit",
          proposed: "2026-11-21T00:00:00Z",
          sources: ["https://example.org/ok", url],
        },
      ],
    }),
  );
  assert.deepEqual(find(r.findings, "source.quote-failing")?.evidence, [
    { kind: "source", id: url },
  ]);
});

test("reports open past a week, and agenda topics no session touched in 14 days", () => {
  const r = compileLoopReview(
    quiet({
      runs: quiet().runs.filter((x) => !x.id.endsWith("taproot")),
      agenda: [...AGENDA, { slug: "lightning", title: "Lightning" }],
      gaps: [
        { slug: "segwit", score: 4 },
        { slug: "taproot", score: 9 },
        { slug: "lightning", score: 12 },
      ],
      reports: [
        { id: "0000000000000001", claim: "segwit.a", at: "2026-11-10T00:00:00Z", status: "failed" },
        {
          id: "0000000000000002",
          claim: "segwit.a",
          at: "2026-11-12T00:00:00Z",
          status: "researching",
        },
        { id: "0000000000000003", claim: "segwit.b", at: "2026-11-10T00:00:00Z", status: "holds" },
        {
          id: "0000000000000004",
          claim: "segwit.c",
          at: "2026-11-21T00:00:00Z",
          status: "received",
        },
      ],
    }),
  );
  assert.deepEqual(codes(r.findings), ["reports.open", "agenda.stale"]);
  const rep = find(r.findings, "reports.open");
  assert.deepEqual(rep?.numbers, { reports: 2, open: 3, oldestDays: 13 });
  assert.deepEqual(
    rep?.evidence.map((e) => e.id),
    ["0000000000000001", "0000000000000002"],
  );
  const st = find(r.findings, "agenda.stale");
  assert.deepEqual(st?.numbers, { topics: 2, agenda: 3, days: 14 });
  assert.deepEqual(
    st?.evidence.map((e) => e.id),
    ["lightning", "taproot"],
  );
  assert.deepEqual(st?.proposal?.command, { type: "research.start", topic: "lightning" });
});

test("weeks are Mondays in UTC, and a review of a week not begun is refused", () => {
  assert.equal(weekOf("2026-11-23T16:00:00Z"), "2026-11-23");
  assert.equal(weekOf("2026-11-22T23:59:59Z"), "2026-11-16");
  assert.equal(weekOf("2026-11-18"), "2026-11-16");
  assert.throws(() => compileLoopReview(quiet({ week: "2026-11-17" })), /not a Monday/);
  assert.throws(
    () => compileLoopReview(quiet({ week: "2026-11-23", at: "2026-11-22T00:00:00Z" })),
    /not begun/,
  );
});

test("every finding reads without a dash, and a done proposal is told from an open one", () => {
  const all: Finding[] = [
    ...compileLoopReview(quiet({ runs: [] })).findings,
    {
      code: "evaluator.canary-missed",
      weight: 81,
      subject: null,
      numbers: { missed: 1, caught: 3 },
      evidence: [],
      proposal: null,
    },
    {
      code: "rule.broken",
      weight: 43,
      subject: "no predicted outcome",
      numbers: { claims: 3, kept: 0 },
      evidence: [],
      proposal: null,
    },
    {
      code: "recheck.failed",
      weight: 61,
      subject: null,
      numbers: { failed: 2, open: 1, changed: 1 },
      evidence: [],
      proposal: null,
    },
    {
      code: "source.quote-failing",
      weight: 31,
      subject: null,
      numbers: { sources: 1, failures: 2 },
      evidence: [],
      proposal: null,
    },
    {
      code: "reports.open",
      weight: 51,
      subject: null,
      numbers: { reports: 1, open: 1, oldestDays: 8 },
      evidence: [],
      proposal: null,
    },
    {
      code: "queue.waiting",
      weight: 75,
      subject: null,
      numbers: { days: 4.2, waiting: 9, older: 3 },
      evidence: [],
      proposal: null,
    },
  ];
  for (const f of all) assert.ok(!hasDash(findingText(f)), findingText(f));
  for (const f of all) if (f.proposal) assert.ok(!hasDash(f.proposal.label), f.proposal.label);
  const s = settings();
  const lesson = { type: "lesson.add" as const, text: ruleLesson("dated") };
  assert.equal(proposalDone(lesson, s), false);
  assert.equal(
    proposalDone(lesson, {
      ...s,
      lessons: [{ id: "bbbbbbbb", text: lesson.text, at: "2026-11-20T00:00:00Z", from: "owner" }],
    }),
    true,
  );
  assert.equal(
    proposalDone({ type: "settings", patch: { research: { skipPending: true } } }, s),
    true,
  );
  assert.equal(
    proposalDone({ type: "settings", patch: { research: { skipPending: false } } }, s),
    false,
  );
  assert.equal(proposalDone({ type: "settings", patch: { paused: false } }, s), true);
  assert.equal(proposalDone({ type: "research.start", topic: null }, s), false);
});
