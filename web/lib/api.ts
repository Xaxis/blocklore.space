import "server-only";
import {
  type AsOf,
  asOfPath,
  type BundleClaim,
  type BundleTopic,
  bipSignaling,
  bitRows,
  buildIndex,
  CHAINPARAMS,
  type ChangeEvent,
  DEPLOYMENT_BITS,
  type DebateView,
  deploymentUrl,
  detectSecrets,
  GENERAL_MASK,
  PERIOD,
  PREFIX,
  PREFIX_MASK,
  searchClaims as rank,
  SECRET_LABEL,
  SIGNALING_SOURCE,
} from "@blocklore/core";
import { asOfJson, changesSince, claimAt, topicAt } from "./asof";
import { getBip } from "./bips";
import { allClaims, bundle, getClaim, getTopic, getWithdrawn } from "./data";
import { debateTopics } from "./debates";
import { BUILD, SITE } from "./site";

// The machine surfaces (/api/v1, /mcp, /exports, /llms.txt) all read through here, so a claim looks
// the same to every client. Read-only: nothing here writes or remembers a request.

export const LICENSE =
  "The store is CC BY 4.0: credit Blocklore and link each claim's URL (https://creativecommons.org/licenses/by/4.0/). Quotes inside sources belong to their authors and are included as citations. The code is MIT.";

export function edition() {
  return { generated: bundle.generated, build: BUILD, claims: bundle.stats.claims };
}

export const claimUrl = (id: string, a?: AsOf) =>
  `${SITE.url}/claims/${id}${a ? `/at/${asOfPath(a)}` : ""}`;
export const topicUrl = (slug: string, a?: AsOf) =>
  `${SITE.url}/topics/${slug}${a ? `/at/${asOfPath(a)}` : ""}`;

/** A claim in brief; at a moment, its url is the page that shows it as it stood then. */
export function claimSummary(c: BundleClaim, a?: AsOf) {
  return {
    id: c.id,
    url: claimUrl(c.id, a),
    statement: c.statement,
    kind: c.kind,
    topics: c.topics,
    depth: c.depth,
    status: c.status,
    confidence: c.confidence,
    last_verified: c.last_verified,
    sources: c.sources.length,
    checks: c.checks?.length ?? 0,
  };
}

/** The whole public record of a claim: sources with quotes, checks, every revision. */
export function claimFull(c: BundleClaim, a?: AsOf) {
  const { hashes: _hashes, ...rest } = c;
  return { ...rest, url: claimUrl(c.id, a) };
}

export function topicSummary(t: BundleTopic) {
  return {
    slug: t.slug,
    url: topicUrl(t.slug),
    title: t.title,
    group: t.group,
    lede: getClaim(t.lede)?.statement ?? null,
    contested: t.contested,
    safety: t.safety,
    claims: t.claimCount,
    pending_review: t.pendingReview,
    updated: t.updated,
  };
}

export function topicFull(t: BundleTopic) {
  return {
    ...topicSummary(t),
    sections: t.sections.map((s) => ({
      id: s.id,
      title: s.title,
      depth: s.depth,
      claims: s.claims.flatMap((id) => {
        const c = getClaim(id);
        return c ? [claimSummary(c)] : [];
      }),
    })),
    ladder: t.ladder,
  };
}

export function topicBySlug(slug: string) {
  const t = getTopic(slug);
  return t ? topicFull(t) : null;
}

export function allTopics() {
  return bundle.topics.map(topicSummary);
}

/** Whether a slug names a published topic. */
export function isTopic(slug: string): boolean {
  return bundle.topics.some((t) => t.slug === slug);
}

/** A published claim, or a withdrawn one (status withdrawn, with its withdrawal), by id. */
export function claimById(id: string) {
  const c = getClaim(id) ?? getWithdrawn(id);
  return c ? claimFull(c) : null;
}

/**
 * A claim as Blocklore stated it at a past moment, with the revisions it has had since; null when
 * there is no such claim, `{ before }` when it was not published yet then.
 */
export function claimAtJson(id: string, a: AsOf) {
  const c = claimAt(id, a);
  if (c === undefined) return null;
  if (c === null) return { before: getClaim(id)?.first_seen ?? getWithdrawn(id)?.first_seen };
  const later = changesSince(id, a);
  return {
    as_of: asOfJson(a, claimUrl(id, a)),
    claim: claimFull(c, a),
    since: {
      current: claimUrl(id),
      revisions: later.map((e) => ({ rev: e.rev, change: e.change, at: e.at, note: e.note })),
    },
  };
}

