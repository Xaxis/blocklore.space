// One BIP as Blocklore can show it from its own record: the index entry at the commit it was read
// at, the changes the brain has seen to that entry, the published claims that cite the BIP's text
// grouped by topic and depth, the code and pull requests those claims cite, and what Bitcoin
// Core's own list of the BIPs it implements (doc/bips.md) says of it, in Core's words. Nothing here
// is written about a BIP; every field is the index's, Core's or a published claim's. Pure: the compiled
// bundle comes in as an argument.
import {
  type BipChange,
  type BipEntry,
  type BipIndex,
  type Claim,
  type CoreBipChange,
  type CoreBips,
  DEPTHS,
  type Depth,
  type Stamp,
} from "./schema.ts";

const BIPS_REPO = "https://github.com/bitcoin/bips/blob";
const CORE_REPO = "https://github.com/bitcoin/bitcoin";

/** The BIP a source's link points into (bitcoin/bips' `bip-NNNN.mediawiki` or `.md`), or null. */
export function bipOf(url: string | undefined): number | null {
  const m = url ? /\/bip-(\d{4})\.(?:mediawiki|md)/.exec(url) : null;
  return m ? Number(m[1]) : null;
}

/** How a claim citing a BIP is marked, so a reader never takes it for Blocklore's own view. */
export type ClaimMark = "contested" | "stance" | "argument";

export function claimMarks(c: Pick<Claim, "kind" | "status">): ClaimMark[] {
  const marks: ClaimMark[] = [];
  if (c.status === "contested") marks.push("contested");
  if (c.kind === "stance" || c.kind === "argument") marks.push(c.kind);
  return marks;
}

/** Source kinds that put a BIP in code: a file at a commit, a commit, a pull request. */
export const IMPLEMENTATION_KINDS = ["code", "commit", "pr"] as const;
type ImplementationKind = (typeof IMPLEMENTATION_KINDS)[number];

export interface BipImplementation {
  title: string;
  url: string;
  kind: ImplementationKind;
  /** `org/repo` from the link, when it is on GitHub. */
  repo: string | null;
  /** The claims citing this BIP that cite this code too, in `claims` order: why the line exists. */
  claims: string[];
}

export interface BipTopicGroup {
  slug: string;
  /** The topic's title, or null when no published topic has the slug. */
  title: string | null;
  /** Shallow to deep; only depths with claims. */
  depths: { depth: Depth; claims: string[] }[];
}

export interface BipView {
  /** The entry as the index states it at `commit`. */
  entry: BipEntry;
  commit: string;
  /** When and at what block the brain last read the index. */
  read: Stamp;
  /** The BIP's text at `commit`; null while the index lists only an allocated number. */
  text: string | null;
  /** The index itself at `commit`. */
  index: string;
  /** Every change the brain has seen to this entry, oldest first. */
  history: BipChange[];
  /** Every published claim citing the BIP, in the order the groups list them. */
  claims: string[];
  topics: BipTopicGroup[];
  /** Claims citing the BIP that are contested, stances or arguments, and how. */
  marks: Record<string, ClaimMark[]>;
  /** Code and pull requests that claims citing the BIP cite; nothing without such a claim. */
  implementations: BipImplementation[];
  /** What Bitcoin Core's doc/bips.md says of the BIP, or null when it does not name it. */
  core: BipInCore | null;
}

/** Bitcoin Core's own entry for a BIP, as doc/bips.md states it at `commit`. */
export interface BipInCore {
  /** Core's words; an entry may cover several BIPs, as Taproot's covers 340, 341 and 342. */
  text: string;
  /** The other BIPs the same entry names. */
  with: number[];
  /** The first version the entry names, as Core writes it. */
  since: string | null;
  prs: { n: number; url: string }[];
  commit: string;
  read: Stamp;
  /** The entry's line in doc/bips.md at `commit`. */
  url: string;
  /** Every change the brain has seen to Core's words for this BIP, oldest first. */
  history: CoreBipChange[];
}

/** BIP `n` in Core's list, or null. A BIP named by two entries shows the first. */
export function bipInCore(list: CoreBips | null | undefined, n: number): BipInCore | null {
  if (!list) return null;
  const e = list.entries.find((x) => x.bips.includes(n));
  const history = list.changes.filter((c) => c.n === n);
  if (!e) return null;
  return {
    text: e.text,
    with: e.bips.filter((x) => x !== n),
    since: e.since ?? null,
    prs: e.prs.map((p) => ({ n: p, url: `${CORE_REPO}/pull/${p}` })),
    commit: list.commit,
    read: list.read,
    url: `${CORE_REPO}/blob/${list.commit}/doc/bips.md#L${e.line}`,
    history,
  };
}

