// The control plane (ADMIN.md): how the owner's admin on the site and the brain daemon on the
// devbox talk, in the shapes below and nothing else.
//
//   admin -> brain   the site signs each command the signed-in owner gives and queues it in the
//                    site's Redis (ctl:cmd)
//   brain -> admin   the daemon calls POST /api/control/sync every few seconds with its bearer
//                    token (BRAIN_SYNC_TOKEN): it sends its state, the review queue when it
//                    changed, live events of the running research session and command results,
//                    and gets back the queued commands. The site keeps all of it under ctl:*.
//
// The devbox accepts no inbound connection and holds no Redis credential. A command counts only
// with a valid HMAC under CONTROL_KEY, which the site and the devbox hold and Redis never sees, so
// a leaked Redis or sync token can read or delay commands but cannot forge one: no approval, no
// spend. Commands expire after COMMAND_TTL_MS and each id is applied once.
//
// Pure: time and the key come in as arguments (CLAUDE.md, no hidden inputs in core).
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { EvaluatorView } from "./evaluate.ts";
import { BrainFeed } from "./feed.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { OC_COMMANDS, OcDaemonState } from "./orangecheck-commands.ts";

export const KEYS = {
  /** Commands from the admin, oldest first: RPUSH by the admin, LPOP by the sync endpoint. */
  commands: "ctl:cmd",
  /** The daemon's DaemonState as JSON, rewritten every sync, expiring when the daemon stops. */
  state: "ctl:state",
  /** ReviewItem[] as JSON: everything waiting for the owner, rewritten when it changes. */
  review: "ctl:review",
  /** LiveEvent JSON, newest first (LPUSH, LTRIM to LIVE_KEEP), for the research session. */
  live: "ctl:live",
  /** A CommandResult as JSON, per command id. */
  result: (id: string) => `ctl:result:${id}`,
  /** Set (with a short expiry) while the owner has the admin open; the daemon polls faster. */
  watch: "ctl:watch",
  /** EvaluatorView as JSON: the evaluator's state and recent decisions, rewritten when it changes. */
  evaluator: "ctl:evaluator",
  /** EmbargoView[] as JSON: findings the disclosure gate keeps private, rewritten when they change. */
  embargo: "ctl:embargo",
  /** The brain's public feed (core/src/feed.ts), rewritten every sync; readers see it. */
  feed: "pub:brain",
} as const;

export const COMMAND_TTL_MS = 15 * 60 * 1000;
export const STATE_TTL_S = 10 * 60;
export const RESULT_TTL_S = 7 * 24 * 3600;
export const WATCH_TTL_S = 90;
export const LIVE_KEEP = 400;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const claimId = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,127}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
/** Owner text that reaches a model or the store: one paragraph, no control characters. */
const ownerText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
    .refine((s) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s), "no control characters");

export const Lesson = z.strictObject({
  id: z.string().regex(/^[a-z0-9]{8,32}$/),
  text: ownerText(600).pipe(z.string().min(3)),
  at: iso,
  from: z.enum(["owner", "review", "revoke"]),
});
export type Lesson = z.infer<typeof Lesson>;

/**
 * Who decides gated claims and how strictly the evaluator watches itself (EDITORIAL.md, "The
 * evaluator"). Its own section, filled from the defaults when a saved file predates it.
 */
export const EvaluatorSettings = z.strictObject({
  /** evaluator: it decides and publishes; owner: gated claims wait for the owner's approval. */
  decides: z.enum(["evaluator", "owner"]),
  /** Automatic publishing pauses while the recent canary catch rate is below this. */
  minCatchRate: z.number().min(0.5).max(1),
  /** How many recent canaries the catch rate is measured over. */
  window: z.number().int().min(5).max(200),
  /** Waiting claims per batch; the canaries come on top. */
  batchSize: z.number().int().min(1).max(30),
  /** Canaries mixed blind into each batch (more while it is still calibrating). */
  canaries: z.number().int().min(1).max(10),
});
export type EvaluatorSettings = z.infer<typeof EvaluatorSettings>;

export const DEFAULT_EVALUATOR: EvaluatorSettings = {
  decides: "evaluator",
  minCatchRate: 0.9,
  window: 20,
  batchSize: 8,
  canaries: 2,
};

/**
 * Everything the owner controls about the brain. The daemon keeps it in var/control/settings.json;
 * every tick, research run and budget check reads it from there.
 */