/**
 * A topic as it stood at a past moment: its sections with each claim as it stood, the ladder of
 * those claims, and the ids of claims added, revised and withdrawn since. Null for no such topic.
 */
export function topicAtJson(slug: string, a: AsOf) {
  const t = topicAt(slug, a);
  if (!t) return null;
  return {
    as_of: asOfJson(a, topicUrl(slug, a)),
    topic: {
      slug,
      url: topicUrl(slug, a),
      title: t.topic.title,
      group: t.topic.group,
      lede: t.lede?.statement ?? null,
      contested: t.topic.contested,
      safety: t.topic.safety,
      claims: t.claims.length,
      updated: t.updated,
      sections: t.sections.map((s) => ({
        id: s.id,
        title: s.title,
        depth: s.depth,
        claims: s.claims.map((c) => claimSummary(c, a)),
      })),
      ladder: t.ladder,
    },
    since: { current: topicUrl(slug), ...t.since },
  };
}

/** Change events newest first, optionally only those stamped after block `since`. */
export function changes(
  opts: { since?: number; limit?: number; topic?: string } = {},
): ChangeEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return [...bundle.events]
    .filter((e) => opts.since === undefined || e.at.height > opts.since)
    .filter((e) => opts.topic === undefined || e.topics.includes(opts.topic))
    .sort((a, b) => b.at.time.localeCompare(a.at.time) || a.claim.localeCompare(b.claim))
    .slice(0, limit);
}

let index: ReturnType<typeof buildIndex> | null = null;

/**
 * Reader text arrives here. It is refused, without being echoed or kept, when it looks like a seed,
 * a key or an address (SECURITY.md), and limited to 200 characters.
 */
export function readQuery(q: string | null): { query: string } | { error: string } {
  const query = (q ?? "").trim();
  if (!query) return { error: "Give a query with q, for example ?q=taproot+key+path." };
  if (query.length > 200) return { error: "Queries are limited to 200 characters." };
  const secrets = detectSecrets(query);
  if (secrets.length)
    return {
      error: `That looks like ${secrets.map((s) => SECRET_LABEL[s.kind]).join(" and ")}. Blocklore never accepts seeds, keys or addresses, and it did not keep this query. If it is real, treat it as exposed.`,
    };
  return { query };
}

/** Current claims for a query, best first (core/src/search.ts, the same ranking the MCP tool uses). */
export function searchClaims(query: string, limit = 10) {
  index ??= buildIndex(allClaims());
  return rank(index, bundle.claims, query, { limit: Math.min(Math.max(limit, 1), 50) }).flatMap(
    (h) => {
      const c = getClaim(h.id);
      return c ? [{ score: Math.round(h.score * 1000) / 1000, ...claimSummary(c) }] : [];
    },
  );
}

export const bipUrl = (n: number) => `${SITE.url}/proposals/${n}`;
const hex = (x: number) => `0x${(x >>> 0).toString(16).padStart(8, "0")}`;

/**
 * The version bits blocks set this difficulty period and the last, as /proposals shows them: the
 * newest block counted, each period's counts (blocks, with BIP 9's prefix, per bit 0 to 12, setting
 * any of BIP 320's bits 13 to 28, without the prefix), a row per deployment bit any block set with
 * its share, the rules with their BIPs, and the deployments Bitcoin Core's mainnet chainparams
 * defines at the pinned commit. Counts and shares only. Null before the brain has counted a period.
 */
export function signalingJson() {
  const s = bundle.signaling;
  if (!s) return null;
  return {
    url: `${SITE.url}/proposals#version-bits`,
    source: SIGNALING_SOURCE,
    period: PERIOD,
    updated: s.updated,
    tip: s.tip,
    current: s.current,
    previous: s.previous,
    rows: bitRows(s),
    rules: {
      bip9: {
        url: bipUrl(9),
        prefix_mask: hex(PREFIX_MASK),
        prefix: hex(PREFIX),
        deployment_bits: Array.from({ length: DEPLOYMENT_BITS }, (_, i) => i),
      },
      bip320: { url: bipUrl(320), mask: hex(GENERAL_MASK), bits: "13 to 28" },
    },
    chainparams: {
      release: CHAINPARAMS.release,
      commit: CHAINPARAMS.commit,
      file: CHAINPARAMS.file,
      deployments: CHAINPARAMS.deployments.map((d) => ({
        name: d.name,
        bit: d.bit,
        bips: d.bips,
        start: d.start,
        url: deploymentUrl(d),
      })),
    },
  };
}

