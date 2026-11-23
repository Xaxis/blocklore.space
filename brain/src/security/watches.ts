// The watches (ARCHITECTURE.md, "The security watch"): on the hourly tick, each watch that is due
// reads public data at a polite rate, core/src/watch.ts turns it into a reading with a status, and
// the readings with their short history are written to knowledge/security/watches.json. Nothing
// here contacts a node or a person: only two block explorers' public APIs (which must agree on
// every block), mempool.space's pool statistics, the Bitnodes crawl, git tags and the inbox. When
// the advisories watch reads, every advisory it knows goes to knowledge/security/advisories.json
// with a few NVD records of their CVE ids (advisorylog.ts), in the same commit.
//
//   var/security/blocks.json   the blocks the brain has followed (hash and time per height), the
//                              first block of recent difficulty periods, and reorgs it observed
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  advisoryReading,
  difficultyReading,
  failedReading,
  findReorg,
  gapReading,
  hashrateReading,
  nodeVersionReading,
  PERIOD,
  type Reading,
  reorgReading,
  stampReading,
  timestampReading,
  WATCH_IDS,
  Watches,
  type WatchId,
  type WatchState,
  watchSpec,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { INBOX, ROOT } from "../env.ts";
import { commitAsOwner } from "../git.ts";
import { getJson } from "../http.ts";
import {
  ADVISORIES_FILE,
  inboxAdvisoryRecords,
  NVD_PER_RUN,
  refreshAdvisories,
} from "./advisorylog.ts";
import { logEvent, SECURITY_DIR } from "./events.ts";

export const WATCHES_FILE = () =>
  process.env.BLOCKLORE_WATCHES_FILE || path.join(ROOT, "knowledge", "security", "watches.json");
const BLOCKS_FILE = () => path.join(SECURITY_DIR, "blocks.json");

/** How many recent blocks the brain keeps a hash and time for: the gap window and some margin. */
const FOLLOW = 160;
/** Difficulty periods whose first block it keeps, for the adjustment history. */
const PERIODS = 13;

interface Followed {
  blocks: Record<string, { hash: string; time: number }>;
  periods: Record<string, { bits: number; time: number }>;
  reorgs: { at: string; height: number; depth: number }[];
}

const readFollowed = (): Followed =>
  existsSync(BLOCKS_FILE())
    ? (JSON.parse(readFileSync(BLOCKS_FILE(), "utf8")) as Followed)
    : { blocks: {}, periods: {}, reorgs: [] };

function writeFollowed(f: Followed) {
  mkdirSync(path.dirname(BLOCKS_FILE()), { recursive: true });
  writeFileSync(BLOCKS_FILE(), `${JSON.stringify(f)}\n`);
}

export function readWatches(file = WATCHES_FILE()): Watches | null {
  if (!existsSync(file)) return null;
  return Watches.parse(JSON.parse(readFileSync(file, "utf8")));
}

// -------------------------------------------------------------------------------------------
// Public data, read politely through brain/src/http.ts (one request a second per host, cached).

const MEMPOOL = "https://mempool.space/api";
const BLOCKSTREAM = "https://blockstream.info/api";

interface ListedBlock {
  id: string;
  height: number;
  timestamp: number;
  bits: number;
}

async function tip(): Promise<number> {
  const [a, b] = await Promise.all([
    getJson<number>(`${MEMPOOL}/blocks/tip/height`, { maxAge: 0 }),
    getJson<number>(`${BLOCKSTREAM}/blocks/tip/height`, { maxAge: 0 }),
  ]);
  // The two may be a block apart for a moment; the lower one is the tip both have seen.
  return Math.min(Number(a), Number(b));
}

/**
 * Blocks from `from` to `to` (inclusive) from both explorers, which must agree on every block's
 * hash, time and bits. mempool.space lists 15 blocks at a time, blockstream.info 10.
 */
async function blocksBetween(from: number, to: number, deep: number): Promise<ListedBlock[]> {
  const list = async (base: string, page: number) => {
    const out = new Map<number, ListedBlock>();
    for (let h = to; h >= from; h -= page) {
      // Blocks more than 100 deep never change: cache them for a year.
      const age = deep - h > 100 ? 365 * 86400 : 0;
      const url = base === MEMPOOL ? `${MEMPOOL}/v1/blocks/${h}` : `${BLOCKSTREAM}/blocks/${h}`;
      for (const b of await getJson<ListedBlock[]>(url, { maxAge: age }))
        if (b.height >= from && b.height <= to) out.set(b.height, b);
    }
    return out;
  };
  const a = await list(MEMPOOL, 15);
  const b = await list(BLOCKSTREAM, 10);
  const out: ListedBlock[] = [];
  for (let h = from; h <= to; h++) {
    const x = a.get(h);
    const y = b.get(h);
    if (!x || !y) throw new Error(`block ${h}: an explorer did not list it`);
    if (x.id !== y.id || x.timestamp !== y.timestamp || x.bits !== y.bits)
      throw new Error(`block ${h}: the explorers disagree`);
    out.push(x);
  }
  return out;
}

