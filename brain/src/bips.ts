// The BIP index: bitcoin/bips README.mediawiki read at the repository's head commit, parsed into
// knowledge/bips.json, and diffed against the last reading so every status change is kept with the
// commit and block it was first seen at. Beside it, Bitcoin Core's own list of the BIPs it
// implements (doc/bips.md in bitcoin/bitcoin) into knowledge/core-bips.json the same way.
// Deterministic: no model reads or writes either.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type BipChange,
  type BipEntry,
  BipIndex,
  type CoreBipChange,
  type CoreBipEntry,
  CoreBips,
  undash,
} from "@blocklore/core";
import { type ChainSource, chainSource } from "./chain.ts";
import { ROOT, remoteHead } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { get } from "./http.ts";
import { nowStamp } from "./store.ts";

export const BIPS_FILE = path.join(ROOT, "knowledge", "bips.json");
export const CORE_BIPS_FILE = path.join(ROOT, "knowledge", "core-bips.json");

const cell = (line: string) => line.replace(/^\|\s?/, "").trim();

/** Rows of the index table: number, layer, title, owner, type, status (owner is dropped). */
export function parseBipIndex(mediawiki: string): BipEntry[] {
  const start = mediawiki.indexOf("\n{|");
  const end = mediawiki.indexOf("\n|}", start);
  if (start < 0 || end < 0) throw new Error("no table in the BIP index");
  const rows = mediawiki
    .slice(start, end)
    .split(/\n\|-[^\n]*/)
    .slice(1);
  const out: BipEntry[] = [];
  for (const row of rows) {
    const cells = row
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .map(cell);
    // A linked number has a file; a bare number is only allocated so far.
    const m =
      /^\[\[(bip-(\d{4})\.(?:mediawiki|md))\|(\d+)\]\]$/.exec(cells[0] ?? "") ??
      /^()()(\d+)$/.exec(cells[0] ?? "");
    if (!m || cells.length < 6) throw new Error(`unexpected BIP index row: ${row.slice(0, 120)}`);
    // The index is upstream text; dashes are undone like every other text Blocklore shows.
    const [, layer, title, , type, status] = cells.map(undash) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    out.push({
      n: Number(m[3]),
      ...(layer ? { layer } : {}),
      title,
      type,
      status,
      ...(m[1] ? { file: m[1] } : {}),
    });
  }
  return out;
}

export function diffBips(
  before: BipEntry[],
  after: BipEntry[],
  commit: string,
  at: BipChange["at"],
): BipChange[] {
  const old = new Map(before.map((b) => [b.n, b]));
  const now = new Map(after.map((b) => [b.n, b]));
  const changes: BipChange[] = [];
  for (const b of after) {
    const o = old.get(b.n);
    if (!o) {
      changes.push({ n: b.n, title: b.title, field: "added", after: b.status, commit, at });
      continue;
    }
    for (const field of ["status", "title", "type", "layer"] as const)
      if ((o[field] ?? "") !== (b[field] ?? ""))
        changes.push({
          n: b.n,
          title: b.title,
          field,
          before: o[field],
          after: b[field],
          commit,
          at,
        });
  }
  for (const o of before)
    if (!now.has(o.n))
      changes.push({ n: o.n, title: o.title, field: "removed", before: o.status, commit, at });
  return changes;
}

/** Reads the index at bitcoin/bips' head; writes and (optionally) commits it when it changed. */
export async function refreshBips(
  opts: { commit: boolean; push: boolean },
  chain: ChainSource = chainSource(),
): Promise<number> {
  const { sha } = remoteHead("bitcoin/bips");
  const prev = existsSync(BIPS_FILE)
    ? BipIndex.parse(JSON.parse(readFileSync(BIPS_FILE, "utf8")))
    : null;
  if (prev?.commit === sha) {
    console.log(`bips: index unchanged at ${sha.slice(0, 10)}`);
    return 0;
  }
  const r = await get(`https://raw.githubusercontent.com/bitcoin/bips/${sha}/README.mediawiki`, {
    maxAge: 365 * 86400,
  });
  if (r.status !== 200)
    throw new Error(`bips: README at ${sha}: ${r.status} ${r.body.slice(0, 120)}`);
  const bips = parseBipIndex(r.body);
  const at = await nowStamp(chain);
  // The first reading is the baseline, not a list of 200 additions.
  const changes = prev ? diffBips(prev.bips, bips, sha, at) : [];
  const index: BipIndex = BipIndex.parse({
    commit: sha,
    read: at,
    bips,
    changes: [...(prev?.changes ?? []), ...changes],
  });
  writeFileSync(BIPS_FILE, `${JSON.stringify(index, null, 1)}\n`);
  for (const c of changes)
    console.log(
      `  BIP ${c.n} ${c.field}${c.before !== undefined ? `: ${c.before} to ${c.after}` : `: ${c.after ?? ""}`}`,
    );
  console.log(`bips: ${bips.length} BIPs at ${sha.slice(0, 10)}, ${changes.length} changes`);
  if (!opts.commit) return 0;
  const msg = prev
    ? `Record the BIP index at ${sha.slice(0, 10)}: ${changes.length} changes since ${prev.commit.slice(0, 10)}.`
    : `Record the BIP index at ${sha.slice(0, 10)}, so proposals can be tracked from their own repository.`;
  commitAsOwner([path.relative(ROOT, BIPS_FILE)], msg, opts.push);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Bitcoin Core's doc/bips.md

const BIP_LINK =
  /\[`(?:BIP )?\d+`\]\(https:\/\/github\.com\/bitcoin\/bips\/blob\/[^/)]+\/bip-(\d{4})\.(?:mediawiki|md)\)/g;
