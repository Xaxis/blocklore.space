// The normative shapes of everything in knowledge/. CLAIMS.md explains them; when the two disagree,
// this file is right and the document has a bug.
import { z } from "zod";

export const DEPTHS = ["curious", "user", "holder", "builder", "researcher"] as const;
export const KINDS = [
  "definition",
  "fact",
  "mechanism",
  "event",
  "trace",
  "stance",
  "argument",
  "open-question",
] as const;
export const STATUSES = [
  "established",
  "contested",
  "speculative",
  "superseded",
  "withdrawn",
] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const TIERS = ["T1", "T2", "T3", "T4"] as const;
export const SOURCE_KINDS = [
  "bip",
  "bolt",
  "code",
  "commit",
  "pr",
  "issue",
  "release-notes",
  "mailing-list",
  "delving",
  "chain",
  "optech",
  "stackexchange",
  "transcript",
  "paper",
  "docs",
  "media",
  "social",
] as const;
export const CHANGES = [
  "created",
  "corrected",
  "refined",
  "sources",
  "status",
  "confidence",
  "depth",
  "superseded",
  "reviewed",
  "withdrawn",
] as const;

export type Depth = (typeof DEPTHS)[number];
export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type Confidence = (typeof CONFIDENCES)[number];
export type Tier = (typeof TIERS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type Change = (typeof CHANGES)[number];

export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase words joined by hyphens");
export const claimId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/, "<topic>.<slug>");
const isoTime = z.iso.datetime({ offset: false });
const isoDate = z.iso.date();
const hex40 = z.string().regex(/^[0-9a-f]{40}$/, "a 40-hex commit");
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "64 hex characters");

/** A moment on two clocks: wall time and the chain's height then. */
export const Stamp = z.strictObject({
  time: isoTime,
  height: z.number().int().nonnegative(),
});
export type Stamp = z.infer<typeof Stamp>;

export const Source = z.strictObject({
  tier: z.enum(TIERS),
  kind: z.enum(SOURCE_KINDS),
  title: z.string().min(3).max(200),
  url: z.url({ protocol: /^https$/ }).optional(),
  locator: z.string().min(2).max(200),
  quote: z.string().min(3).max(400).optional(),
  published: isoDate.optional(),
  accessed: isoDate,
  supports: z.enum(["direct", "partial", "background"]),
});
export type Source = z.infer<typeof Source>;

export const Check = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("chain.block-hash"),
    height: z.number().int().nonnegative(),
    expect: hex64,
  }),
  z.strictObject({
    type: z.literal("chain.subsidy"),
    height: z.number().int().nonnegative(),
    expect_sats: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("chain.header"),
    height: z.number().int().nonnegative(),
    field: z.enum(["version", "time", "bits", "nonce"]),
    expect: z.union([z.number().int(), z.string()]),
  }),
  z.strictObject({
    type: z.literal("code.contains"),
    repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
    ref: hex40,
    path: z.string().min(1),
    text: z.string().min(3).max(300),
    live: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("bip.field"),
    bip: z.number().int().nonnegative(),
    field: z.enum(["Status", "Type", "Layer", "Title", "Authors"]),
    expect: z.string().min(1),
  }),
]);
export type Check = z.infer<typeof Check>;

export const Verified = z.strictObject({
  time: isoTime,
  height: z.number().int().nonnegative(),
  run: z.string().min(1),
  method: z.string().min(3).max(300),
});
export type Verified = z.infer<typeof Verified>;

/** The fields a revision's `before` may restore. */
export const RevisableFields = z.strictObject({
  statement: z.string().optional(),
  kind: z.enum(KINDS).optional(),
  depth: z.enum(DEPTHS).optional(),
  status: z.enum(STATUSES).optional(),
  confidence: z.enum(CONFIDENCES).optional(),
  topics: z.array(slug).optional(),
  sources: z.array(Source).optional(),
  checks: z.array(Check).optional(),
  people: z.array(z.string()).optional(),
  superseded_by: claimId.nullable().optional(),
});
export type RevisableFields = z.infer<typeof RevisableFields>;

export const Revision = z.strictObject({
  rev: z.number().int().positive(),
  at: Stamp,
  run: z.string().min(1),
  change: z.enum(CHANGES),
  note: z.string().min(3).max(600).optional(),
  before: RevisableFields.optional(),
});
export type Revision = z.infer<typeof Revision>;

