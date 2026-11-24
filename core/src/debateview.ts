// A debate map (EDITORIAL.md, "Facts and values"; CLAIMS.md, "Debates"): the positions on one
// contested question, each position's stances and arguments attributed to who holds them, and the
// claims of fact and definition they rest on, marked so a reader sees which disagreements data
// could settle. A debate file holds a question, position labels, claim ids and edges; every other
// sentence a reader sees is a published claim. Two halves, both pure:
//
//   debateProblems  the rules a debate breaks against the claims as they stand. The publisher
//                   writes a debate only when it breaks none, and `brain check` reports them to the
//                   research role while it can still repair the file.
//   debateView      what the page, the API and the MCP tool show. Like a topic it is recomputed from
//                   the published claims: a node whose claim the owner withdrew drops out, and a
//                   debate that then breaks a rule is not shown.
import { loadedWords, samePlace } from "./evaluate.ts";
import type { GateTopic } from "./gate.ts";
import type { Claim, Confidence, Debate, Depth, Kind, Stamp, Status } from "./schema.ts";
import { styleIssues } from "./style.ts";

export const NATURES = ["value", "empirical", "definitional"] as const;
export type Nature = (typeof NATURES)[number];

/** The kinds of claim each nature of node takes. */
export const NATURE_KINDS: Record<Nature, readonly Kind[]> = {
  value: ["stance", "argument"],
  empirical: ["fact", "mechanism", "event", "trace"],
  definitional: ["definition"],
};

/** Every rule a debate keeps, by name, so a report names the one it breaks. */
export const DEBATE_RULES = [
  "published",
  "value node",
  "empirical node",
  "definitional node",
  "position",
  "edges",
  "every side",
  "own voice",
  "contested",
] as const;
export type DebateRule = (typeof DEBATE_RULES)[number];

/** What each rule asks of a debate, in plain words (CLAIMS.md, "Debate maps", lists the same). */
export const DEBATE_RULE_TEXT: Record<DebateRule, string> = {
  published: "every node is a published claim the owner has not withdrawn, named once",
  "value node": "a value node is a stance or an argument attributed to who holds it",
  "empirical node": "an empirical node is a fact, a mechanism, an event or a trace",
  "definitional node": "a definitional node is a definition",
  position:
    "every value node sits under one of the debate's positions; empirical and definitional nodes sit under none, as ground the sides share",
  edges: "every edge joins two nodes of this debate, never a node to itself, and appears once",
  "every side": "every position has at least one value node, so no side is left empty",
  "own voice":
    "the question and the position labels pass the style check, name no person and use no loaded word",
  contested: "at least one of the debate's topics is contested under the gate policy",
};

export interface DebateProblem {
  rule: DebateRule;
  /** What is wrong, in plain words. */
  detail: string;
  /** The node's claim, when the problem is one node's. */
  claim?: string;
}

/** What the rules read of a claim. */
export type DebateClaim = Pick<
  Claim,
  "id" | "statement" | "kind" | "status" | "people" | "attributed_to"
>;

/**
 * The loaded words of EDITORIAL.md's "Neutral words", all six. A debate is contested by its own
 * rule, so in its own words none of them is used in an uncontested sense.
 */
const DEBATE_LOADED = /\b(filter\w*|censor\w*|spam\w*|attack\w*|bloat\w*|ossif\w*)\b/gi;

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (name: string, flags: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${literal(name)}($|[^\\p{L}\\p{N}])`, `u${flags}`);

/**
 * Who a debate's own words could name: every person and holder the claims name, by full name in
 * any case, and each person's surname as written (so "Todd" is found and "towns" is not "Towns").
 */
function namePatterns(claims: Iterable<DebateClaim>): { name: string; re: RegExp }[] {
  const out = new Map<string, RegExp>();
  for (const c of claims) {
    for (const p of c.people) {
      out.set(p, phrase(p, "i"));
      const last = p.trim().split(/\s+/).pop() ?? "";
      if (last.length >= 3 && last !== p && /^\p{Lu}/u.test(last)) out.set(last, phrase(last, ""));
    }
    for (const a of c.attributed_to ?? []) out.set(a.name, phrase(a.name, "i"));
  }
  return [...out].map(([name, re]) => ({ name, re }));
}

/** Problems in one sentence of the debate's own voice: its question or a position's label. */
function voiceProblems(
  what: string,
  text: string,
  names: { name: string; re: RegExp }[],
): DebateProblem[] {
  const out: DebateProblem[] = [];
  for (const i of styleIssues(text)) out.push({ rule: "own voice", detail: `${what} ${i}` });
  const named = names.filter((n) => n.re.test(text)).map((n) => n.name);
  if (named.length)
    out.push({
      rule: "own voice",
      detail: `${what} names ${named.join(", ")}; a debate's own words name no person, and its claims say who holds what`,
    });
  const loaded = loadedWords(text, DEBATE_LOADED);
  if (loaded.length)
    out.push({
      rule: "own voice",
      detail: `${what} uses "${loaded.join('", "')}" in Blocklore's own voice; use the descriptive term, and leave loaded words to the claims that report who uses them`,
    });
  return out;
}

