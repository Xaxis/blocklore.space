import "server-only";
import { bipView } from "@blocklore/core";
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

/** Every BIP number the index lists, each with a page at /proposals/<n>. */
export function bipNumbers(): number[] {
  return (bundle.bips?.bips ?? []).map((b) => b.n);
}

/** BIP `n` as Blocklore can show it (core/src/bipview.ts), or null when the index has no such BIP. */
export function getBip(n: number) {
  return bipView(bundle, n);
}

/**
 * A BIP number from a URL segment: digits as the index writes them, no leading zero, no sign, so
 * every BIP has exactly one address. Anything else is null.
 */
export function readBipNumber(raw: string): number | null {
  return /^(0|[1-9]\d{0,3})$/.test(raw) ? Number(raw) : null;
}

const listed = new Set(bipNumbers());

/** Blocklore's page for BIP `n`, or null when the index does not list it. */
export function bipHref(n: number): string | null {
  return listed.has(n) ? `/proposals/${n}` : null;
}