export const Person = z.strictObject({
  name: z.string().min(2).max(120),
  url: z.url({ protocol: /^https$/ }).optional(),
});

/**
 * How a gated claim came to publish (CLAIMS.md, `review`): the evaluator's ensemble passed it, or
 * the owner approved it by hand. `reasons` are the gate's, which chose how much scrutiny it got.
 */
export const Review = z.discriminatedUnion("by", [
  z.strictObject({
    by: z.literal("evaluator"),
    reasons: z.array(z.string()).min(1),
    at: isoTime,
    /** The evaluation batch that passed it (its record is on /verify/evaluator). */
    batch: z.string().regex(/^\d{4}-\d{2}-\d{2}-evaluate-[a-z0-9-]+$/),
    /** Every check that passed, in plain words. */
    checks: z.array(z.string().min(3).max(200)).min(3).max(24),
    /** The models whose independent verifier sessions both accepted it. */
    models: z.array(z.string().min(2).max(60)).min(2).max(4),
  }),
  z.strictObject({
    by: z.literal("owner"),
    reasons: z.array(z.string()).min(1),
    at: isoTime,
    note: z.string().max(600).optional(),
  }),
]);
export type Review = z.infer<typeof Review>;

export const Claim = z.strictObject({
  id: claimId,
  statement: z.string().min(20).max(700),
  kind: z.enum(KINDS),
  topics: z.array(slug).min(1),
  depth: z.enum(DEPTHS),
  status: z.enum(STATUSES),
  confidence: z.enum(CONFIDENCES),
  people: z.array(z.string().min(2)),
  attributed_to: z.array(Person).optional(),
  sources: z.array(Source).min(1),
  checks: z.array(Check).optional(),
  first_seen: Stamp,
  last_verified: Verified,
  run: z.string().min(1),
  related: z.array(claimId).optional(),
  supersedes: claimId.optional(),
  superseded_by: claimId.nullable().optional(),
  review: Review.optional(),
  revisions: z.array(Revision).min(1),
});
export type Claim = z.infer<typeof Claim>;

export const Section = z.strictObject({
  id: slug,
  title: z.string().min(2).max(80),
  depth: z.enum(DEPTHS),
  claims: z.array(claimId).min(1),
});
export type Section = z.infer<typeof Section>;

export const Topic = z.strictObject({
  slug,
  title: z.string().min(2).max(80),
  lede: claimId,
  contested: z.boolean(),
  safety: z.boolean(),
  group: z.enum([
    "foundations",
    "protocol",
    "layers",
    "custody",
    "governance",
    "mining",
    "history",
  ]),
  related: z.array(slug).optional(),
  sections: z.array(Section).min(1),
});
export type Topic = z.infer<typeof Topic>;

export const Proposal = z.strictObject({
  slug,
  title: z.string().min(2).max(80),
  aka: z.array(z.string()).optional(),
  kind: z.enum(["consensus", "policy", "p2p", "wallet"]),
  bips: z.array(z.number().int().nonnegative()),
  lede: claimId,
  signal_bit: z.number().int().min(0).max(28).optional(),
  topics: z.array(slug).min(1),
  related: z.array(slug).optional(),
  sections: z.array(Section).min(1),
});
export type Proposal = z.infer<typeof Proposal>;

export const Debate = z.strictObject({
  slug,
  question: z.string().min(10).max(200),
  topics: z.array(slug).min(1),
  positions: z.array(z.strictObject({ id: slug, label: z.string().min(2).max(120) })).min(2),
  nodes: z
    .array(
      z.strictObject({
        claim: claimId,
        nature: z.enum(["empirical", "value", "definitional"]),
        position: slug.optional(),
      }),
    )
    .min(2),
  edges: z.array(
    z.strictObject({ from: claimId, to: claimId, rel: z.enum(["supports", "rebuts"]) }),
  ),
  /**
   * Set when the owner withdrew the map (brain/src/revoke.ts): it leaves every list, its page says
   * when and why, and research cannot publish a map under this slug again.
   */
  withdrawn: z
    .strictObject({
      at: Stamp,
      run: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
      note: z.string().min(3).max(600),
    })
    .optional(),
});
export type Debate = z.infer<typeof Debate>;

