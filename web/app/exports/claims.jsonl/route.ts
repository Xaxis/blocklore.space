import { claimFull, text } from "@/lib/api";
import { allClaims, allWithdrawn } from "@/lib/data";

export const dynamic = "force-static";

/**
 * Every published claim's whole record, one JSON object per line, in id order; withdrawn claims too,
 * with status withdrawn and their withdrawal, so a mirror learns to drop them.
 */
export function GET() {
  const lines = [...allClaims(), ...allWithdrawn()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => JSON.stringify(claimFull(c)));
  return text(`${lines.join("\n")}\n`, "application/jsonl");
}