/**
 * One BIP as its page shows it: the index entry at the commit it was read at, with its text there;
 * every change seen to the entry; the claims citing it in brief, each with its marks (contested,
 * stance, argument) and who it is attributed to; how they group by topic and depth; and the code
 * those claims cite. Null when the index does not list it.
 */
export function bipJson(n: number) {
  const v = getBip(n);
  if (!v) return null;
  return {
    url: bipUrl(n),
    commit: v.commit,
    read: v.read,
    index: v.index,
    bip: {
      ...v.entry,
      url: v.text,
      cited_by: v.claims.flatMap((id) => {
        const c = getClaim(id);
        if (!c) return [];
        return [
          {
            ...claimSummary(c),
            marks: v.marks[id] ?? [],
            ...(c.attributed_to?.length ? { attributed_to: c.attributed_to } : {}),
          },
        ];
      }),
    },
    changes: v.history,
    topics: v.topics.map((t) => ({
      slug: t.slug,
      title: t.title,
      url: t.title === null ? null : topicUrl(t.slug),
      depths: t.depths,
    })),
    implementations: v.implementations,
    signaling: signalingOfBip(n),
  };
}

/**
 * What BIP `n`'s page shows of the version bits: for BIP 9 and BIP 320, which define them, where
 * the whole tally is; for a BIP whose deployment chainparams defines, its bit's row; else null.
 */
function signalingOfBip(n: number) {
  const b = bipSignaling(n, bundle.signaling);
  if (!b) return null;
  return {
    url: `${SITE.url}/api/v1/signaling`,
    scheme: b.scheme,
    tip: bundle.signaling?.tip ?? null,
    deployments: b.deployments,
  };
}

export const debateUrl = (slug: string) => `${SITE.url}/debates/${slug}`;

const debateHead = (d: DebateView) => ({
  slug: d.slug,
  url: debateUrl(d.slug),
  question: d.question,
  topics: debateTopics(d).map((t) => ({ ...t, url: topicUrl(t.slug) })),
  claims: d.claims.length,
  updated: d.updated,
});

/** A debate map in brief, as `GET /api/v1/debates` lists it. */
export function debateSummary(d: DebateView) {
  return {
    ...debateHead(d),
    positions: d.positions.map((p) => ({ id: p.id, label: p.label, claims: p.claims.length })),
    empirical: d.empirical.length,
    definitional: d.definitional.length,
  };
}

/**
 * One debate map as its page shows it: each position with its stances and arguments in brief, who
 * holds each and when the cited source says they said it; the shared ground (claims evidence could
 * settle, then claims about what a word means); and every edge between them. The question and the
 * labels are the debate's only words of its own; every other sentence is a published claim.
 */
export function debateJson(d: DebateView) {
  const node = (id: string) => {
    const n = d.nodes[id];
    const c = getClaim(id);
    if (!n || !c) return [];
    return [
      {
        ...claimSummary(c),
        nature: n.nature,
        position: n.position,
        holders: n.holders,
        supports: n.supports,
        rebuts: n.rebuts,
        supported_by: n.supportedBy,
        rebutted_by: n.rebuttedBy,
      },
    ];
  };
  return {
    ...debateHead(d),
    positions: d.positions.map((p) => ({
      id: p.id,
      label: p.label,
      claims: p.claims.flatMap(node),
    })),
    shared: {
      empirical: d.empirical.flatMap(node),
      definitional: d.definitional.flatMap(node),
    },
    edges: d.edges,
  };
}

export function bipsWithCitations() {
  const idx = bundle.bips;
  if (!idx) return null;
  return {
    commit: idx.commit,
    read: idx.read,
    bips: idx.bips.map((b) => ({
      ...b,
      url: b.file ? `https://github.com/bitcoin/bips/blob/${idx.commit}/${b.file}` : null,
      cited_by: bundle.bipCitations[b.n] ?? [],
    })),
    changes: idx.changes,
  };
}

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** A JSON answer. `sMaxAge` lets the CDN keep a per-request answer too (a new deploy clears it). */
export function json(
  data: unknown,
  init: { status?: number; maxAge?: number; sMaxAge?: number } = {},
) {
  const shared = init.sMaxAge === undefined ? "" : `, s-maxage=${init.sMaxAge}`;
  return new Response(`${JSON.stringify(data, null, 1)}\n`, {
    status: init.status ?? 200,
    headers: {
      ...HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${init.maxAge ?? 300}${shared}`,
    },
  });
}

export function text(body: string, type: string) {
  return new Response(body, {
    headers: {
      ...HEADERS,
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
