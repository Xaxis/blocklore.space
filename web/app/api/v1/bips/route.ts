import { bipsWithCitations, edition, json } from "@/lib/api";

export const dynamic = "force-static";

export function GET() {
  return json({ edition: edition(), index: bipsWithCitations() });
}