/** One research or verification run, as the public research log shows it. */
export const Run = z.strictObject({
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
  kind: z.enum(["seed", "daily", "queue", "reverify", "digest", "bench", "review"]),
  started: Stamp,
  finished: Stamp,
  agent: z.string().min(2).max(200),
  summary: z.string().min(10).max(1200),
  read: z.array(z.strictObject({ url: z.url(), why: z.string().max(200).optional() })),
  published: z.array(claimId),
  revised: z.array(z.strictObject({ id: claimId, change: z.enum(CHANGES), note: z.string() })),
  rejected: z.array(z.strictObject({ statement: z.string(), reason: z.string().min(3) })),
  /** Claims held for closer checks, counted per topic; their text stays private until they pass. */
  gated: z.array(
    z.strictObject({
      topic: slug,
      count: z.number().int().positive(),
      reasons: z.array(z.string()),
    }),
  ),
  open: z.array(z.string()),
  injections: z.array(z.strictObject({ url: z.url(), excerpt: z.string().max(300) })),
});
export type Run = z.infer<typeof Run>;

export const DEPTH_RANK: Record<Depth, number> = {
  curious: 0,
  user: 1,
  holder: 2,
  builder: 3,
  researcher: 4,
};

export const DEPTH_LABEL: Record<Depth, string> = {
  curious: "Curious",
  user: "User",
  holder: "Holder",
  builder: "Builder",
  researcher: "Researcher",
};

/**
 * A published state of the store: every claim's hash and the Merkle root over them, as of a commit.
 * The file is never rewritten once stamped: its OpenTimestamps proof (`<n>.json.ots`) commits to
 * its exact bytes, and what the proof attests is read from the proof itself.
 */