/**
 * Every rule `d` breaks against `claims` (the claims as they stand, keyed by id; a withdrawn claim
 * may be among them) and `flags` (the gate flags of the topics that exist, by slug; a topic not in
 * it counts as not contested). Empty means the debate may publish and show.
 */
export function debateProblems(
  d: Debate,
  claims: ReadonlyMap<string, DebateClaim>,
  flags: ReadonlyMap<string, GateTopic>,
): DebateProblem[] {
  const out: DebateProblem[] = [];
  const positions = new Set<string>();
  for (const p of d.positions) {
    if (positions.has(p.id))
      out.push({ rule: "position", detail: `position ${p.id} is listed twice` });
    positions.add(p.id);
  }

  const nodes = new Set<string>();
  const sides = new Map<string, number>();
  for (const n of d.nodes) {
    const id = n.claim;
    if (nodes.has(id)) {
      out.push({ rule: "published", detail: `${id} is a node twice`, claim: id });
      continue;
    }
    nodes.add(id);
    const c = claims.get(id);
    if (!c) out.push({ rule: "published", detail: `${id} is not a published claim`, claim: id });
    else if (c.status === "withdrawn")
      out.push({ rule: "published", detail: `the owner withdrew ${id}`, claim: id });
    else if (!NATURE_KINDS[n.nature].includes(c.kind))
      out.push({
        rule: `${n.nature} node`,
        detail: `${id} is a ${c.kind}, and a ${n.nature} node is ${
          n.nature === "value"
            ? "a stance or an argument"
            : n.nature === "empirical"
              ? "a fact, a mechanism, an event or a trace"
              : "a definition"
        }`,
        claim: id,
      });
    else if (n.nature === "value" && !c.attributed_to?.length)
      out.push({
        rule: "value node",
        detail: `${id} is not attributed to anyone; a value node says who holds it`,
        claim: id,
      });

    if (n.nature === "value") {
      if (!n.position)
        out.push({
          rule: "position",
          detail: `${id} is a value node under no position`,
          claim: id,
        });
      else if (!positions.has(n.position))
        out.push({
          rule: "position",
          detail: `${id} is under ${n.position}, which is not one of the debate's positions`,
          claim: id,
        });
      else if (c && c.status !== "withdrawn")
        sides.set(n.position, (sides.get(n.position) ?? 0) + 1);
    } else if (n.position)
      out.push({
        rule: "position",
        detail: `${id} is ${n.nature} and sits under ${n.position}; what evidence or a definition could settle is shared ground, and edges say which arguments it bears on`,
        claim: id,
      });
  }

  const seen = new Set<string>();
  for (const e of d.edges) {
    const key = `${e.from} ${e.rel} ${e.to}`;
    if (e.from === e.to)
      out.push({ rule: "edges", detail: `${e.from} ${e.rel} itself`, claim: e.from });
    else if (!nodes.has(e.from) || !nodes.has(e.to))
      out.push({
        rule: "edges",
        detail: `${e.from} ${e.rel} ${e.to}, and ${[e.from, e.to].filter((x) => !nodes.has(x)).join(" and ")} is not a node of this debate`,
      });
    else if (seen.has(key)) out.push({ rule: "edges", detail: `${key} is listed twice` });
    seen.add(key);
  }

  for (const p of d.positions)
    if (!sides.get(p.id))
      out.push({
        rule: "every side",
        detail: `position ${p.id} ("${p.label}") has no value node; every side is shown in its holders' words or the map does not publish`,
      });

  const names = namePatterns(claims.values());
  out.push(...voiceProblems("the question", d.question, names));
  for (const p of d.positions)
    out.push(...voiceProblems(`position ${p.id}'s label`, p.label, names));

  if (!d.topics.some((t) => flags.get(t)?.contested))
    out.push({
      rule: "contested",
      detail: `none of its topics (${d.topics.join(", ")}) is a contested topic; a debate map is for a question the gate policy marks contested`,
    });
  return out;
}

// --- the view ------------------------------------------------------------------------------------

/** Someone who holds a value node, with where they said it and the date the cited source gives. */
export interface DebateHolder {
  name: string;
  url: string | null;
  /** The `published` date of the cited source at the holder's link, when it has one. */
  stated: string | null;
}

