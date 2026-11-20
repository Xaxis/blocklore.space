// The BIP index: bitcoin/bips README.mediawiki read at the repository's head commit, parsed into
// knowledge/bips.json, and diffed against the last reading so every status change is kept with the
// commit and block it was first seen at. Deterministic: no model reads or writes it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BipChange, type BipEntry, BipIndex, undash } from "@blocklore/core";
import { type ChainSource, chainSource } from "./chain.ts";
import { ROOT, remoteHead } from "./env.ts";
import { get } from "./http.ts";
import { nowStamp } from "./store.ts";

export const BIPS_FILE = path.join(ROOT, "knowledge", "bips.json");

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
  const rel = path.relative(ROOT, BIPS_FILE);
  execFileSync("git", ["add", "--", rel], { cwd: ROOT });
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--", rel], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (!staged) return 0;
  const msg = prev
    ? `Record the BIP index at ${sha.slice(0, 10)}: ${changes.length} changes since ${prev.commit.slice(0, 10)}.`
    : `Record the BIP index at ${sha.slice(0, 10)}, so proposals can be tracked from their own repository.`;
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Xaxis",
      "-c",
      "user.email=william.neeley@gmail.com",
      "commit",
      "-q",
      "-m",
      msg,
      "--",
      rel,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (opts.push)
    execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: ROOT, stdio: "inherit" });
  return 0;
}
