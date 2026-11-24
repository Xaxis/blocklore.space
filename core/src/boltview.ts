// One BOLT, the Lightning Network's specification, as Blocklore can show it from its own record:
// the entry as lightning/bolts' own index (BOLT #0) lists it at the commit it was read at, every
// change the brain has seen to the entry or the text, and the published claims that cite it,
// grouped as a BIP's page groups them (core/src/bipview.ts, citingGroups). Nothing here is written
// about a BOLT; every field is the index's or a published claim's. Pure: the compiled bundle comes
// in as an argument.
import { type BipViewInput, type CitingGroups, citingGroups } from "./bipview.ts";
import type { BoltChange, BoltEntry, BoltIndex, Claim, Stamp } from "./schema.ts";

const BOLTS_REPO = "https://github.com/lightning/bolts/blob";

/**
 * The BOLT a link points into, by its file's two-digit number (02-peer-protocol.md is BOLT 2), or
 * null for anything else in lightning/bolts (the README, an extension draft, a pull request).
 */
export function boltOf(url: string | undefined): number | null {
  const m = url
    ? /^https:\/\/github\.com\/lightning\/bolts\/(?:blob|tree)\/[^/]+\/(\d{2})-[a-z0-9-]+\.md(?:[#?]|$)/.exec(
        url,
      )
    : null;
  return m ? Number(m[1]) : null;
}

export interface BoltView extends CitingGroups {
  /** The entry as BOLT #0 lists it at `commit`. */
  entry: BoltEntry;
  commit: string;
  /** When and at what block the brain last read the index. */
  read: Stamp;
  /** The BOLT's text at `commit`. */
  text: string;
  /** BOLT #0, the index itself, at `commit`. */
  index: string;
  /** Every change the brain has seen to this BOLT, oldest first. */
  history: BoltChange[];
}

/** What boltView reads from the compiled bundle. */
export interface BoltViewInput {
  bolts: BoltIndex | null;
  boltCitations: Record<number, string[]>;
  claims: Record<string, Claim>;
  topics: BipViewInput["topics"];
}

/** BOLT `n` as Blocklore can show it, or null when the index at its commit does not list it. */
export function boltView(b: BoltViewInput, n: number): BoltView | null {
  const idx = b.bolts;
  const entry = idx?.bolts.find((x) => x.n === n);
  if (!idx || !entry) return null;
  const cited = (b.boltCitations[n] ?? []).flatMap((id) => {
    const c = b.claims[id];
    return c ? [c] : [];
  });
  return {
    entry,
    commit: idx.commit,
    read: idx.read,
    text: `${BOLTS_REPO}/${idx.commit}/${entry.file}`,
    index: `${BOLTS_REPO}/${idx.commit}/00-introduction.md`,
    history: idx.changes
      .filter((c) => c.n === n)
      .map((c, i) => ({ c, i }))
      .sort((x, y) => x.c.at.time.localeCompare(y.c.at.time) || x.i - y.i)
      .map(({ c }) => c),
    ...citingGroups(cited, b.topics),
  };
}
