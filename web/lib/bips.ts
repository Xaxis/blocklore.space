import "server-only";
import type { BipRow } from "@/components/BipTable";
import { bundle, getClaim } from "./data";

/** Every BIP in the index with the published claims that cite it. */
export function bipRows(): BipRow[] {
  return (bundle.bips?.bips ?? []).map((b) => ({
    ...b,
    cites: (bundle.bipCitations[b.n] ?? []).flatMap((id) => {
      const c = getClaim(id);
      return c ? [{ id, statement: c.statement }] : [];
    }),
  }));
}