export const Settings = z.strictObject({
  /** The master switch: when true no tick and no research run starts. */
  paused: z.boolean(),
  ticks: z.strictObject({ hourly: z.boolean(), daily: z.boolean(), weekly: z.boolean() }),
  research: z.strictObject({
    /** off: only runs the owner starts; daily: one run at dailyAt UTC; continuous: back to back. */
    mode: z.enum(["off", "daily", "continuous"]),
    dailyAt: z.number().int().min(0).max(23),
    maxRunsPerDay: z.number().int().min(1).max(24),
    /** Minutes between runs in continuous mode. */
    restMinutes: z.number().int().min(0).max(1440),
    /** Leave topics alone while any of their claims wait for review. */
    skipPending: z.boolean(),
    model: z.enum(["opus", "sonnet"]),
  }),
  /**
   * How much of the owner's Claude subscription one model session may use. Every model session
   * runs on the subscription (CLAUDE_CODE_OAUTH_TOKEN); there is no API key and nothing is billed
   * per token. The daily cap is research.maxRunsPerDay.
   */
  usage: z.strictObject({
    /** Wall-clock minutes before a session is stopped. */
    sessionMinutes: z.number().int().min(10).max(180),
    /** Model turns before a session is stopped. */
    sessionTurns: z.number().int().min(20).max(300),
  }),
  /** The owner's steering, added to every research task until cleared. */
  focus: ownerText(2000),
  /** Standing notes from the owner, often from review, added to every research task. */
  lessons: z.array(Lesson).max(100),
  evaluator: EvaluatorSettings.default(DEFAULT_EVALUATOR),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  paused: false,
  ticks: { hourly: true, daily: true, weekly: true },
  research: {
    mode: "off",
    dailyAt: 6,
    maxRunsPerDay: 4,
    restMinutes: 30,
    skipPending: true,
    model: "opus",
  },
  usage: { sessionMinutes: 75, sessionTurns: 120 },
  focus: "",
  lessons: [],
  evaluator: DEFAULT_EVALUATOR,
};

/** A change to settings: any subset of the sections, each section replaced field by field. */
export const SettingsPatch = z.strictObject({
  paused: Settings.shape.paused.optional(),
  ticks: Settings.shape.ticks.partial().optional(),
  research: Settings.shape.research.partial().optional(),
  usage: Settings.shape.usage.partial().optional(),
  focus: Settings.shape.focus.optional(),
  evaluator: EvaluatorSettings.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export function applyPatch(s: Settings, p: SettingsPatch): Settings {
  return Settings.parse({
    ...s,
    ...(p.paused === undefined ? {} : { paused: p.paused }),
    ticks: { ...s.ticks, ...p.ticks },
    research: { ...s.research, ...p.research },
    usage: { ...s.usage, ...p.usage },
    ...(p.focus === undefined ? {} : { focus: p.focus }),
    evaluator: { ...s.evaluator, ...p.evaluator },
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Settings as saved by any earlier version, brought to this one: sections and fields that no
 * longer exist are dropped (the API credential and the dollar budget), and sections or fields
 * that are new take their defaults, so an upgrade never throws away the owner's other choices.
 * Returns null when what is left still does not parse.
 */
export function migrateSettings(raw: unknown): Settings | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = raw[k];
    if (isRecord(def)) {
      const have = isRecord(v) ? v : {};
      out[k] = Object.fromEntries(
        Object.entries(def).map(([f, d]) => [f, have[f] === undefined ? d : have[f]]),
      );
    } else out[k] = v === undefined ? def : v;
  }
  const parsed = Settings.safeParse(out);
  return parsed.success ? parsed.data : null;
}

export const AgendaTopic = z.strictObject({
  slug,
  title: ownerText(120).pipe(z.string().min(2)),
  group: slug,
  scope: ownerText(4000).pipe(z.string().min(20)),
});
export type AgendaTopic = z.infer<typeof AgendaTopic>;

/**
 * A finding the disclosure gate keeps private (SECURITY.md, T9) as the admin shows it to the owner:
 * never public, never in the review queue. Only the owner releases or dismisses one.
 */
export const EmbargoView = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  kind: z.enum(["lab", "research"]),
  at: iso,
  title: z.string().max(200),
  reasons: z.array(z.string().max(300)).max(10),
  /** Where to report it privately: always Bitcoin Core, and each project the finding names. */
  contacts: z
    .array(z.object({ project: z.string(), email: z.string(), policy: z.string() }))
    .max(10),
  /** What was found: the candidate's statement, or the release and the tests that failed. */
  summary: z.string().max(2000),
  sources: z.array(z.object({ url: z.string().nullable(), quote: z.string().nullable() })).max(20),
  /** For a lab run, the end of the test runner's output. */
  tail: z.string().max(4000).nullable(),
});
export type EmbargoView = z.infer<typeof EmbargoView>;
/** A Claude subscription token as `claude setup-token` prints it. Never an API key. */
export const SUBSCRIPTION_TOKEN = /^sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]{20,400}$/;

/** A secret the site sealed for the devbox (core/src/node/seal.ts): ciphertext, never the secret. */
export const Sealed = z.strictObject({
  v: z.literal(1),
  iv: z.string().regex(/^[0-9a-f]{24}$/),
  tag: z.string().regex(/^[0-9a-f]{32}$/),
  data: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .max(2000),
});
export type Sealed = z.infer<typeof Sealed>;

const reviewItems = z
  .array(z.strictObject({ id: claimId, hash }))
  .min(1)
  .max(250);

export const Command = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ping") }),
  z.strictObject({ type: z.literal("settings"), patch: SettingsPatch }),
  /** Publish held claims, each exactly as the owner saw it (hash of the pending file's candidate). */
  z.strictObject({
    type: z.literal("review.approve"),
    items: reviewItems,
    note: ownerText(500).optional(),
  }),
  z.strictObject({
    type: z.literal("review.reject"),
    items: reviewItems,
    reason: ownerText(500).pipe(z.string().min(3)),
    /** Also keep the reason as a lesson for future research. */
    lesson: z.boolean(),
  }),
  /** Start a research session now; topic null lets the gap planner pick. */
  z.strictObject({
    type: z.literal("research.start"),
    topic: slug.nullable(),
    focus: ownerText(2000).optional(),
  }),
  z.strictObject({ type: z.literal("research.stop") }),
  z.strictObject({ type: z.literal("tick"), tick: z.enum(["hourly", "daily", "weekly"]) }),
  z.strictObject({ type: z.literal("ship") }),
  z.strictObject({ type: z.literal("agenda.save"), topic: AgendaTopic }),
  z.strictObject({ type: z.literal("agenda.remove"), slug }),
  z.strictObject({
    type: z.literal("lesson.add"),
    text: ownerText(600).pipe(z.string().min(3)),
  }),
  z.strictObject({ type: z.literal("lesson.remove"), id: Lesson.shape.id }),
  /**
   * Withdraw a published claim, as the owner saw it (claimHash of the published claim). Appends a
   * withdrawn revision with the reason; the reason also becomes a lesson and a canary case.
   */
  z.strictObject({
    type: z.literal("claim.revoke"),
    id: claimId,
    hash,
    reason: ownerText(500).pipe(z.string().min(3)),
  }),
  /** Run one evaluation batch on the claims waiting now. */
  z.strictObject({ type: z.literal("evaluator.run") }),
  /** Release an embargoed finding (to the review queue, or a lab run to the site) or dismiss it. */
  z.strictObject({
    type: z.literal("embargo.decide"),
    id: EmbargoView.shape.id,
    decision: z.enum(["release", "dismiss"]),
  }),
  /** The owner's Claude subscription token, sealed by the site; the devbox checks it, then saves it. */
  z.strictObject({ type: z.literal("subscription.connect"), sealed: Sealed }),
  z.strictObject({ type: z.literal("subscription.disconnect") }),
  /** The owner's attestation, delegation and revocation (ORANGECHECK.md), BIP-322 signed. */
  ...OC_COMMANDS,
]);
export type Command = z.infer<typeof Command>;
export type CommandType = Command["type"];