export const Snapshot = z.strictObject({
  n: z.number().int().positive(),
  at: Stamp,
  /** The commit whose knowledge/claims these hashes were computed from. */
  commit: hex40,
  count: z.number().int().nonnegative(),
  root: hex64,
  previous: hex64.nullable(),
  claims: z.array(z.strictObject({ id: claimId, hash: hex64 })),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** The count of claims waiting for the owner, per topic; the claims themselves stay private. */
export const ReviewCount = z.strictObject({ topic: slug, count: z.number().int().positive() });
export type ReviewCount = z.infer<typeof ReviewCount>;

/**
 * The BIP index (bitcoin/bips README.mediawiki) as read at one commit, and every change the brain has
 * seen to it since. Owners are left out: the index names people, and a BIP's own file says who
 * owns it.
 */
export const BipEntry = z.strictObject({
  n: z.number().int().nonnegative(),
  layer: z.string().optional(),
  title: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  /** The BIP's file in bitcoin/bips, e.g. bip-0054.md; absent while only the number is allocated. */
  file: z
    .string()
    .regex(/^bip-\d{4}\.(mediawiki|md)$/)
    .optional(),
});
export type BipEntry = z.infer<typeof BipEntry>;

export const BipChange = z.strictObject({
  n: z.number().int().nonnegative(),
  title: z.string(),
  field: z.enum(["added", "removed", "status", "title", "type", "layer"]),
  before: z.string().optional(),
  after: z.string().optional(),
  commit: hex40,
  at: Stamp,
});
export type BipChange = z.infer<typeof BipChange>;

export const BipIndex = z.strictObject({
  commit: hex40,
  read: Stamp,
  bips: z.array(BipEntry),
  changes: z.array(BipChange),
});
export type BipIndex = z.infer<typeof BipIndex>;

/**
 * One entry of Bitcoin Core's own list of the BIPs it implements (doc/bips.md in bitcoin/bitcoin):
 * the BIPs it names and Core's sentence about them, as Core wrote it. Not a claim: Core's words,
 * shown as Core's, at the commit they were read at.
 */
export const CoreBipEntry = z.strictObject({
  bips: z.array(z.number().int().nonnegative()).min(1),
  /** Core's words, with links and emphasis taken out and dashes undone. */
  text: z.string().min(1).max(2000),
  /** The first version the entry names, as Core writes it ("v0.12.1", "0.13.0", "v28.0"). */
  since: z
    .string()
    .regex(/^v?\d+(\.\d+)*(rc\d+)?$/)
    .optional(),
  /** Every bitcoin/bitcoin pull request the entry links, in its order. */
  prs: z.array(z.number().int().positive()),
  /** The entry's first line in doc/bips.md at the commit. */
  line: z.number().int().positive(),
});
export type CoreBipEntry = z.infer<typeof CoreBipEntry>;

export const CoreBipChange = z.strictObject({
  n: z.number().int().nonnegative(),
  /** added: Core's list now names the BIP; removed: it no longer does; text: its words changed. */
  field: z.enum(["added", "removed", "text"]),
  before: z.string().optional(),
  after: z.string().optional(),
  commit: hex40,
  at: Stamp,
});
export type CoreBipChange = z.infer<typeof CoreBipChange>;

/** Bitcoin Core's doc/bips.md as the brain last read it, and every change it has seen to it. */
export const CoreBips = z.strictObject({
  /** The bitcoin/bitcoin commit the entries were read at: the first one with these words. */
  commit: hex40,
  read: Stamp,
  entries: z.array(CoreBipEntry),
  changes: z.array(CoreBipChange),
});
export type CoreBips = z.infer<typeof CoreBips>;

/**
 * One BOLT as lightning/bolts' own index lists it (BOLT #0, "Introduction and Index"): its number,
 * title and file, and the SHA-256 of the file's text at the commit, so a change to the text is seen
 * even when the index line stays the same. Not a claim: the index's words, shown as the index's.
 */
export const BoltEntry = z.strictObject({
  n: z.number().int().min(0).max(99),
  title: z.string().min(1).max(200),
  /** The BOLT's file in lightning/bolts, e.g. 02-peer-protocol.md. */
  file: z.string().regex(/^\d{2}-[a-z0-9-]+\.md$/),
  /** SHA-256 of the file's text at the index's commit. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BoltEntry = z.infer<typeof BoltEntry>;

export const BoltChange = z.strictObject({
  n: z.number().int().min(0).max(99),
  /** added or removed from the index, its title changed, or its text changed. */
  field: z.enum(["added", "removed", "title", "text"]),
  before: z.string().optional(),
  after: z.string().optional(),
  commit: hex40,
  at: Stamp,
});
export type BoltChange = z.infer<typeof BoltChange>;

export const BoltIndex = z.strictObject({
  commit: hex40,
  read: Stamp,
  bolts: z.array(BoltEntry),
  changes: z.array(BoltChange),
});
export type BoltIndex = z.infer<typeof BoltIndex>;

/**
 * The wire: the newest items the brain's feeds saw upstream (titles and links only, as their authors
 * wrote them, dashes undone), so a reader can see what the brain is watching. Not claims.
 */
export const WireItem = z.strictObject({
  source: z.string().min(1),
  title: z.string().min(1).max(400),
  url: z.url({ protocol: /^https$/ }),
  published: isoTime,
  tier: z.enum(TIERS),
});
export type WireItem = z.infer<typeof WireItem>;

export const Wire = z.strictObject({ updated: isoTime, items: z.array(WireItem) });
export type Wire = z.infer<typeof Wire>;

/**
 * A failed recheck (knowledge/rechecks.json, keyed by claim id): the published claim no longer
 * held as cited when the brain checked it again. Public until a later recheck passes or a
 * correction lands; the claim itself is not touched.
 */
export const Recheck = z.strictObject({
  at: Stamp,
  /** What did not hold, in the checker's words. */
  problems: z.array(z.string().min(1).max(600)).min(1),
});
export type Recheck = z.infer<typeof Recheck>;
export const Rechecks = z.record(z.string(), Recheck);
export type Rechecks = z.infer<typeof Rechecks>;

/**
 * A cited passage read again at its repository's head (knowledge/at-head.json). A claim cites a
 * file at a pinned commit, which proves what the file said then; this says whether the quoted
 * passage is still in that file at the repository's head. A passage no longer there is not a failed
 * check (the claim held as cited) but a sign the source moved on and the claim may need a revision.
 * Written by the daily `at head` step (brain/src/athead.ts); no model reads or writes it.
 */
export const AtHeadSource = z.strictObject({
  claim: claimId,
  /** The source's index in the claim's sources, and its URL, so a revised claim never inherits it. */
  source: z.number().int().min(0),
  url: z.string().url(),
  /** The head commit this state was read at, which an outage can leave behind the repository's. */
  head: hex40,
  /** current: the quote is in the file at head; changed: the file is there without it; gone: no such file at head. */
  state: z.enum(["current", "changed", "gone"]),
  /** When the brain first read it in this state. */
  since: Stamp,
});
export type AtHeadSource = z.infer<typeof AtHeadSource>;

export const AtHead = z.strictObject({
  /** When and at what block the brain last read every head. */
  read: Stamp,
  /** Each repository's head as read: its default branch and that branch's commit. */
  heads: z.array(
    z.strictObject({
      repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      branch: z.string().min(1).max(100),
      commit: hex40,
    }),
  ),
  sources: z.array(AtHeadSource),
});
export type AtHead = z.infer<typeof AtHead>;

const rate = z.number().min(0).max(1).nullable();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const goldenId = z.string().regex(/^g\d{3}$/);
/**
 * The bench's record (knowledge/bench.json): how well search finds the claims a golden question
 * needs, and how answers written from the claims score, over brain/bench/golden.yaml. The bench is
 * the owner's measurement, not a reader feature: the site runs no model for readers. Written by
 * `brain bench --publish`. Retrieval is free and refreshed weekly; answers cost model calls, are
 * scored on demand, and stay until the next scored run, with the fingerprint of the prompt and
 * model that wrote them.
 */
export const Scorecard = z.strictObject({
  /** The edition searched. */
  at: Stamp,
  /** SHA-256 of golden.yaml. */
  golden: sha256,
  questions: z.number().int().min(1),
  claims: z.number().int().min(0),
  /** The first row is every kind together ("all"). */
  retrieval: z.array(
    z.strictObject({
      kind: z.string(),
      n: z.number().int().min(0),
      hit1: rate,
      hit5: rate,
      hit12: rate,
      must12: rate,
      mrr: z.number().min(0).max(1),
    }),
  ),
  /** Questions whose expected claims search did not rank in the top 5. */
  misses: z.array(
    z.strictObject({
      id: goldenId,
      kind: z.string(),
      q: z.string(),
      rank: z.number().int().min(1).nullable(),
    }),
  ),
  ask: z
    .strictObject({
      at: Stamp,
      ran: isoTime,
      golden: sha256,
      /** askFingerprint() of the Ask that answered. */
      ask: sha256,
      model: z.string(),
      effort: z.string(),
      questions: z.number().int().min(1),
      usd: z.number().min(0),
      rows: z.array(
        z.strictObject({
          kind: z.string(),
          n: z.number().int().min(0),
          pass: rate,
          grounded: rate,
          must: rate,
          verdicts: z.record(z.string(), z.number().int().min(0)),
        }),
      ),
      failed: z.array(
        z.strictObject({ id: goldenId, kind: z.string(), q: z.string(), got: z.string() }),
      ),
      /**
       * Questions Ask answered only in part or not at all (out-of-scope ones aside), pass or fail:
       * what readers asked that the claims do not yet hold. The gap map reads it.
       */
      short: z.array(
        z.strictObject({ id: goldenId, kind: z.string(), q: z.string(), got: z.string() }),
      ),
      rejected: z.number().int().min(0),
      medianMs: z.number().int().min(0),
    })
    .nullable(),
});
export type Scorecard = z.infer<typeof Scorecard>;

const count = z.number().int().min(0);
/**
 * The evaluator's public record (knowledge/evaluator.json), what /verify/evaluator shows: what it
 * decided each day, how often it caught the test claims (canaries) mixed blind into its batches,
 * and which check stopped what did not publish. Counts only: a held or rejected claim's text and
 * a canary's text never leave the devbox. Revocations are read from the withdrawn claims.
 */
export const EvaluatorRecord = z.strictObject({
  updated: Stamp,
  /** The owner's threshold: automatic publishing pauses below this recent catch rate. */
  threshold: z.number().min(0).max(1),
  /** How many recent canaries the catch rate is measured over. */
  window: z.number().int().min(1),
  /** Why automatic publishing of gated claims is paused, in plain words; null when it is not. */
  paused: z.string().min(3).max(300).nullable(),
  canaries: z.strictObject({
    total: count,
    caught: count,
    recent: count,
    recentCaught: count,
    /** By mutation: a number changed, a name swapped, a hedge dropped, and so on. */
    kinds: z.array(z.strictObject({ kind: z.string().min(2), n: count, caught: count })),
  }),
  /** Newest last; real claims only (canaries are counted above). */
  days: z.array(
    z.strictObject({
      day: isoDate,
      published: count,
      held: count,
      rejected: count,
      canaries: count,
      caught: count,
    }),
  ),
  /** What stopped the real claims that did not publish, by check. */
  stopped: z.array(z.strictObject({ check: z.string().min(2), n: count })),
});
export type EvaluatorRecord = z.infer<typeof EvaluatorRecord>;
