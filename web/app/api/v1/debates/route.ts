import { debateSummary, edition, json, withdrawnDebateJson } from "@/lib/api";
import { allDebates, withdrawnDebates } from "@/lib/debates";

export const dynamic = "force-static";

/** Every debate map that keeps its rules, in brief, newest change first; then those withdrawn. */
export function GET() {
  return json({
    edition: edition(),
    debates: allDebates().map(debateSummary),
    withdrawn: withdrawnDebates().map(withdrawnDebateJson),
  });
}
