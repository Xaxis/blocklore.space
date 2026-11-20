// Retrieval over claims: BM25 with prefix and light fuzzy matching (MiniSearch). Ask the Brain's
// grounding and the site's search both use it, so an answer can only cite what search can find.
import MiniSearch from "minisearch";
import type { BundleClaim } from "./bundle.ts";
import { DEPTH_RANK, type Depth } from "./schema.ts";

export interface Hit {
  id: string;
  score: number;
}

interface Doc {
  id: string;
  statement: string;
  topics: string;
  where: string;
  locators: string;
}

const STOP = new Set(
  "a an and are as at be by does do for from how in is it of on or that the this to was what when where which who why will with can i my you your".split(
    " ",
  ),
);

export function buildIndex(claims: BundleClaim[]): MiniSearch<Doc> {
  const ms = new MiniSearch<Doc>({
    fields: ["statement", "topics", "where", "locators"],
    storeFields: [],
    // Words, numbers and underscores, so an opcode such as OP_RETURN stays one term.
    tokenize: (text) => text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean),
    processTerm: (t) => {
      const term = t.toLowerCase();
      return STOP.has(term) ? null : term;
    },
    searchOptions: {
      boost: { statement: 3, topics: 1.5, where: 1, locators: 0.5 },
      prefix: (term) => term.length > 3,
      fuzzy: (term) => (term.length > 5 ? 0.15 : false),
      combineWith: "OR",
    },
  });
  ms.addAll(
    claims.map((c) => ({
      id: c.id,
      statement: c.statement,
      topics: c.topics.join(" ").replaceAll("-", " "),
      where: c.shownIn.map((s) => s.title).join(" "),
      locators: c.sources.map((s) => `${s.title} ${s.locator}`).join(" "),
    })),
  );
  return ms;
}

/** The best claims for a query, current ones only, optionally capped at a reader's depth. */
export function searchClaims(
  index: MiniSearch<Doc>,
  claims: Record<string, BundleClaim>,
  query: string,
  opts: { limit?: number; maxDepth?: Depth } = {},
): Hit[] {
  const limit = opts.limit ?? 10;
  return index
    .search(query)
    .filter((r) => {
      const c = claims[r.id as string];
      if (!c || c.status === "superseded") return false;
      return opts.maxDepth ? DEPTH_RANK[c.depth] <= DEPTH_RANK[opts.maxDepth] : true;
    })
    .slice(0, limit)
    .map((r) => ({ id: r.id as string, score: r.score }));
}
