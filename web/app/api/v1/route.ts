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
      changes: `${u}/changes?since={height}&limit={1 to 500}`,
      search: `POST ${u}/search with {"q": text, "limit": 1 to 50}`,
      ask: `POST ${u}/ask with {"q": question, "depth": "curious" | "user" | "holder" | "builder" | "researcher"}`,
      queue: `${u}/queue (GET: triaged questions; POST {"q", "ticket", "missing"} from an Ask answer)`,
      bips: `${u}/bips`,
      export: `${SITE.url}/exports/claims.jsonl`,
      llms: `${SITE.url}/llms.txt`,
      mcp: `${SITE.url}/mcp`,
      snapshots: `${u}/snapshots`,
    },
  });
}