/** The newest Bitcoin Core release, from the repository's tags (git, no API quota). */
export function newestRelease(): string {
  const out = execFileSync(
    "git",
    ["ls-remote", "--tags", "--refs", "https://github.com/bitcoin/bitcoin", "v*"],
    { encoding: "utf8", timeout: 30_000 },
  );
  return newestTag(out.split("\n").map((l) => l.split("refs/tags/")[1] ?? ""));
}

/** The highest vX.Y or vX.Y.Z tag that is not a release candidate. */
export function newestTag(tags: string[]): string {
  const versions = tags
    .map((t) => /^v(\d+)\.(\d+)(?:\.(\d+))?$/.exec(t.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] as const)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const v = versions.at(-1);
  if (!v) throw new Error("no release tags found");
  return v[2] ? `${v[0]}.${v[1]}.${v[2]}` : `${v[0]}.${v[1]}`;
}

/** Advisories the ingest feeds saw (brain/src/security/advisories.ts), as the watch reads them. */
export function inboxAdvisories(dir = INBOX): Parameters<typeof advisoryReading>[0] {
  return inboxAdvisoryRecords(dir).map(({ ids: _, ...a }) => a);
}

// -------------------------------------------------------------------------------------------

export interface WatchContext {
  now: string;
  followed: Followed;
  tip: number | null;
  /** Set once the followed blocks are up to date in this run. */
  synced?: Promise<void>;
}

/** Brings the followed blocks up to the tip once per run. */
function follow(ctx: WatchContext): Promise<void> {
  ctx.synced ??= sync(ctx);
  return ctx.synced;
}

/** Reads the new blocks, and records a reorganization when a block it saw was replaced. */
async function sync(ctx: WatchContext): Promise<void> {
  const t = ctx.tip ?? (await tip());
  ctx.tip = t;
  const f = ctx.followed;
  const known = Object.keys(f.blocks).map(Number);
  const last = known.length ? Math.max(...known) : t - FOLLOW;
  // Re-read the last 6 blocks the brain saw, so a replaced block shows as a reorg.
  const from = Math.max(t - FOLLOW + 1, Math.min(last - 5, t));
  const fresh = await blocksBetween(from, t, t);
  const before = Object.fromEntries(known.map((h) => [h, f.blocks[h]?.hash ?? ""]));
  const now = Object.fromEntries(fresh.map((b) => [b.height, b.id]));
  const reorg = findReorg(before, now);
  if (reorg) f.reorgs = [...f.reorgs, { at: ctx.now, ...reorg }].slice(-24);
  for (const b of fresh) f.blocks[b.height] = { hash: b.id, time: b.timestamp };
  for (const h of Object.keys(f.blocks).map(Number)) if (h <= t - FOLLOW) delete f.blocks[h];
  // The first block of each recent difficulty period (deep ones never change).
  const start = Math.floor(t / PERIOD) * PERIOD;
  for (let k = 0; k < PERIODS; k++) {
    const h = start - k * PERIOD;
    if (f.periods[h]) continue;
    const [b] = await blocksBetween(h, h, t);
    if (b) f.periods[h] = { bits: b.bits, time: b.timestamp };
  }
  for (const h of Object.keys(f.periods).map(Number))
    if (h < start - PERIODS * PERIOD) delete f.periods[h];
}

const times = (f: Followed) =>
  Object.entries(f.blocks).map(([h, b]) => ({ height: Number(h), time: b.time }));

type Reader = (ctx: WatchContext) => Promise<Reading>;

const READERS: Record<WatchId, Reader> = {
  hashrate: async () => {
    const j = await getJson<{ pools: { name: string; blockCount: number }[] }>(
      `${MEMPOOL}/v1/mining/pools/1w`,
      { maxAge: 0 },
    );
    return hashrateReading(j.pools.map((p) => ({ name: p.name, blocks: p.blockCount })));
  },
  "block-gaps": async (ctx) => {
    await follow(ctx);
    return gapReading(times(ctx.followed));
  },
  timestamps: async (ctx) => {
    await follow(ctx);
    return timestampReading(times(ctx.followed));
  },
  difficulty: async (ctx) => {
    await follow(ctx);
    const f = ctx.followed;
    const t = ctx.tip as number;
    const start = Math.floor(t / PERIOD) * PERIOD;
    const tipBlock = f.blocks[t];
    const first = f.periods[start];
    return difficultyReading({
      periods: Object.entries(f.periods).map(([h, p]) => ({ height: Number(h), bits: p.bits })),
      progress: tipBlock && first ? { start: first.time, tip: t, tipTime: tipBlock.time } : null,
    });
  },
  reorgs: async (ctx) => {
    await follow(ctx);
    return reorgReading(ctx.followed.reorgs, Object.keys(ctx.followed.blocks).length, ctx.now);
  },
  advisories: async (ctx) => advisoryReading(inboxAdvisories(), ctx.now),
  "node-versions": async () => {
    const snap = await getJson<{ timestamp: number; nodes: Record<string, unknown[]> }>(
      "https://btcnodes.io/api/v1/snapshots/latest/",
      { maxAge: 0 },
    );
    return nodeVersionReading({
      agents: Object.values(snap.nodes).map((n) => String(n[1] ?? "")),
      newest: newestRelease(),
      crawled: new Date(snap.timestamp * 1000).toISOString().replace(/\.\d+Z$/, "Z"),
    });
  },
};

