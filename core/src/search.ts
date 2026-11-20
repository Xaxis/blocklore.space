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
  name: string;
  topics: string;
  where: string;
  locators: string;
}

export const STOP = new Set(
  "a an and are as at be by does do for from how in is it of on or that the this to was what when where which who why will with can i my you your".split(
    " ",
  ),
);

export function buildIndex(claims: BundleClaim[]): MiniSearch<Doc> {
  const ms = new MiniSearch<Doc>({
    fields: ["statement", "name", "topics", "where", "locators"],
    storeFields: ["kind"],
    // Words, numbers and underscores, so an opcode such as OP_RETURN stays one term.
    tokenize: (text) => text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean),
    processTerm: (t) => {
      const term = t.toLowerCase();
      return STOP.has(term) ? null : term;
    },
    searchOptions: {
      boost: { statement: 3, name: 1.5, topics: 1.5, where: 1, locators: 0.5 },
      prefix: (term) => term.length > 3,
      fuzzy: (term) => (term.length > 5 ? 0.15 : false),
      combineWith: "OR",
    },
  });
  ms.addAll(
    claims.map((c) => ({
      id: c.id,
      statement: c.statement,
      // A claim's id names its subject in a few words (halvings-and-supply.coinbase-maturity).
      name: c.id.slice(c.id.indexOf(".") + 1).replaceAll("-", " "),
      kind: c.kind,
      topics: c.topics.join(" ").replaceAll("-", " "),
      where: c.shownIn.map((s) => s.title).join(" "),
      locators: c.sources.map((s) => `${s.title} ${s.locator}`).join(" "),
    })),
  );
  return ms;
}

/**
 * Words readers use for things the claims name otherwise, as a Bitcoin glossary would pair them.
 * Each match adds the store's terms to the query; nothing is removed.
 */
const SYNONYMS: [RegExp, string][] = [
  [/\b(block|mining|miner'?s?) rewards?\b|\brewards? per block\b/i, "subsidy"],
  [
    /\bnew(ly)? (issued |minted |created )?(coins|bitcoins?|btc)\b|\bissuance\b|\binflation\b|\bmonetary (policy|supply)\b/i,
    "subsidy circulation",
  ],
  [
    /\bdifficulty (adjust|chang)\w*|\bhow hard\b.*\bmin(e|ing)\b|\brebalanc\w*/i,
    "retarget target difficulty",
  ],
  [/\b(segwit|witness) discount\b/i, "witness weight units scale factor"],
  [/\b(fresh(ly)?|newly) mined\b|\bmined coins\b/i, "coinbase maturity"],
  [
    /\b(lost|burn(ed|t)?|destroyed|unspendable) (forever|coins|bitcoins?|btc)\b|\bcoins? (are |is )?(lost|burned|destroyed)\b|\blost forever\b/i,
    "unspendable unclaimed",
  ],
  [
    /\bcheat\w*|\b(old|earlier|outdated|previous) (balance|state|channel state)\b/i,
    "revocation revoked commitment penalty",
  ],
  [/\bforce[- ]clos\w*|\bunilateral(ly)? clos\w*/i, "to_self_delay commitment broadcast delay"],
  [
    /\bchange (address|output)\b|\b(went|goes|came|sent) back to\b|\bleft ?over\b/i,
    "change remainder outputs",
  ],
  [/\b(speed(s|ing)? up|stuck|unstick|confirm\w* faster|bump\w*)\b/i, "cpfp rbf replace fee bump"],
  [
    /\blast bitcoin\b|\bfinal (bitcoin|coin)\b|\bstops? (completely|for good)\b|\brun(s)? out\b/i,
    "subsidy zero",
  ],
];

export function expandQuery(query: string): string {
  const extra = SYNONYMS.filter(([re]) => re.test(query)).map(([, terms]) => terms);
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}

/** "What is X" questions want the definition first; other kinds still compete on their words. */
const DEFINITIONAL = /^\s*(what('s| is| are)|define|definition of|meaning of|what does .+ mean)\b/i;

/** The best claims for a query, current ones only, optionally capped at a reader's depth. */
export function searchClaims(
  index: MiniSearch<Doc>,
  claims: Record<string, BundleClaim>,
  query: string,
  opts: { limit?: number; maxDepth?: Depth } = {},
): Hit[] {
  const limit = opts.limit ?? 10;
  const definitional = DEFINITIONAL.test(query);
  return index
    .search(expandQuery(query), {
      boostDocument: (_id, _term, stored) =>
        definitional && stored?.kind === "definition" ? 1.6 : 1,
    })
    .filter((r) => {
      const c = claims[r.id as string];
      if (!c || c.status === "superseded") return false;
      return opts.maxDepth ? DEPTH_RANK[c.depth] <= DEPTH_RANK[opts.maxDepth] : true;
    })
    .slice(0, limit)
    .map((r) => ({ id: r.id as string, score: r.score }));
}
