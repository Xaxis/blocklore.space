// The owner's threat map in the admin (ADMIN.md, "Threat map"): what the page shows and the
// commands that link published claims to a threat (knowledge/security/threats/<id>.yaml).
//
//   view         the daemon builds it from its own checkout (brain/src/security/threatlinks.ts)
//                and sends it on its sync; the site keeps it in ctl:threats. Every threat by layer,
//                the claims each lists as what it is and as what defends against it, and code's
//                suggestions: published claims it does not list that name it (threatSuggestions).
//   commands     link a published claim to one of a threat's two lists, or unlink it. The site
//                checks each against the view the owner was shown, the daemon again against its
//                checkout (threatCommandProblem), and only the daemon's job writes the file.
//
// No model is involved: code suggests, the owner decides, and nothing is linked without a click.
// Pure: everything comes in as arguments.
import { z } from "zod";
import { claimId, slug } from "./schema.ts";
import { LAYERS, THREAT_STATUSES, type Threat, threatGaps } from "./security.ts";

/** A threat's two lists of claims: what it is, and what defends against it. */
export const THREAT_PARTS = ["claims", "mitigations"] as const;
export type ThreatPart = (typeof THREAT_PARTS)[number];

/** Each list as the page and the commits say it. */
export const PART_WORDS: Record<ThreatPart, string> = {
  claims: "what it is",
  mitigations: "what defends against it",
};

const link = {
  threat: slug,
  part: z.enum(THREAT_PARTS),
  claim: claimId,
};

/** The owner's two changes to the threat map's links, each a signed command the daemon runs as a job. */
export const THREAT_COMMANDS = [
  /** List a published claim under one of a threat's two lists, at its end. */
  z.strictObject({ type: z.literal("threat.link"), ...link }),
  /** Take a claim off one of a threat's two lists. */
  z.strictObject({ type: z.literal("threat.unlink"), ...link }),
] as const;

export type ThreatCommand = z.infer<(typeof THREAT_COMMANDS)[number]>;

export const THREAT_COMMAND_TYPES: ReadonlySet<string> = new Set(
  THREAT_COMMANDS.map((c) => c.shape.type.value),
);

export function isThreatCommand(cmd: { type: string }): cmd is ThreatCommand {
  return THREAT_COMMAND_TYPES.has(cmd.type);
}

// ---------------------------------------------------------------------------------------------
// Suggestions

/** At most this many suggestions per threat; the owner can link any other claim by its id. */
export const SUGGEST_MAX = 12;
/** Statements are cut to this many characters in the view. */
const STATEMENT_MAX = 400;

/** A published claim, as the suggestions and the view read it. */
export interface ThreatClaim {
  id: string;
  statement: string;
  topics: readonly string[];
}

/**
 * The phrases a claim can name a threat by: each of its terms (specific names by the threat map's
 * own rule, never a whole class), then its id's words ("replacement-cycling" gives "replacement
 * cycling"). Each once, whatever the case.
 */
export function threatPhrases(t: Pick<Threat, "id" | "terms">): string[] {
  const out: string[] = [];
  for (const p of [...t.terms, t.id.replace(/-/g, " ")]) {
    const words = p
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean)
      .join(" ");
    if (words && !out.some((x) => x.toLowerCase() === words.toLowerCase())) out.push(words);
  }
  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `text` names `phrase`: its words in order, as whole words, whatever the case, with any
 * spaces or hyphens between them and an optional plural "s" or "es" at the end. "BIP 30" matches
 * "bip 30" and "BIP-30" but not "BIP 300"; "eclipse attack" matches "eclipse attacks".
 */
