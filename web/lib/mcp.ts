import "server-only";
import {
  claimId,
  DEPTHS,
  defineTool,
  LAYERS,
  type LayerId,
  type McpServer,
  OC_IDENTITY,
  slug,
  THREAT_STATUSES,
  WATCH_IDS,
} from "@blocklore/core";
import {
  findThreat,
  layerLabel,
  listThreats,
  watchReading,
  watchReadings,
} from "@blocklore/core/threatmap";
import { z } from "zod";
import {
  allTopics,
  bipsWithCitations,
  changes,
  claimAtJson,
  claimById,
  claimSummary,
  edition,
  LICENSE,
  readQuery,
  searchClaims,
  topicAtJson,
  topicBySlug,
} from "./api";
import { LATEST, readAsOf } from "./asof";
import { getClaim } from "./data";
import { ocCommand, recordUrl, SIGNATURE_MEANS, signing } from "./orangecheck";
import { security } from "./security";
import { BUILD, SITE } from "./site";

// The tools /mcp offers. Each reads through lib/api.ts, so an agent sees the same claim, url and
// edition as the JSON API; core/src/mcp.ts speaks the protocol and refuses secrets before any tool
// runs.

const notFound = (what: string) =>
  `${what} Claims held for closer checks are not served until they pass; search_claims and list_topics show what is published.`;

const bips = bipsWithCitations();
const statuses = [...new Set(bips?.bips.map((b) => b.status) ?? [])].sort();
const layers = [...new Set(bips?.bips.flatMap((b) => (b.layer ? [b.layer] : [])) ?? [])].sort();
const oneOf = (values: string[]) =>
  values.length ? z.enum(values as [string, ...string[]]) : z.string();