/** What bipView reads from the compiled bundle. */
export interface BipViewInput {
  bips: BipIndex | null;
  coreBips?: CoreBips | null;
  bipCitations: Record<number, string[]>;
  claims: Record<string, Claim>;
  topics: { slug: string; title: string; sections: { claims: string[] }[] }[];
}

function repoOf(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/#?]+)/.exec(url);
  return m ? (m[1] as string) : null;
}

/** BIP `n` as Blocklore can show it, or null when the index at its commit does not list it. */
export function bipView(b: BipViewInput, n: number): BipView | null {
  const idx = b.bips;
  const entry = idx?.bips.find((x) => x.n === n);
  if (!idx || !entry) return null;

  const cited = (b.bipCitations[n] ?? []).flatMap((id) => {
    const c = b.claims[id];
    return c ? [c] : [];
  });

  // Reading order: a claim's place in its primary topic's sections, then its id.
  const topicOf = new Map(b.topics.map((t, i) => [t.slug, { t, i }]));
  const place = new Map<string, number>();
  for (const t of b.topics) {
    let k = 0;
    for (const s of t.sections)
      for (const id of s.claims)
        if (!place.has(`${t.slug} ${id}`)) place.set(`${t.slug} ${id}`, k++);
  }
  const byTopic = new Map<string, Claim[]>();
  for (const c of cited) {
    const slug = c.topics[0] as string;
    byTopic.set(slug, [...(byTopic.get(slug) ?? []), c]);
  }
  const order = (slug: string, c: Claim) => place.get(`${slug} ${c.id}`) ?? Number.MAX_SAFE_INTEGER;
  const topics: BipTopicGroup[] = [...byTopic.entries()]
    .sort(
      ([a, ca], [z, cz]) =>
        cz.length - ca.length ||
        (topicOf.get(a)?.i ?? Number.MAX_SAFE_INTEGER) -
          (topicOf.get(z)?.i ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(z),
    )
    .map(([slug, list]) => ({
      slug,
      title: topicOf.get(slug)?.t.title ?? null,
      depths: DEPTHS.map((depth) => ({
        depth,
        claims: list
          .filter((c) => c.depth === depth)
          .sort((x, y) => order(slug, x) - order(slug, y) || x.id.localeCompare(y.id))
          .map((c) => c.id),
      })).filter((d) => d.claims.length > 0),
    }));

  const marks: Record<string, ClaimMark[]> = {};
  for (const c of cited) {
    const m = claimMarks(c);
    if (m.length) marks[c.id] = m;
  }

  const code = new Map<string, BipImplementation>();
  for (const c of cited)
    for (const s of c.sources) {
      if (!s.url || s.supports === "background") continue;
      if (!(IMPLEMENTATION_KINDS as readonly string[]).includes(s.kind)) continue;
      const key = s.url.split("#")[0] as string;
      const item = code.get(key) ?? {
        title: s.title,
        url: s.url,
        kind: s.kind as ImplementationKind,
        repo: repoOf(s.url),
        claims: [],
      };
      if (!item.claims.includes(c.id)) item.claims.push(c.id);
      code.set(key, item);
    }
  const claims = topics.flatMap((t) => t.depths.flatMap((d) => d.claims));
  const rank = new Map(claims.map((id, i) => [id, i]));
  for (const item of code.values())
    item.claims.sort((x, y) => (rank.get(x) ?? 0) - (rank.get(y) ?? 0));

  return {
    entry,
    commit: idx.commit,
    read: idx.read,
    text: entry.file ? `${BIPS_REPO}/${idx.commit}/${entry.file}` : null,
    index: `${BIPS_REPO}/${idx.commit}/README.mediawiki`,
    history: idx.changes
      .filter((c) => c.n === n)
      .map((c, i) => ({ c, i }))
      .sort((x, y) => x.c.at.time.localeCompare(y.c.at.time) || x.i - y.i)
      .map(({ c }) => c),
    claims,
    topics,
    marks,
    implementations: [...code.values()].sort(
      (x, y) => y.claims.length - x.claims.length || x.title.localeCompare(y.title),
    ),
    core: bipInCore(b.coreBips, n),
  };
}
