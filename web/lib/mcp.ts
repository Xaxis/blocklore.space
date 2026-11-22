import "server-only";
import { claimId, DEPTHS, defineTool, type McpServer, slug } from "@blocklore/core";
import { z } from "zod";
import {
  allTopics,
  bipsWithCitations,
  changes,
  claimById,
  claimSummary,
  edition,
  LICENSE,
  readQuery,
  searchClaims,
  topicBySlug,
} from "./api";
import { getClaim } from "./data";
import { BUILD, SITE } from "./site";

// The tools /mcp offers. Each reads through lib/api.ts, so an agent sees the same claim, url and
// edition as the JSON API; core/src/mcp.ts speaks the protocol and refuses secrets before any tool
// runs.

const notFound = (what: string) =>
  `${what} Claims held for human review are not served until the owner approves them; search_claims and list_topics show what is published.`;

const bips = bipsWithCitations();
const statuses = [...new Set(bips?.bips.map((b) => b.status) ?? [])].sort();
const layers = [...new Set(bips?.bips.flatMap((b) => (b.layer ? [b.layer] : [])) ?? [])].sort();
const oneOf = (values: string[]) =>
  values.length ? z.enum(values as [string, ...string[]]) : z.string();

const tools = [
  defineTool({
    name: "search_claims",
    title: "Search claims",
    description:
      "Find published Bitcoin claims by words, best first (BM25 with prefix matching; opcodes such as OP_RETURN are one term). Each result is a claim in brief with its url to cite; call get_claim for its sources, quotes and checks. Superseded claims are left out.",
    input: z.strictObject({
      query: z.string().min(1).max(200).describe("Words to look for, e.g. taproot key path spend"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("How many results, 1 to 50; 10 if left out"),
    }),
    run: ({ query, limit }) => {
      const q = readQuery(query);
      if ("error" in q) return { ok: false, error: q.error };
      return {
        ok: true,
        data: { edition: edition(), query: q.query, results: searchClaims(q.query, limit ?? 10) },
      };
    },
  }),
  defineTool({
    name: "get_claim",
    title: "Get a claim",
    description:
      "One published claim's whole record: the statement, its status and confidence, every source with its tier, locator and exact quote, the checks against the chain and the code, and every revision with what it said before. Cite its url. A claim the owner withdrew comes back with status withdrawn and why: do not cite it as current.",
    input: z.strictObject({
      id: claimId.describe("A claim id, <topic>.<slug>, e.g. taproot.activation-height"),
    }),
    run: ({ id }) => {
      const claim = claimById(id);
      if (!claim) return { ok: false, error: notFound(`No published claim has the id ${id}.`) };
      const withdrawn = claim.withdrawal
        ? `Withdrawn on ${claim.withdrawal.at.time.slice(0, 10)}: ${claim.withdrawal.note} It is no longer part of Blocklore's current knowledge.`
        : undefined;
      return { ok: true, data: { edition: edition(), license: LICENSE, withdrawn, claim } };
    },
  }),
  defineTool({
    name: "list_topics",
    title: "List topics",
    description:
      "Every published topic with its slug, title, group, lede, how many claims it shows and how many wait for review. Contested and safety topics are marked.",
    input: z.strictObject({}),
    run: () => ({ ok: true, data: { edition: edition(), topics: allTopics() } }),
  }),
  defineTool({
    name: "get_topic",
    title: "Get a topic",
    description: `One topic's sections in reading order, each claim in brief with its depth (${DEPTHS.join(", ")}: from a first look to the specification), and the topic's concept to code ladder of sources.`,
    input: z.strictObject({
      slug: slug.describe("A topic slug from list_topics, e.g. taproot"),
    }),
    run: ({ slug }) => {
      const topic = topicBySlug(slug);
      if (!topic) return { ok: false, error: notFound(`No published topic has the slug ${slug}.`) };
      return { ok: true, data: { edition: edition(), topic } };
    },
  }),
  defineTool({
    name: "list_changes",
    title: "List changes",
    description:
      "Change events newest first: claims created, revised, corrected or superseded, each stamped with the block height and time it was published at. Give since_height to see only what changed after that block.",
    input: z.strictObject({
      since_height: z
        .number()
        .int()
        .min(0)
        .max(100_000_000)
        .optional()
        .describe("Only events published after this block height"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("How many events, 1 to 500; 50 if left out"),
    }),
    run: ({ since_height, limit }) => ({
      ok: true,
      data: { edition: edition(), events: changes({ since: since_height, limit: limit ?? 50 }) },
    }),
  }),
  defineTool({
    name: "get_bip",
    title: "Get a BIP",
    description:
      "One Bitcoin Improvement Proposal as the bitcoin/bips index lists it at a pinned commit: title, layer, type, status, a link to its text at that commit, the published claims that cite it, and every change Blocklore has seen in its index entry.",
    input: z.strictObject({
      number: z.number().int().min(0).max(9999).describe("The BIP number, e.g. 341"),
    }),
    run: ({ number }) => {
      const bip = bips?.bips.find((b) => b.n === number);
      if (!bips || !bip)
        return {
          ok: false,
          error: `BIP ${number} is not in the index at the commit Blocklore read.`,
        };
      return {
        ok: true,
        data: {
          edition: edition(),
          commit: bips.commit,
          bip: {
            ...bip,
            cited_by: bip.cited_by.flatMap((id) => {
              const c = getClaim(id);
              return c ? [claimSummary(c)] : [];
            }),
          },
          changes: bips.changes.filter((c) => c.n === number),
        },
      };
    },
  }),
  defineTool({
    name: "list_bips",
    title: "List BIPs",
    description:
      "The BIP index at a pinned commit, optionally only one status or layer, each BIP with its link at that commit and the ids of the claims citing it.",
    input: z.strictObject({
      status: oneOf(statuses).optional().describe("Only BIPs with this status"),
      layer: oneOf(layers).optional().describe("Only BIPs in this layer"),
    }),
    run: ({ status, layer }) => {
      if (!bips) return { ok: false, error: "The BIP index has not been read yet." };
      return {
        ok: true,
        data: {
          edition: edition(),
          commit: bips.commit,
          bips: bips.bips.filter(
            (b) => (!status || b.status === status) && (!layer || b.layer === layer),
          ),
        },
      };
    },
  }),
];

export const MCP_SERVER: McpServer = {
  name: "blocklore",
  title: "Blocklore",
  version: BUILD,
  websiteUrl: SITE.url,
  ttlMs: 300_000,
  instructions: [
    `${SITE.name}: ${SITE.promise}`,
    "Every statement is a claim with sources, each source carrying an exact quote that was found at its link, and many claims carry checks against the chain or Bitcoin Core's code that anyone can rerun. Use search_claims or list_topics to find claims and get_claim for their evidence, and cite each claim by its url.",
    "Contested claims are attributed to their proponents; Blocklore does not declare a winner on a question of values. Claims on contested topics, safety advice and named people are not served until a person has reviewed them.",
    "list_changes says what changed since a block height. Every answer names its edition: the block height the store was compiled at and the build.",
    "Never send seed phrases, keys, addresses or other secrets. Inputs that look like them are refused and not kept.",
  ].join("\n\n"),
  tools,
};