/** The time machine's argument: a past block height or UTC date, parsed by lib/asof.ts. */
const at = z
  .union([z.string().max(40), z.number().int().min(0)])
  .optional()
  .describe(
    `A past moment, to see it exactly as Blocklore stated it then: a block height up to ${LATEST.height} (e.g. 976771) or a UTC date YYYY-MM-DD up to ${LATEST.time.slice(0, 10)}, meaning the end of that day. Leave out for now.`,
  );

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
      "One published claim's whole record: the statement, its status and confidence, every source with its tier, locator and exact quote, the checks against the chain and the code, and every revision with what it said before. Cite its url. A claim the owner withdrew comes back with status withdrawn and why: do not cite it as current. Give at (a block height or a UTC date) for the claim exactly as it stood then, with its hash then and the revisions it has had since.",
    input: z.strictObject({
      id: claimId.describe("A claim id, <topic>.<slug>, e.g. taproot.activation-height"),
      at,
    }),
    run: ({ id, at }) => {
      if (at !== undefined) {
        const moment = readAsOf(String(at));
        if ("error" in moment) return { ok: false, error: moment.error };
        const past = claimAtJson(id, moment.asOf);
        if (!past) return { ok: false, error: notFound(`No published claim has the id ${id}.`) };
        if ("before" in past)
          return {
            ok: false,
            error: `${id} was not published yet at that moment: it was first published at block ${past.before?.height}, ${past.before?.time}.`,
          };
        const withdrawn = past.claim.withdrawal
          ? `Withdrawn by then, on ${past.claim.withdrawal.at.time.slice(0, 10)}: ${past.claim.withdrawal.note}`
          : undefined;
        return { ok: true, data: { edition: edition(), license: LICENSE, withdrawn, ...past } };
      }
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
    description: `One topic's sections in reading order, each claim in brief with its depth (${DEPTHS.join(", ")}: from a first look to the specification), and the topic's concept to code ladder of sources. Give at (a block height or a UTC date) for the topic exactly as Blocklore stated it then: claims published later are absent, each claim is the revision in force then, and since lists the claims added, revised and withdrawn after it.`,
    input: z.strictObject({
      slug: slug.describe("A topic slug from list_topics, e.g. taproot"),
      at,
    }),
    run: ({ slug, at }) => {
      if (at !== undefined) {
        const moment = readAsOf(String(at));
        if ("error" in moment) return { ok: false, error: moment.error };
        const past = topicAtJson(slug, moment.asOf);
        if (!past) return { ok: false, error: notFound(`No topic has the slug ${slug}.`) };
        return { ok: true, data: { edition: edition(), ...past } };
      }
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
  defineTool({
    name: "get_signatures",
    title: "Get signatures",
    description:
      "Who signed each snapshot edition, with OrangeCheck: the publisher key's BIP-322 stamp over the snapshot file, whether the owner's Bitcoin key (attested for dns:blocklore.space) had delegated to that key at the time, any revocation, the record files and the commands that check each piece offline. Give snapshot for one edition.",
    input: z.strictObject({
      snapshot: z
        .number()
        .int()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe("One snapshot's number; every edition if left out"),
    }),
    run: ({ snapshot }) => {
      const s = signing();
      const editions =
        snapshot === undefined ? s.editions : s.editions.filter((e) => e.n === snapshot);
      if (snapshot !== undefined && !editions.length)
        return { ok: false, error: `There is no snapshot ${snapshot}.` };
      const a = s.attestation;
      return {
        ok: true,
        data: {
          edition: edition(),
          means: SIGNATURE_MEANS,
          publisher: s.publisher,
          owner: a && {
            address: a.address,
            identity: OC_IDENTITY,
            attestation_id: a.attestation_id,
            issued_at: a.issued_at,
            record: recordUrl.attestation(a.attestation_id),
            domain_proof: recordUrl.wellKnown,
            check: ocCommand.attestation(a.attestation_id),
          },
          delegations: s.delegations.map((d) => ({
            id: d.record.id,
            principal: d.record.principal.address,
            agent: d.record.agent.address,
            scopes: d.record.scopes,
            issued_at: d.record.issued_at,
            expires_at: d.record.expires_at,
            status: d.status,
            revoked: d.revocation && { at: d.revocation.signed_at, by: d.revokedBy },
            record: recordUrl.delegation(d.record.id),
            check: ocCommand.delegation(d.record.id),
          })),
          editions: editions.map((e) => ({
            n: e.n,
            signature: e.signature && {
              ...e.signature,
              file: recordUrl.stamp(e.n),
              check: ocCommand.stamp(e.n),
            },
          })),
          check_all: ocCommand.chain(editions[0]?.n ?? 1),
          how_to_verify: `${SITE.url}/verify/keys`,
        },
      };
    },
  }),
  defineTool({
    name: "threats",
    title: "Security threats",
    description:
      "Blocklore's security map: every known way Bitcoin can be attacked, by layer, each with its live status (defended, watching or open), how many published claims explain it and its defenses, the watches and lab tests that cover it. Give id for one threat in full: its claims and mitigations in brief with urls to cite, its public record, its watches' readings and its lab results. Nothing undisclosed is ever here.",
    input: z.strictObject({
      id: slug.optional().describe("A threat id from the list, e.g. time-warp"),
      layer: z
        .enum(LAYERS.map((l) => l.id) as [LayerId, ...LayerId[]])
        .optional()
        .describe(
          `Only threats in this layer: ${LAYERS.map((l) => `${l.id} (${l.label})`).join(", ")}`,
        ),
      status: z.enum(THREAT_STATUSES).optional().describe("Only threats with this live status"),
    }),
    run: ({ id, layer, status }) => {
      if (id) {
        const t = findThreat(security, id);
        if (!t)
          return {
            ok: false,
            error: `No threat on the map has the id ${id}. Call threats without an id for the list.`,
          };
        const brief = (ids: string[]) =>
          ids.flatMap((c) => {
            const claim = getClaim(c);
            return claim ? [claimSummary(claim)] : [];
          });
        return {
          ok: true,
          data: {
            edition: edition(),
            threat: {
              id: t.id,
              url: `${SITE.url}/security/${t.id}`,
              title: t.title,
              layer: t.layer,
              layer_label: layerLabel(t.layer),
              status: t.live,
              owner_status: t.status,
              raised_by: t.raisedBy,
              missing: t.missing,
              claims: brief(t.published.claims),
              mitigations: brief(t.published.mitigations),
              history: t.history,
              watches: security.watches
                .filter((w) => t.watches.includes(w.id))
                .map((w) => watchReading(w)),
              lab: t.lab.map((name) => {
                const r = t.results.find((x) => x.name === name);
                return r ? { ...r } : { name, ok: null, version: null, at: null };
              }),
            },
          },
        };
      }
      return {
        ok: true,
        data: {
          edition: edition(),
          url: `${SITE.url}/security`,
          ...listThreats(security, { layer, status }),
        },
      };
    },
  }),
  defineTool({
    name: "watches",
    title: "Security watches",
    description:
      "The security watches' current readings, from public chain and network data: mining pool concentration, long gaps between blocks, odd block timestamps, difficulty adjustments, chain reorganizations, new security advisories and nodes on unmaintained versions. Each has its status (ok, elevated, alert or unknown), its value and unit, when it was read, its documented thresholds and source, and a short history.",
    input: z.strictObject({
      id: z.enum(WATCH_IDS).optional().describe("Only this watch"),
    }),
    run: ({ id }) => ({
      ok: true,
      data: {
        edition: edition(),
        updated: security.updated,
        watches: watchReadings(security, id ? [id] : undefined),
      },
    }),
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
    "get_topic and get_claim take at, a past block height or UTC date, and answer exactly as Blocklore stated it then, with what changed since.",
    "get_signatures says who signed each snapshot edition and whether the owner's Bitcoin key stood behind the signing key then, with commands that check it offline.",
    "threats and watches give the security map: every known attack on Bitcoin with what explains and defends against it, and the watches' current readings with their thresholds.",
    "Never send seed phrases, keys, addresses or other secrets. Inputs that look like them are refused and not kept.",
  ].join("\n\n"),
  tools,
};