const HEAD = new RegExp(`^\\* ((?:${BIP_LINK.source}\\s*)+):?\\s*(.*)$`);

/** Markdown inline text as plain words: links to their text, emphasis and code marks dropped. */
function plain(md: string): string {
  return undash(
    md
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Bitcoin Core's doc/bips.md as entries: each top-level bullet with the BIPs its links name (a
 * bullet may name several, as Taproot's names 340, 341 and 342), its words, the first version it
 * names in bold, the pull requests it links and the line it starts on. A bullet that names no BIP
 * is an error, so a change of format stops the reading instead of losing entries silently.
 */
export function parseCoreBips(md: string): CoreBipEntry[] {
  const lines = md.split("\n");
  const out: CoreBipEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.startsWith("* ")) continue;
    const start = i;
    const parts = [lines[i] as string];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] as string))
      parts.push((lines[++i] as string).trim());
    const joined = parts.join(" ");
    const head = HEAD.exec(joined);
    if (!head)
      throw new Error(`doc/bips.md line ${start + 1} names no BIP: ${joined.slice(0, 120)}`);
    const bips = [...(head[1] as string).matchAll(BIP_LINK)].map((m) => Number(m[1]));
    const rest = head[head.length - 1] as string;
    const since = /\*\*(v?\d+(?:\.\d+)*(?:rc\d+)?)\*\*/.exec(rest)?.[1];
    const prs = [
      ...new Set(
        [...rest.matchAll(/https:\/\/github\.com\/bitcoin\/bitcoin\/pull\/(\d+)/g)].map((m) =>
          Number(m[1]),
        ),
      ),
    ];
    out.push({ bips, text: plain(rest), ...(since ? { since } : {}), prs, line: start + 1 });
  }
  if (!out.length) throw new Error("doc/bips.md has no entries");
  return out;
}

/** Each BIP's words in a reading: a BIP named by two entries gets both, in order. */
function wordsByBip(entries: CoreBipEntry[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const e of entries)
    for (const n of e.bips) m.set(n, m.has(n) ? `${m.get(n)} ${e.text}` : e.text);
  return m;
}

export function diffCoreBips(
  before: CoreBipEntry[],
  after: CoreBipEntry[],
  commit: string,
  at: CoreBipChange["at"],
): CoreBipChange[] {
  const old = wordsByBip(before);
  const now = wordsByBip(after);
  const changes: CoreBipChange[] = [];
  for (const [n, text] of now) {
    const was = old.get(n);
    if (was === undefined) changes.push({ n, field: "added", after: text, commit, at });
    else if (was !== text) changes.push({ n, field: "text", before: was, after: text, commit, at });
  }
  for (const [n, text] of old)
    if (!now.has(n)) changes.push({ n, field: "removed", before: text, commit, at });
  return changes.sort((a, b) => a.n - b.n);
}

/**
 * Reads doc/bips.md at bitcoin/bitcoin's head and writes knowledge/core-bips.json when its
 * entries changed. The commit kept is the first one read with these entries, so the file does
 * not change every hour that Core's master moves on without touching the list.
 */
export async function refreshCoreBips(
  opts: { commit: boolean; push: boolean },
  chain: ChainSource = chainSource(),
): Promise<number> {
  const { sha } = remoteHead("bitcoin/bitcoin");
  const prev = existsSync(CORE_BIPS_FILE)
    ? CoreBips.parse(JSON.parse(readFileSync(CORE_BIPS_FILE, "utf8")))
    : null;
  if (prev?.commit === sha) {
    console.log(`core bips: unchanged at ${sha.slice(0, 10)}`);
    return 0;
  }
  const r = await get(`https://raw.githubusercontent.com/bitcoin/bitcoin/${sha}/doc/bips.md`, {
    maxAge: 365 * 86400,
  });
  if (r.status !== 200)
    throw new Error(`core bips: doc/bips.md at ${sha}: ${r.status} ${r.body.slice(0, 120)}`);
  const entries = parseCoreBips(r.body);
  if (prev && JSON.stringify(prev.entries) === JSON.stringify(entries)) {
    console.log(`core bips: ${entries.length} entries, the same at ${sha.slice(0, 10)}`);
    return 0;
  }
  const at = await nowStamp(chain);
  // The first reading is the baseline, not sixty additions.
  const changes = prev ? diffCoreBips(prev.entries, entries, sha, at) : [];
  const list: CoreBips = CoreBips.parse({
    commit: sha,
    read: at,
    entries,
    changes: [...(prev?.changes ?? []), ...changes],
  });
  writeFileSync(CORE_BIPS_FILE, `${JSON.stringify(list, null, 1)}\n`);
  for (const c of changes) console.log(`  BIP ${c.n} ${c.field}`);
  console.log(
    `core bips: ${entries.length} entries naming ${new Set(entries.flatMap((e) => e.bips)).size} BIPs at ${sha.slice(0, 10)}, ${changes.length} changes`,
  );
  if (!opts.commit) return 0;
  const msg = prev
    ? `Record Bitcoin Core's list of the BIPs it implements at ${sha.slice(0, 10)}: ${changes.length} changes since ${prev.commit.slice(0, 10)}.`
    : `Record Bitcoin Core's list of the BIPs it implements at ${sha.slice(0, 10)}, so each BIP's page says in Core's own words what Core implements of it.`;
  commitAsOwner([path.relative(ROOT, CORE_BIPS_FILE)], msg, opts.push);
  return 0;
}