export const Envelope = z.strictObject({
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  at: iso,
  by: z.string().email(),
  cmd: Command,
  sig: hash,
});
export type Envelope = z.infer<typeof Envelope>;

function mac(key: string, e: Omit<Envelope, "sig">): string {
  return bytesToHex(
    hmac(sha256, utf8ToBytes(key), utf8ToBytes(canonicalJson({ ...e, v: "blocklore-ctl-1" }))),
  );
}

export function signCommand(key: string, e: Omit<Envelope, "sig">): Envelope {
  if (key.length < 32) throw new Error("CONTROL_KEY must be at least 32 characters");
  return { ...e, sig: mac(key, e) };
}

/** Whether an envelope from Redis may be applied: well formed, signed, fresh and not seen before. */
export function verifyEnvelope(
  key: string,
  raw: unknown,
  now: Date,
  seen: (id: string) => boolean,
): { ok: true; envelope: Envelope } | { ok: false; why: string; id?: string } {
  const parsed = Envelope.safeParse(raw);
  const id = (raw as { id?: unknown })?.id;
  const rid = typeof id === "string" ? id : undefined;
  if (!parsed.success) return { ok: false, why: "malformed command", id: rid };
  const e = parsed.data;
  if (key.length < 32) return { ok: false, why: "no control key on the devbox", id: e.id };
  const { sig, ...body } = e;
  const want = mac(key, body);
  let diff = sig.length ^ want.length;
  for (let i = 0; i < Math.min(sig.length, want.length); i++)
    diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff !== 0) return { ok: false, why: "bad signature", id: e.id };
  const age = now.getTime() - Date.parse(e.at);
  if (age > COMMAND_TTL_MS) return { ok: false, why: "expired", id: e.id };
  if (age < -60_000) return { ok: false, why: "dated in the future", id: e.id };
  if (seen(e.id)) return { ok: false, why: "already applied", id: e.id };
  return { ok: true, envelope: e };
}