export function namesPhrase(text: string, phrase: string): boolean {
  const words = phrase
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegex);
  if (!words.length) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${words.join("[\\s-]+")}(?:s|es)?(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

export interface ThreatSuggestion {
  id: string;
  statement: string;
  /** The phrase of the threat the statement names. */
  match: string;
  /** Whether the claim is filed under the threat's topic; the others come after. */
  onTopic: boolean;
}

/**
 * Code's suggestions for one threat: every published claim it does not list (in either list)
 * whose statement names one of its phrases (threatPhrases, namesPhrase). Claims filed under the
 * threat's topic first, then by id; at most SUGGEST_MAX. A claim on another topic is suggested too,
 * because a threat's topic is often one with nothing published yet while a claim elsewhere already
 * explains it (BIP 30's claims, filed under the UTXO model, explain duplicate transactions). Only
 * a suggestion: nothing is linked until the owner links it.
 */
export function threatSuggestions(
  t: Pick<Threat, "id" | "terms" | "topic" | "claims" | "mitigations">,
  claims: readonly ThreatClaim[],
): ThreatSuggestion[] {
  const listed = new Set([...t.claims, ...t.mitigations]);
  const phrases = threatPhrases(t);
  const out: ThreatSuggestion[] = [];
  for (const c of claims) {
    if (listed.has(c.id)) continue;
    const match = phrases.find((p) => namesPhrase(c.statement, p));
    if (match === undefined) continue;
    out.push({
      id: c.id,
      statement: c.statement,
      match,
      onTopic: c.topics.includes(t.topic),
    });
  }
  return out
    .sort((a, b) => Number(b.onTopic) - Number(a.onTopic) || a.id.localeCompare(b.id))
    .slice(0, SUGGEST_MAX);
}

// ---------------------------------------------------------------------------------------------
// The view

const statement = z.string().max(STATEMENT_MAX);

/** A claim a threat lists; `published` is false when it was withdrawn since. */
export const LinkedClaim = z.object({ id: claimId, statement, published: z.boolean() });
export type LinkedClaim = z.infer<typeof LinkedClaim>;

export const ThreatAdminThreat = z.object({
  id: slug,
  title: z.string().max(200),
  layer: z.string().max(40),
  topic: slug,
  status: z.enum(THREAT_STATUSES),
  claims: z.array(LinkedClaim).max(200),
  mitigations: z.array(LinkedClaim).max(200),
  /** The lists that have no published claim yet: the gap map's reading. */
  missing: z.array(z.enum(THREAT_PARTS)).max(2),
  suggestions: z
    .array(z.object({ id: claimId, statement, match: z.string().max(80), onTopic: z.boolean() }))
    .max(SUGGEST_MAX),
});
export type ThreatAdminThreat = z.infer<typeof ThreatAdminThreat>;

export const ThreatAdminView = z.object({
  /** The daemon's checkout the view was built from. */
  head: z.string().max(64),
  layers: z.array(z.object({ id: z.string(), label: z.string() })).max(20),
  /** Each layer's threats, those with a gap first, then by id. */
  threats: z.array(ThreatAdminThreat).max(500),
  /** Every published claim's id, so the page and the site can check a claim the owner types. */
  published: z.array(claimId).max(50_000),
  counts: z.object({ threats: z.number(), gaps: z.number(), suggestions: z.number() }),
});
export type ThreatAdminView = z.infer<typeof ThreatAdminView>;

const cut = (s: string) =>
  s.length > STATEMENT_MAX ? `${s.slice(0, STATEMENT_MAX - 3).trimEnd()}...` : s;

export function threatAdminView(input: {
  threats: readonly Threat[];
  /** The published claims: in the store and not withdrawn. */
  claims: readonly ThreatClaim[];
  /** Every claim the store has, withdrawn ones too, for the statements of what a threat lists. */
  all: readonly { id: string; statement: string }[];
  head: string;
}): ThreatAdminView {
  const published = new Set(input.claims.map((c) => c.id));
  const statements = new Map(input.all.map((c) => [c.id, c.statement]));
  const gaps = new Map(threatGaps([...input.threats], published).map((g) => [g.id, g.missing]));
  const linked = (ids: readonly string[]): LinkedClaim[] =>
    ids.map((id) => ({
      id,
      statement: cut(statements.get(id) ?? ""),
      published: published.has(id),
    }));
  const rank = (t: Threat) => LAYERS.findIndex((l) => l.id === t.layer);
  const threats = [...input.threats]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(gaps.has(b.id)) - Number(gaps.has(a.id)) ||
        a.id.localeCompare(b.id),
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      layer: t.layer,
      topic: t.topic,
      status: t.status,
      claims: linked(t.claims),
      mitigations: linked(t.mitigations),
      missing: gaps.get(t.id) ?? [],
      suggestions: threatSuggestions(t, input.claims).map((s) => ({
        ...s,
        statement: cut(s.statement),
      })),
    }));
  return {
    head: input.head,
    layers: LAYERS.map((l) => ({ id: l.id, label: l.label })),
    threats,
    published: [...published].sort(),
    counts: {
      threats: threats.length,
      gaps: gaps.size,
      suggestions: threats.reduce((n, t) => n + t.suggestions.length, 0),
    },
  };
}

/**
 * Why a command does not fit the threat map as this view shows it, or null when it does. The site
 * asks it of the view the owner was shown, the daemon of its checkout just before it edits the
 * file. A claim sits in at most one of a threat's lists, so moving it is an unlink, then a link.
 */
export function threatCommandProblem(cmd: ThreatCommand, view: ThreatAdminView): string | null {
  const t = view.threats.find((x) => x.id === cmd.threat);
  if (!t) return `There is no threat ${cmd.threat} on the map.`;
  const inPart = (part: ThreatPart) => t[part].some((c) => c.id === cmd.claim);
  if (cmd.type === "threat.unlink")
    return inPart(cmd.part)
      ? null
      : `${t.id} does not list ${cmd.claim} as ${PART_WORDS[cmd.part]}.`;
  if (inPart(cmd.part)) return `${t.id} already lists ${cmd.claim} as ${PART_WORDS[cmd.part]}.`;
  const other = cmd.part === "claims" ? "mitigations" : "claims";
  if (inPart(other))
    return `${t.id} lists ${cmd.claim} as ${PART_WORDS[other]}; unlink it there first.`;
  if (!view.published.includes(cmd.claim)) return `${cmd.claim} is not a published claim.`;
  return null;
}

/** The threat with one command applied, as plain data: what the edited file must parse to. */
export function applyThreatCommand(t: Threat, cmd: ThreatCommand): Threat {
  const list = t[cmd.part];
  return {
    ...t,
    [cmd.part]:
      cmd.type === "threat.link" ? [...list, cmd.claim] : list.filter((id) => id !== cmd.claim),
  };
}

/** The sentence a commit says for a command. */
export function threatCommandMessage(cmd: ThreatCommand): string {
  return cmd.type === "threat.link"
    ? `Link ${cmd.claim} to the threat ${cmd.threat} as ${PART_WORDS[cmd.part]}, as the owner asked in the admin, so the threat's page explains it with a published claim.`
    : `Unlink ${cmd.claim} from the threat ${cmd.threat} as ${PART_WORDS[cmd.part]}, as the owner asked in the admin, so the threat's page no longer cites it there.`;
}
