import "server-only";
import { boltView } from "@blocklore/core";
import { bundle, getClaim } from "./data";

export interface BoltRow {
  n: number;
  title: string;
  file: string;
  cites: { id: string; statement: string }[];
  /** How many changes the brain has seen to it since its first reading. */
  changes: number;
}

/** Every BOLT BOLT #0 lists, with the published claims that cite it. */
export function boltRows(): BoltRow[] {
  const idx = bundle.bolts;
  return (idx?.bolts ?? []).map((b) => ({
    n: b.n,
    title: b.title,
    file: b.file,
    changes: idx?.changes.filter((c) => c.n === b.n).length ?? 0,
    cites: (bundle.boltCitations[b.n] ?? []).flatMap((id) => {
      const c = getClaim(id);
      return c ? [{ id, statement: c.statement }] : [];
    }),
  }));
}

/** Every BOLT number BOLT #0 lists, each with a page at /bolts/<n>. */
export function boltNumbers(): number[] {
  return (bundle.bolts?.bolts ?? []).map((b) => b.n);
}

/** BOLT `n` as Blocklore can show it (core/src/boltview.ts), or null when BOLT #0 lists no such BOLT. */
export function getBolt(n: number) {
  return boltView(bundle, n);
}

/**
 * A BOLT number from a URL segment: digits with no leading zero, so every BOLT has one address
 * (/bolts/2, never /bolts/02). Anything else is null.
 */
export function readBoltNumber(raw: string): number | null {
  return /^(0|[1-9]\d?)$/.test(raw) ? Number(raw) : null;
}

const listed = new Set(boltNumbers());

/** Blocklore's page for BOLT `n`, or null when BOLT #0 does not list it. */
export function boltHref(n: number): string | null {
  return listed.has(n) ? `/bolts/${n}` : null;
}
