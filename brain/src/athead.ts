// The daily `at head` step (BACKLOG 43): every passage a published claim quotes from a file at a
// pinned GitHub commit, read again at that repository's head. A pinned link proves what the file
// said then; this says whether it still says it. Still there is `current`; the file there without
// the passage is `changed`; no such file at head is `gone`. A read that fails for any other reason
// (the network, a 5xx) records nothing new, so an outage never reads as a source that moved on.
// Heads come from `git ls-remote` (no API quota); files from raw.githubusercontent.com, never
// cached (a new head each day would grow the cache without end); a passage already read at the
// current head keeps its state without a read. Deterministic: no model reads or writes this file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AtHead, type AtHeadSource, type Claim, pinnedGitHub, type Stamp } from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { type ChainSource, chainSource } from "./chain.ts";
import { ROOT, remoteHead } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { get } from "./http.ts";
import { nowStamp } from "./store.ts";
import { findQuote, stripInvisible } from "./text.ts";

export const AT_HEAD_FILE = (): string =>
  process.env.BLOCKLORE_AT_HEAD_FILE || path.join(ROOT, "knowledge", "at-head.json");

/** What reading a file at a commit returned: its status and, when 200, its text. */
export interface FileRead {
  status: number;
  text: string;
}

/** A file at a commit, fresh from GitHub and kept nowhere, with invisible characters taken out as checks do. */
async function readFile(repo: string, commit: string, file: string): Promise<FileRead> {
  const r = await get(
    `https://raw.githubusercontent.com/${repo}/${commit}/${decodeURIComponent(file)}`,
    { maxAge: 0 },
  );
  return { status: r.status, text: r.status === 200 ? stripInvisible(r.body) : "" };
}

/**
 * The state of one passage from what reading its file at head returned, or null when the read
 * failed for a reason other than the file being absent.
 */
export function stateAt(r: FileRead, quote: string): AtHeadSource["state"] | null {
  if (r.status === 200) return findQuote(r.text, quote).found ? "current" : "changed";
  return r.status === 404 ? "gone" : null;
}

/** Every pinned GitHub source with a quote among the claims, in claim and source order. */
export function pinnedSources(claims: readonly Claim[]) {
  return claims
    .filter((c) => c.status !== "superseded" && c.status !== "withdrawn")
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((c) =>
      c.sources.flatMap((s, source) => {
        const p = pinnedGitHub(s.url);
        return p && s.url && s.quote
          ? [{ claim: c.id, source, url: s.url, quote: s.quote, ...p }]
          : [];
      }),
    );
}

const keyOf = (r: { claim: string; source: number; url: string }) =>
  `${r.claim}#${r.source}#${r.url}`;

/**
 * `pnpm brain at-head` and the daily step: read each passage at its repository's head and write
 * knowledge/at-head.json. Returns how many passages are no longer as cited (changed or gone).
 */
export async function readAtHead(
  opts: { commit: boolean; push: boolean },
  deps: {
    claims?: readonly Claim[];
    head?: (repo: string) => { sha: string; branch: string };
    read?: (repo: string, commit: string, file: string) => Promise<FileRead>;
    chain?: ChainSource;
  } = {},
): Promise<number> {
  const cited = pinnedSources(deps.claims ?? loadStore().store.claims);
  const file = AT_HEAD_FILE();
  const prev = existsSync(file) ? AtHead.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
  const before = new Map((prev?.sources ?? []).map((r) => [keyOf(r), r]));

  const heads: AtHead["heads"] = [];
  for (const repo of [...new Set(cited.map((c) => c.repo))].sort()) {
    try {
      const h = (deps.head ?? remoteHead)(repo);
      heads.push({ repo, branch: h.branch, commit: h.sha });
    } catch (e) {
      console.error(
        `at head: ${repo}'s head could not be read: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  const headOf = new Map(heads.map((h) => [h.repo, h.commit]));
  const read = deps.read ?? readFile;
  const at: Stamp = await nowStamp(deps.chain ?? chainSource());

  const sources: AtHeadSource[] = [];
  const counts = { current: 0, changed: 0, gone: 0, reused: 0, unread: 0 };
  for (const c of cited) {
    const head = headOf.get(c.repo);
    const was = before.get(keyOf(c));
    if (!head) {
      counts.unread++;
      if (was) sources.push(was);
      continue;
    }
    let state: AtHeadSource["state"] | null;
    if (c.commit === head) state = "current";
    else if (was?.head === head) {
      state = was.state;
      counts.reused++;
    } else state = stateAt(await read(c.repo, head, c.path), c.quote);
    if (state === null) {
      counts.unread++;
      if (was) sources.push(was);
      continue;
    }
    counts[state]++;
    sources.push({
      claim: c.claim,
      source: c.source,
      url: c.url,
      head,
      state,
      since: was?.state === state ? was.since : at,
    });
  }

  const next = AtHead.parse({ read: at, heads, sources });
  writeFileSync(file, `${JSON.stringify(next, null, 1)}\n`);
  const moved = counts.changed + counts.gone;
  const newly = sources.filter(
    (s) => s.state !== "current" && before.get(keyOf(s))?.state !== s.state,
  );
  console.log(
    `at head: ${cited.length} passages in ${heads.length} repositories: ${counts.current} still there, ${counts.changed} changed, ${counts.gone} gone, ${counts.unread} not read (${counts.reused} kept, already read at this head)`,
  );
  for (const s of newly) console.log(`  ${s.state}  ${s.claim} source ${s.source + 1}`);
  if (opts.commit)
    commitAsOwner(
      [path.relative(ROOT, file)],
      newly.length
        ? `Read every cited passage again at its repository's head, so readers see that ${newly.length} ${newly.length === 1 ? "has" : "have"} moved on since the claim cited ${newly.length === 1 ? "it" : "them"}.`
        : `Read every cited passage again at its repository's head, so each claim says whether its sources still say what it quotes.`,
      opts.push,
    );
  return moved;
}
