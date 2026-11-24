// Whether each passage a claim quotes from a file at a pinned commit is still in that file at the
// repository's head (BACKLOG 43). A pinned link proves what a source said then; Blocklore promises
// the current state, so the brain reads every such passage again at head each day
// (brain/src/athead.ts) and the site shows, beside each source, whether it still says it. Pure: the
// reading comes in as an argument.
import type { AtHead, Claim, Stamp } from "./schema.ts";

/** A link to a file in a GitHub repository at a pinned 40-hex commit, as claims cite them. */
export interface Pinned {
  repo: string;
  commit: string;
  path: string;
}

/** The repository, commit and file a pinned GitHub link points into, or null for any other link. */
export function pinnedGitHub(url: string | undefined): Pinned | null {
  const m = url
    ? /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/blob\/([0-9a-f]{40})\/([^#?]+)/.exec(
        url,
      )
    : null;
  return m ? { repo: m[1] as string, commit: m[2] as string, path: m[3] as string } : null;
}

/** One source of a claim as the brain last read it at its repository's head. */
export interface AtHeadOf {
  /** The source's index in the claim's `sources`. */
  source: number;
  repo: string;
  path: string;
  /** The commit the claim cites. */
  pinned: string;
  /** The repository's default branch, and the head commit the brain read this passage at. */
  branch: string;
  head: string;
  state: AtHead["sources"][number]["state"];
  /** When the brain first read it in this state. */
  since: Stamp;
  /** When the brain last read every head. */
  read: Stamp;
}

/**
 * The reading for each of `c`'s sources, by source index. A recorded source counts only while the
 * claim still cites the same URL at that index and its repository's head was read, so a claim
 * revised since the last reading shows nothing for the sources it changed until the next one.
 */
export function atHeadOf(
  c: Pick<Claim, "id" | "sources">,
  reading: AtHead | null | undefined,
): AtHeadOf[] {
  if (!reading) return [];
  const heads = new Map(reading.heads.map((h) => [h.repo, h]));
  const out: AtHeadOf[] = [];
  for (const r of reading.sources) {
    if (r.claim !== c.id || c.sources[r.source]?.url !== r.url) continue;
    const p = pinnedGitHub(r.url);
    const h = p && heads.get(p.repo);
    if (!p || !h) continue;
    out.push({
      source: r.source,
      repo: p.repo,
      path: decodeURIComponent(p.path),
      pinned: p.commit,
      branch: h.branch,
      head: r.head,
      state: r.state,
      since: r.since,
      read: reading.read,
    });
  }
  return out.sort((a, b) => a.source - b.source);
}

/** GitHub's comparison of the cited commit with the head the brain read, for a passage that moved. */
export const compareUrl = (a: Pick<AtHeadOf, "repo" | "pinned" | "head">): string =>
  `https://github.com/${a.repo}/compare/${a.pinned}...${a.head}`;
