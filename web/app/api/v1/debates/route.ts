import { debateSummary, edition, json } from "@/lib/api";
import { allDebates } from "@/lib/debates";

export const dynamic = "force-static";

/** Every debate map that keeps its rules, in brief, newest change first. */
export function GET() {
  return json({ edition: edition(), debates: allDebates().map(debateSummary) });
}
