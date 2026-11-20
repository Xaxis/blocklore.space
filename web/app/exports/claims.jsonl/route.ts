import { claimFull, text } from "@/lib/api";
import { allClaims } from "@/lib/data";

export const dynamic = "force-static";

/** Every published claim's whole record, one JSON object per line, in id order. */
export function GET() {
  const lines = allClaims()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => JSON.stringify(claimFull(c)));
  return text(`${lines.join("\n")}\n`, "application/jsonl");
}
