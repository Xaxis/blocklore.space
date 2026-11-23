import { claimSummary, edition, json } from "@/lib/api";
import { allClaims } from "@/lib/data";

export const dynamic = "force-static";

export function GET() {
  return json({ edition: edition(), claims: allClaims().map((c) => claimSummary(c)) });
}
