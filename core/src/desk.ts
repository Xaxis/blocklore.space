// The Safety Desk (EDITORIAL.md, "Safety Desk"): the threats to a person who holds bitcoin,
// organized by threat model (what you hold, who can learn that you hold it, where you live and
// travel) rather than as one checklist for everyone, and the scam patterns. It holds titles and
// threat ids only: every sentence a reader sees is a published claim the threat map links to the
// threat (knowledge/security/threats/<id>.yaml), as what it is or as what defends against it.
// The owner links them from the admin's Threat map; a threat with nothing linked reads "being
// researched" and stays on the gap map until it is explained. Pure.
import type { SecurityView, Threat, ThreatView } from "./security.ts";

/** One threat model, and the threats on the map it answers to, in the order the desk shows them. */
export interface DeskModel {
  id: string;
  title: string;
  /** The question a reader asks of their own situation; a heading, not a claim. */
  question: string;
  threats: readonly string[];
}

export const DESK: readonly DeskModel[] = [
  {
    id: "what-you-hold",
    title: "What you hold",
    question: "Your keys, the software that holds them and the payments you make",
    threats: [
      "weak-randomness",
      "wallet-malware",
      "tampered-binaries",
      "address-errors",
      "fee-overpayment",
    ],
  },
  {
    id: "who-knows",
    title: "Who can learn that you hold it",
    question: "What the chain and the network reveal about you",
    threats: ["transaction-origin", "dust-attack"],
  },
  {
    id: "where-you-are",
    title: "Where you live and travel",
    question: "Threats in person, not online",
    threats: ["physical-coercion"],
  },
  {
    id: "scams",
    title: "Scam patterns",
    question: "How each scam works, its tells, and what defends against it",
    threats: ["phishing", "investment-scams", "address-poisoning", "fake-wallet-software"],
  },
];

/** Every threat id the desk shows, once each. */
export const DESK_THREATS: readonly string[] = DESK.flatMap((m) => m.threats);

/** What is wrong with the desk against the threat map: a threat it names that the map lacks, or one it names twice. */
export function deskIssues(
  threats: readonly Pick<Threat, "id">[],
): { file: string; level: "error"; where: string; message: string }[] {
  const ids = new Set(threats.map((t) => t.id));
  const seen = new Set<string>();
  const out: { file: string; level: "error"; where: string; message: string }[] = [];
  for (const m of DESK)
    for (const id of m.threats) {
      if (!ids.has(id))
        out.push({
          file: "core/src/desk.ts",
          level: "error",
          where: m.id,
          message: `names ${id}, which is not on the threat map`,
        });
      if (seen.has(id))
        out.push({
          file: "core/src/desk.ts",
          level: "error",
          where: m.id,
          message: `names ${id} twice`,
        });
      seen.add(id);
    }
  return out;
}

export interface DeskSection extends Omit<DeskModel, "threats"> {
  threats: ThreatView[];
}

export interface DeskView {
  models: DeskSection[];
  /** Threats on the desk, and how many have both what they are and what defends against them. */
  counts: { threats: number; explained: number; claims: number };
}

/** The desk over the compiled security view: each model with its threats as the map has them now. */
export function deskView(view: SecurityView): DeskView {
  const byId = new Map(view.layers.flatMap((l) => l.threats).map((t) => [t.id, t]));
  const models = DESK.map((m) => ({
    id: m.id,
    title: m.title,
    question: m.question,
    threats: m.threats.flatMap((id) => {
      const t = byId.get(id);
      return t ? [t] : [];
    }),
  }));
  const all = models.flatMap((m) => m.threats);
  return {
    models,
    counts: {
      threats: all.length,
      explained: all.filter((t) => t.missing.length === 0).length,
      claims: all.reduce(
        (n, t) => n + t.published.claims.length + t.published.mitigations.length,
        0,
      ),
    },
  };
}
