// The Lightning specification's own index (BOLT #0, "Introduction and Index", in lightning/bolts),
// read at the repository's head commit, and every change the brain sees to it: a BOLT added or
// removed, a title changed, or a BOLT's text changed (its file's SHA-256 differs), so a reader sees
// when the specification moved under a claim. Deterministic: no model reads or writes this file.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BoltChange, type BoltEntry, BoltIndex, type Stamp, undash } from "@blocklore/core";
import { type ChainSource, chainSource } from "./chain.ts";
import { ROOT, remoteHead } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { get } from "./http.ts";
import { nowStamp } from "./store.ts";

export const BOLTS_FILE = (): string =>
  process.env.BLOCKLORE_BOLTS_FILE || path.join(ROOT, "knowledge", "bolts.json");

const INDEX_FILE = "00-introduction.md";

/**
 * BOLT #0's own list: its heading (`# BOLT #0: Introduction and Index`) and each numbered line
 * (`1. [BOLT #1](01-messaging.md): Base Protocol`). Throws when the heading or the list is missing,
 * or a line's number and file disagree, so a reading that cannot be trusted writes nothing.
 */
export function parseBoltIndex(intro: string): Omit<BoltEntry, "hash">[] {
  const head = /^# BOLT #0: (.+)$/m.exec(intro);
  if (!head) throw new Error("bolts: BOLT #0 has no heading");
  const out: Omit<BoltEntry, "hash">[] = [
    { n: 0, title: undash((head[1] ?? "").trim()), file: INDEX_FILE },
  ];
  for (const m of intro.matchAll(/^\d+\. \[BOLT #(\d+)\]\((\d{2}-[a-z0-9-]+\.md)\): (.+)$/gm)) {
    const n = Number(m[1]);
    const file = m[2] as string;
    if (Number(file.slice(0, 2)) !== n) throw new Error(`bolts: BOLT #${n} points at ${file}`);
    if (out.some((e) => e.n === n)) throw new Error(`bolts: BOLT #${n} is listed twice`);
    out.push({ n, title: undash((m[3] ?? "").trim()), file });
  }
  if (out.length < 2) throw new Error("bolts: BOLT #0 lists no BOLT");
  return out.sort((a, b) => a.n - b.n);
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * What changed between two readings: BOLTs added or removed, titles changed, and texts changed.
 * A text change carries the commit the old text was read at in `before`, so a reader can compare.
 */
export function diffBolts(
  prev: { commit: string; bolts: BoltEntry[] },
  next: BoltEntry[],
  commit: string,
  at: Stamp,
): BoltChange[] {
  const out: BoltChange[] = [];
  const was = new Map(prev.bolts.map((b) => [b.n, b]));
  const now = new Map(next.map((b) => [b.n, b]));
  for (const b of next) {
    const p = was.get(b.n);
    if (!p) out.push({ n: b.n, field: "added", after: b.title, commit, at });
    else {
      if (p.title !== b.title)
        out.push({ n: b.n, field: "title", before: p.title, after: b.title, commit, at });
      if (p.hash !== b.hash) out.push({ n: b.n, field: "text", before: prev.commit, commit, at });
    }
  }
  for (const p of prev.bolts)
    if (!now.has(p.n)) out.push({ n: p.n, field: "removed", before: p.title, commit, at });
  return out.sort((a, b) => a.n - b.n);
}

async function raw(sha: string, file: string): Promise<string> {
  const r = await get(`https://raw.githubusercontent.com/lightning/bolts/${sha}/${file}`, {
    maxAge: 365 * 86400,
  });
  if (r.status !== 200) throw new Error(`bolts: ${file} at ${sha}: ${r.status}`);
  return r.body;
}

/**
 * The hourly `bolts` step and `pnpm brain bolts`: when lightning/bolts' head moved, read BOLT #0 and
 * every BOLT it lists at the new head, and write knowledge/bolts.json only when something changed.
 * `commit` stays at the first commit read with the current index and texts.
 */
export async function refreshBolts(
  opts: { commit: boolean; push: boolean },
  deps: {
    head?: () => string;
    read?: (sha: string, file: string) => Promise<string>;
    chain?: ChainSource;
  } = {},
): Promise<number> {
  const sha = (deps.head ?? (() => remoteHead("lightning/bolts").sha))();
  const file = BOLTS_FILE();
  const prev = existsSync(file) ? BoltIndex.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
  if (prev?.commit === sha) {
    console.log(`bolts: unchanged at ${sha.slice(0, 10)}`);
    return 0;
  }
  const read = deps.read ?? raw;
  const listed = parseBoltIndex(await read(sha, INDEX_FILE));
  const bolts: BoltEntry[] = [];
  for (const e of listed) bolts.push({ ...e, hash: sha256(await read(sha, e.file)) });
  if (prev && JSON.stringify(prev.bolts) === JSON.stringify(bolts)) {
    console.log(`bolts: ${bolts.length} BOLTs, the same at ${sha.slice(0, 10)}`);
    return 0;
  }
  const at = await nowStamp(deps.chain ?? chainSource());
  // The first reading is the baseline, not thirteen additions.
  const changes = prev ? diffBolts(prev, bolts, sha, at) : [];
  const index: BoltIndex = BoltIndex.parse({
    commit: sha,
    read: at,
    bolts,
    changes: [...(prev?.changes ?? []), ...changes],
  });
  writeFileSync(file, `${JSON.stringify(index, null, 1)}\n`);
  for (const c of changes) console.log(`  BOLT ${c.n} ${c.field}`);
  console.log(`bolts: ${bolts.length} BOLTs at ${sha.slice(0, 10)}, ${changes.length} changes`);
  if (!opts.commit) return 0;
  commitAsOwner(
    [path.relative(ROOT, file)],
    prev
      ? `Record the Lightning specification at ${sha.slice(0, 10)}: ${changes.length} changes since ${prev.commit.slice(0, 10)}, so each BOLT's page shows when its text moved.`
      : `Record the Lightning specification's index at ${sha.slice(0, 10)}, so each BOLT has a page with the claims that cite it.`,
    opts.push,
  );
  return 0;
}