export interface DebateNode {
  id: string;
  nature: Nature;
  /** The position a value node is under; null for shared ground. */
  position: string | null;
  statement: string;
  kind: Kind;
  status: Status;
  confidence: Confidence;
  depth: Depth;
  topics: string[];
  /** Who holds a value node; empty for the others. */
  holders: DebateHolder[];
  /** The node's place on the page, from 1: positions in order, then empirical, then definitional. */
  n: number;
  supports: string[];
  rebuts: string[];
  supportedBy: string[];
  rebuttedBy: string[];
}

export interface DebateView {
  slug: string;
  question: string;
  /** The debate's topics as written; a page links only the ones that are published. */
  topics: string[];
  /** Each position with its value nodes in order. */
  positions: { id: string; label: string; claims: string[] }[];
  /** Shared ground: claims evidence could settle, then claims about what a word means. */
  empirical: string[];
  definitional: string[];
  /** Every node in page order. */
  claims: string[];
  nodes: Record<string, DebateNode>;
  edges: Debate["edges"];
  /** The newest revision among its claims. */
  updated: Stamp;
}

/** What the view reads of a claim. */
export type DebateViewClaim = DebateClaim &
  Pick<Claim, "confidence" | "depth" | "topics" | "sources" | "revisions">;

function holders(c: DebateViewClaim): DebateHolder[] {
  return (c.attributed_to ?? []).map((a) => {
    const at = samePlace(a.url);
    const cited = at ? c.sources.find((s) => samePlace(s.url) === at && s.published) : undefined;
    return { name: a.name, url: a.url ?? null, stated: cited?.published ?? null };
  });
}

/**
 * The debate as a reader sees it, from the claims as they stand (`claims` holds every claim,
 * withdrawn ones too) and the published topics' gate flags. A node whose claim was withdrawn drops
 * out with its edges; `view` is null when what is left breaks any rule, with the problems.
 */
export function debateView(
  d: Debate,
  claims: ReadonlyMap<string, DebateViewClaim>,
  flags: ReadonlyMap<string, GateTopic>,
): { view: DebateView | null; problems: DebateProblem[] } {
  const gone = new Set(
    d.nodes.filter((n) => claims.get(n.claim)?.status === "withdrawn").map((n) => n.claim),
  );
  const kept: Debate = {
    ...d,
    nodes: d.nodes.filter((n) => !gone.has(n.claim)),
    edges: d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
  const problems = debateProblems(kept, claims, flags);
  if (problems.length) return { view: null, problems };

  const positions = kept.positions.map((p) => ({
    id: p.id,
    label: p.label,
    claims: kept.nodes.filter((n) => n.position === p.id).map((n) => n.claim),
  }));
  const empirical = kept.nodes.filter((n) => n.nature === "empirical").map((n) => n.claim);
  const definitional = kept.nodes.filter((n) => n.nature === "definitional").map((n) => n.claim);
  const order = [...positions.flatMap((p) => p.claims), ...empirical, ...definitional];
  const nature = new Map(kept.nodes.map((n) => [n.claim, n]));
  const from = (id: string, rel: "supports" | "rebuts") =>
    kept.edges.filter((e) => e.from === id && e.rel === rel).map((e) => e.to);
  const to = (id: string, rel: "supports" | "rebuts") =>
    kept.edges.filter((e) => e.to === id && e.rel === rel).map((e) => e.from);

  const nodes: Record<string, DebateNode> = {};
  let updated: Stamp | null = null;
  for (const [i, id] of order.entries()) {
    const c = claims.get(id) as DebateViewClaim;
    const n = nature.get(id) as Debate["nodes"][number];
    const last = c.revisions[c.revisions.length - 1]?.at;
    if (last && (!updated || last.time > updated.time)) updated = last;
    nodes[id] = {
      id,
      nature: n.nature,
      position: n.position ?? null,
      statement: c.statement,
      kind: c.kind,
      status: c.status,
      confidence: c.confidence,
      depth: c.depth,
      topics: c.topics,
      holders: n.nature === "value" ? holders(c) : [],
      n: i + 1,
      supports: from(id, "supports"),
      rebuts: from(id, "rebuts"),
      supportedBy: to(id, "supports"),
      rebuttedBy: to(id, "rebuts"),
    };
  }
  return {
    view: {
      slug: kept.slug,
      question: kept.question,
      topics: kept.topics,
      positions,
      empirical,
      definitional,
      claims: order,
      nodes,
      edges: kept.edges,
      updated: updated as Stamp,
    },
    problems: [],
  };
}
