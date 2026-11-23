// Topics proposed for the research agenda (brain/agenda/proposed.yaml). Research never reads them:
// the admin lists them under the agenda, and the owner adds one through the usual signed
// `agenda.save` command after reading and editing its brief. An entry that does not fit the
// agenda's schema is left out, never repaired.

import { parse } from "yaml";
import { AgendaTopic } from "./control.ts";

export function parseProposals(text: string): AgendaTopic[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return [];
  }
  const list = (doc as { topics?: unknown } | null)?.topics;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.flatMap((t) => {
    const r = AgendaTopic.safeParse(t);
    if (!r.success || seen.has(r.data.slug)) return [];
    seen.add(r.data.slug);
    return [r.data];
  });
}
