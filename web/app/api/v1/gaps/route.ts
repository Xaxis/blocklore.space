import { edition, json } from "@/lib/api";
import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** The gap map: what the published store does not cover yet, by topic, most open gaps first. */
export function GET() {
  return json({ edition: edition(), page: `${SITE.url}/gaps`, gaps: bundle.gaps });
}