export const CommandResult = z.strictObject({
  id: z.string(),
  type: z.string(),
  ok: z.boolean(),
  /** received: verified and queued; running; done or failed. */
  phase: z.enum(["received", "running", "done", "failed"]),
  at: iso,
  message: z.string().max(4000),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const ReviewSource = z.object({
  tier: z.string(),
  kind: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  locator: z.string(),
  quote: z.string().nullable(),
});

/** One held claim as the admin shows it. */
export const ReviewItem = z.object({
  id: claimId,
  /** sha256 of the canonical JSON of the pending candidate; approve and reject must name it. */
  hash,
  topic: z.string(),
  statement: z.string(),
  kind: z.string(),
  depth: z.string(),
  status: z.string(),
  confidence: z.string(),
  reasons: z.array(z.string()),
  run: z.string(),
  method: z.string(),
  /** For an update to a published claim, what the published claim says now. */
  before: z.string().nullable(),
  attributed: z.array(z.object({ name: z.string(), url: z.string().nullable() })),
  verdict: z.object({ verdict: z.string(), reason: z.string() }),
  sources: z.array(ReviewSource),
  checks: z.array(z.string()),
  held: iso.nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/** The hash a ReviewItem carries, over the pending file's candidate. */
export function candidateHash(candidate: unknown): string {
  return sha256Hex(canonicalJson(candidate));
}

export const LiveEvent = z.object({
  at: iso,
  run: z.string(),
  role: z.string(),
  /** phase: a step of the run; tool: a tool call; text: what the model said; result: a role ended. */
  kind: z.enum(["phase", "tool", "text", "result"]),
  text: z.string().max(600),
});
export type LiveEvent = z.infer<typeof LiveEvent>;

export const RunSummary = z.object({
  id: z.string(),
  kind: z.string(),
  topic: z.string(),
  started: iso,
  finished: iso.nullable(),
  status: z.enum(["running", "done", "failed", "stopped"]),
  /** Wall-clock minutes the run's model sessions took on the subscription. */
  minutes: z.number(),
  published: z.number(),
  gated: z.number(),
  rejected: z.number(),
  note: z.string(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const TickStatus = z.object({
  tick: z.enum(["hourly", "daily", "weekly"]),
  enabled: z.boolean(),
  last: z
    .object({
      at: iso,
      ok: z.boolean(),
      steps: z.array(
        z.object({ step: z.string(), ok: z.boolean(), ms: z.number(), note: z.string() }),
      ),
    })
    .nullable(),
  next: iso.nullable(),
});

export const AgendaStatus = AgendaTopic.extend({
  claims: z.number(),
  pending: z.number(),
  score: z.number(),
});

export const DaemonState = z.object({
  at: iso,
  started: iso,
  host: z.string(),
  /** The commit the devbox checkout is at. */
  head: z.string(),
  /** The commit the live site was built from, when last asked. */
  live: z.string().nullable(),
  activity: z.object({
    kind: z.enum(["idle", "tick", "research", "evaluate", "review", "ship", "agenda", "paused"]),
    label: z.string(),
    since: iso,
    run: z.string().nullable(),
  }),
  settings: Settings,
  /** Model sessions on the subscription: today, and the last 14 days. */
  usage: z.object({
    today: z.object({ sessions: z.number(), minutes: z.number(), turns: z.number() }),
    days: z.array(z.object({ day: z.string(), sessions: z.number(), minutes: z.number() })),
  }),
  ticks: z.array(TickStatus),
  research: z.object({
    runsToday: z.number(),
    next: z.object({ at: iso.nullable(), topic: z.string().nullable(), why: z.string() }),
  }),
  runs: z.array(RunSummary),
  agenda: z.array(AgendaStatus),
  review: z.object({
    count: z.number(),
    topics: z.array(z.object({ topic: z.string(), count: z.number() })),
  }),
  /**
   * The owner's Claude subscription: whether the devbox has its token, and when the plan's usage
   * limit last stopped a session, until when model work waits.
   */
  subscription: z.object({
    token: z.boolean(),
    limitedUntil: iso.nullable(),
    limitedWhy: z.string().nullable(),
  }),
  /** The publisher key's address and Nostr key (public values only); absent from older daemons. */
  orangecheck: OcDaemonState.optional(),
  results: z.array(CommandResult),
});
export type DaemonState = z.infer<typeof DaemonState>;

/** Bounds on one sync, so a confused or hostile caller cannot fill the store. */
export const SYNC_MAX_COMMANDS = 20;

/** What the daemon sends on each sync. */
export const SyncRequest = z.object({
  state: DaemonState,
  /** The whole review queue, only when it changed since the last sync; null otherwise. */
  review: z.array(ReviewItem).max(2000).nullable(),
  /** The whole embargo, only when it changed since the last sync; null or absent otherwise. */
  embargo: z.array(EmbargoView).max(200).nullable().optional(),
  /** Live events since the last sync, oldest first. */
  live: z.array(LiveEvent).max(LIVE_KEEP),
  /** True when a new research session started: the site clears the old session's events first. */
  liveReset: z.boolean(),
  results: z.array(CommandResult).max(100),
  /** The evaluator's view, only when it changed since the last sync. */
  evaluator: EvaluatorView.nullable().optional(),
  /** The brain's public feed (core/src/feed.ts), which the site serves at /api/v1/brain. */
  feed: BrainFeed.optional(),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

/** What the site answers: the queued commands (still unverified: the daemon checks each). */
export const SyncResponse = z.object({
  commands: z.array(z.unknown()).max(SYNC_MAX_COMMANDS),
  /** Whether the owner has the admin open, so the daemon syncs every few seconds. */
  watch: z.boolean(),
  at: iso,
});
export type SyncResponse = z.infer<typeof SyncResponse>;

/**
 * A request from the devbox for a one-time sign-in link (`pnpm brain admin-link`), for when mail
 * does not arrive. Signed under CONTROL_KEY like a command, so only the devbox and the site can
 * mint one; the sync token alone cannot.
 */
export const LinkRequest = z.strictObject({
  at: iso,
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  sig: hash,
});
export type LinkRequest = z.infer<typeof LinkRequest>;

const linkMac = (key: string, at: string, nonce: string) =>
  bytesToHex(
    hmac(
      sha256,
      utf8ToBytes(key),
      utf8ToBytes(canonicalJson({ at, nonce, v: "blocklore-link-1" })),
    ),
  );

export function signLinkRequest(key: string, at: string, nonce: string): LinkRequest {
  if (key.length < 32) throw new Error("CONTROL_KEY must be at least 32 characters");
  return { at, nonce, sig: linkMac(key, at, nonce) };
}

export function verifyLinkRequest(key: string, raw: unknown, now: Date): boolean {
  const p = LinkRequest.safeParse(raw);
  if (!p.success || key.length < 32) return false;
  const want = linkMac(key, p.data.at, p.data.nonce);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ p.data.sig.charCodeAt(i);
  const age = now.getTime() - Date.parse(p.data.at);
  return diff === 0 && age < 5 * 60_000 && age > -60_000;
}