let threatList: { id: string; watches: string[] }[] | undefined;
/** The threat a watch's events point at: the first threat on the map that lists it. */
function primaryThreat(id: WatchId): string | undefined {
  threatList ??= [...(loadStore().store.security?.threats ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return threatList.find((t) => t.watches.includes(id))?.id;
}

const fmt = (v: number | null, unit: string) =>
  v === null ? "no reading" : `${v}${unit === "%" ? "%" : ` ${unit}`}`;

/** Reads every watch that is due (all with force, or one with only) and writes the readings. */
export async function watch(opts: {
  only?: string;
  force: boolean;
  commit: boolean;
  push: boolean;
}): Promise<number> {
  if (opts.only && !WATCH_IDS.includes(opts.only as WatchId))
    throw new Error(`no watch ${opts.only}; the watches are ${WATCH_IDS.join(", ")}`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const previous = readWatches();
  const byId = new Map((previous?.watches ?? []).map((w) => [w.id, w]));
  const ctx: WatchContext = { now, followed: readFollowed(), tip: null };
  const ran: WatchState[] = [];
  let failed = 0;
  for (const id of WATCH_IDS) {
    if (opts.only && id !== opts.only) continue;
    const prev = byId.get(id);
    const spec = watchSpec(id);
    const due = !prev || Date.parse(now) - Date.parse(prev.at) >= (spec.every - 5) * 60e3;
    if (!opts.force && !due && !prev?.error) continue;
    let next: WatchState;
    try {
      next = stampReading(prev, await READERS[id](ctx), now, ctx.tip);
    } catch (e) {
      failed++;
      next = failedReading(prev, id, e instanceof Error ? e.message : String(e), now);
    }
    byId.set(id, next);
    ran.push(next);
    const changed = !prev || prev.status !== next.status;
    console.log(
      `watch ${id}: ${next.status}, ${fmt(next.value, spec.unit)}${next.error ? ` (failed: ${next.error})` : ""}`,
    );
    if (changed && !next.error)
      logEvent({
        at: now,
        kind: "watch",
        text: `${spec.title}: ${next.status === "ok" ? "within bounds" : next.status} at ${fmt(next.value, spec.unit)}`.slice(
          0,
          160,
        ),
        threat: primaryThreat(id),
        outcome: "changed",
      });
  }
  if (ctx.tip !== null) writeFollowed(ctx.followed);
  // Every advisory the watch knows, matched to the threats when the site compiles, and a few
  // more NVD records each time: a failure here never fails the watch, the old file stays.
  let advisoriesWritten = false;
  const advisories = ran.find((w) => w.id === "advisories");
  if (advisories && !advisories.error)
    try {
      const r = await refreshAdvisories({ now, nvd: NVD_PER_RUN });
      advisoriesWritten = r.written;
      console.log(
        `advisories: ${r.log.advisories.length} kept (${r.added} new), ${r.asked} NVD records read${r.failed.length ? `, ${r.failed.length} failed (${r.failed[0]})` : ""}`,
      );
    } catch (e) {
      console.log(`advisories: not recorded (${e instanceof Error ? e.message : String(e)})`);
    }
  if (!ran.length) {
    console.log("watch: nothing is due");
    return 0;
  }
  const out: Watches = Watches.parse({
    updated: now,
    watches: WATCH_IDS.flatMap((id) => {
      const w = byId.get(id);
      return w ? [w] : [];
    }),
  });
  mkdirSync(path.dirname(WATCHES_FILE()), { recursive: true });
  writeFileSync(WATCHES_FILE(), `${JSON.stringify(out, null, 1)}\n`);
  const raised = ran.filter((w) => w.status === "elevated" || w.status === "alert");
  logEvent({
    at: now,
    kind: "watch",
    text: `Read ${ran.length} security ${ran.length === 1 ? "watch" : "watches"}${failed ? `, ${failed} without data` : ""}: ${raised.length ? raised.map((w) => `${watchSpec(w.id).title.toLowerCase()} ${w.status}`).join(", ") : "all within bounds"}`.slice(
      0,
      160,
    ),
    outcome: failed ? "failed" : "ok",
  });
  if (opts.commit)
    commitAsOwner(
      [
        path.relative(ROOT, WATCHES_FILE()),
        ...(advisoriesWritten ? [path.relative(ROOT, ADVISORIES_FILE())] : []),
      ],
      advisoriesWritten
        ? "Record the security watches' readings and the advisories they read, so the Security page shows what the chain and the network look like now and each threat lists its own advisories."
        : "Record the security watches' readings, so the Security page shows what the chain and the network look like now.",
      opts.push,
    );
  return failed ? 1 : 0;
}
