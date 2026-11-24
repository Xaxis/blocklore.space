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
  advisorySummary,
  cveCheck,
  findThreat,
  labReport,
  layerLabel,
  listThreats,
  threatAdvisories,
  threatLab,
  watchReading,
  watchReadings,
} from "@blocklore/core/threatmap";
import { z } from "zod";
import {
  allTopics,
  bipJson,
  bipsWithCitations,
  changes,
  claimAtJson,
  claimById,
  claimSummary,
  debateJson,
  debateSummary,
  edition,
  isTopic,
  LICENSE,
  readQuery,
  searchClaims,
  signalingJson,
  topicAtJson,
  topicBySlug,
  withdrawnDebateJson,
} from "./api";
import { LATEST, readAsOf } from "./asof";
import { getClaim } from "./data";
import { allDebates, getDebate, getWithdrawnDebate } from "./debates";
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
      "Change events newest first: claims created, revised, corrected or superseded, each stamped with the block height and time it was published at. Give since_height to see only what changed after that block, and topic to see one topic's changes.",
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
      topic: z
        .string()
        .max(64)
        .optional()
        .describe("Only events filed under this topic slug, as list_topics gives them"),
    }),
    run: ({ since_height, limit, topic }) =>
      topic !== undefined && !isTopic(topic)
        ? { ok: false, error: `No topic ${topic}. list_topics gives every slug.` }
        : {
            ok: true,
            data: {
              edition: edition(),
              events: changes({ since: since_height, limit: limit ?? 50, topic }),
            },
          },
  }),
  defineTool({
    name: "get_bip",
    title: "Get a BIP",
    description:
      "One Bitcoin Improvement Proposal as Blocklore's page for it shows it (url), the same as GET /api/v1/bips/{n}: its title, layer, type and status as the bitcoin/bips index lists them at a pinned commit, a link to its text at that commit (owners are named there), every change Blocklore has seen in its index entry, the published claims that cite it in brief (marks says which are contested, stances or arguments: positions attributed to the people in attributed_to, never Blocklore's own view), how those claims group by topic and depth, and implementations: the code and pull requests those claims cite, nothing without such a claim.",
    input: z.strictObject({
      number: z.number().int().min(0).max(9999).describe("The BIP number, e.g. 341"),
    }),
    run: ({ number }) => {
      const bip = bipJson(number);
      if (!bip)
        return {
          ok: false,
          error: bips
            ? `BIP ${number} is not in the index at the commit Blocklore read (${bips.commit.slice(0, 10)}). list_bips lists every BIP it has.`
            : "The BIP index has not been read yet.",
        };
      return { ok: true, data: { edition: edition(), ...bip } };
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
    name: "signaling",
    title: "Version bits",
    description:
      "The version bits blocks set in the current difficulty period and the last, the same as GET /api/v1/signaling: the newest block counted (height, hash, time); each period's counts (blocks counted of 2016, with BIP 9's top bits 001, per deployment bit 0 to 12, setting any of BIP 320's general purpose bits 13 to 28, which are no signal, and without the prefix); a row per deployment bit any block set, with its share of the blocks counted; and the deployments Bitcoin Core's mainnet chainparams defines at a pinned commit, the only source of a bit's name. Counts and shares only: Blocklore never says whether a proposal will activate.",
    input: z.strictObject({}),
    run: () => {
      const signaling = signalingJson();
      return signaling
        ? { ok: true, data: { edition: edition(), signaling } }
        : { ok: false, error: "The brain has not counted a period's version bits yet." };
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
      "Blocklore's security map: every known way Bitcoin can be attacked, by layer, each with its live status (defended, watching or open), how many published claims explain it and its defenses, its advisories, the watches and lab tests that cover it, and the advisories not yet on any threat. Give id for one threat in full: its claims and mitigations in brief with urls to cite, its public record, the projects' advisories filed under it (each with the rule that filed it and, for a match by words, the words), its CVE ids checked against NVD (exists, what NVD says it affects, since when, any disagreement), its watches' readings and its lab results on each maintained Bitcoin Core release (ok null where that release's run did not have the test). Nothing undisclosed is ever here.",
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
              advisories: threatAdvisories(t),
              nvd: t.cves.map(cveCheck),
              watches: security.watches
                .filter((w) => t.watches.includes(w.id))
                .map((w) => watchReading(w)),
              lab: threatLab(t, security),
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
          advisories: advisorySummary(security),
        },
      };
    },
  }),
  defineTool({
    name: "watches",
    title: "Security watches",
    description:
      "The security watches' current readings, from public chain and network data: mining pool concentration, long gaps between blocks, odd block timestamps, difficulty adjustments, chain reorganizations, new security advisories and nodes on unmaintained versions. Each has its status (ok, elevated, alert or unknown), its value and unit, when it was read, its documented thresholds and source, and a short history. With them, the lab: Bitcoin Core's own tests of known attacks run in regtest against the newest release of each major version Bitcoin Core maintains, and libsecp256k1's own test programs (named secp256k1/tests and so on) built from the copy each release ships, newest first, each with when it ran, whether its download matched SHA256SUMS and how many builder signatures were good, and each test's result. Only runs that passed, or that the owner released, are here.",
    input: z.strictObject({
      id: z.enum(WATCH_IDS).optional().describe("Only this watch"),
    }),
    run: ({ id }) => ({
      ok: true,
      data: {
        edition: edition(),
        updated: security.updated,
        watches: watchReadings(security, id ? [id] : undefined),
        lab: labReport(security),
      },
    }),
  }),
  defineTool({
    name: "debates",
    title: "Debate maps",
    description:
      "Maps of contested Bitcoin questions, the same as GET /api/v1/debates. Without slug, every published map in brief: its question, its positions and how many claims each holds. With slug, one map whole: each position with its stances and arguments in brief (nature value), each attributed in holders to who holds it, with a link and the date the cited source gives; the shared ground both sides meet, as claims evidence could settle (nature empirical) and claims about what a word means (nature definitional); and edges saying which claim supports or rebuts which. The question and the position labels are the map's only words of its own; every other sentence is a published claim to cite by its url. Blocklore takes no side on a question of values: report each position as its holders' view.",
    input: z.strictObject({
      slug: slug.optional().describe("A debate map's slug from the list; every map if left out"),
    }),
    run: ({ slug }) => {
      if (slug === undefined)
        return {
          ok: true,
          data: {
            edition: edition(),
            url: `${SITE.url}/debates`,
            debates: allDebates().map(debateSummary),
          },
        };
      const d = getDebate(slug);
      const w = d ? undefined : getWithdrawnDebate(slug);
      if (w)
        return {
          ok: true,
          data: {
            edition: edition(),
            note: "The owner withdrew this map; do not cite it as current.",
            debate: withdrawnDebateJson(w),
          },
        };
      if (!d)
        return {
          ok: false,
          error: `No published debate map has the slug ${slug}. Call debates without a slug for the list; a map publishes only once every claim in it has passed the evaluator.`,
        };
      return { ok: true, data: { edition: edition(), license: LICENSE, debate: debateJson(d) } };
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
    "Contested claims are attributed to their proponents; Blocklore does not declare a winner on a question of values. Claims on contested subjects, safety advice, stances and named people are served only after the evaluator passes them: every quote and check again, the editorial rules, and two verifiers on different models. The owner can withdraw any claim; a withdrawal is a revision, never an edit.",
    "list_changes says what changed since a block height. Every answer names its edition: the block height the store was compiled at and the build.",
    "get_topic and get_claim take at, a past block height or UTC date, and answer exactly as Blocklore stated it then, with what changed since.",
    "signaling counts the version bits blocks set this difficulty period and the last, from two explorers that must agree; counts and shares only, never a forecast of activation.",
    "get_signatures says who signed each snapshot edition and whether the owner's Bitcoin key stood behind the signing key then, with commands that check it offline.",
    "threats and watches give the security map: every known attack on Bitcoin with what explains and defends against it, and the watches' current readings with their thresholds.",
    "debates maps contested questions: each position's stances and arguments, attributed and dated, and the claims of fact and definition the sides share, so you can tell which disagreements evidence could settle and which are about values.",
    "Never send seed phrases, keys, addresses or other secrets. Inputs that look like them are refused and not kept.",
  ].join("\n\n"),
  tools,
};
