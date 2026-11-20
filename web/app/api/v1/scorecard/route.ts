import { askFingerprint } from "@blocklore/core";
import { edition, json } from "@/lib/api";
import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/**
 * The published scorecard (knowledge/bench.json), with the fingerprint of the Ask this build runs:
 * when `ask_now` equals `scorecard.ask.ask`, the answer scores came from this Ask.
 */
export function GET() {
  return json({
    edition: edition(),
    page: `${SITE.url}/scorecard`,
    golden: `${SITE.repo}/blob/main/brain/bench/golden.yaml`,
    ask_now: askFingerprint(),
    scorecard: bundle.scorecard,
  });
}
