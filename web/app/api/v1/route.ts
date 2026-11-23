import { edition, json, LICENSE } from "@/lib/api";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** The API's own description: what it serves and where. */
export function GET() {
  const u = `${SITE.url}/api/v1`;
  return json({
    name: "Blocklore API",
    version: "v1",
    about: SITE.promise,
    docs: `${SITE.url}/about/api`,
    edition: edition(),
    license: LICENSE,
    endpoints: {
      claims: `${u}/claims`,
      claim: `${u}/claims/{id}`,
      topics: `${u}/topics`,
      topic: `${u}/topics/{slug}`,
      claim_as_of: `${u}/claims/{id}?at={block height, or a UTC date YYYY-MM-DD}`,
      topic_as_of: `${u}/topics/{slug}?at={block height, or a UTC date YYYY-MM-DD}`,
      changes: `${u}/changes?since={height}&limit={1 to 500}`,
      search: `POST ${u}/search with {"q": text, "limit": 1 to 50}`,
      queue: `${u}/queue (GET: triaged reader suggestions; POST {"q"} to suggest a question for research)`,
      claim_reports: `${u}/claims/{id}/reports (GET: reader reports on a claim and their outcomes; POST {"kind", "note"?} to report a problem)`,
      reports: `${u}/reports`,
      bips: `${u}/bips`,
      bip: `${u}/bips/{n}`,
      export: `${SITE.url}/exports/claims.jsonl`,
      llms: `${SITE.url}/llms.txt`,
      mcp: `${SITE.url}/mcp`,
      snapshots: `${u}/snapshots`,
      gaps: `${u}/gaps`,
    },
  });
}
