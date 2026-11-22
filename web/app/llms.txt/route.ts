import { CONFIDENCES, DEPTHS, STATUSES } from "@blocklore/core";
import { claimUrl, LICENSE, text, topicUrl } from "@/lib/api";
import { bundle, GROUPS, getClaim } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** The llms.txt index (llmstxt.org): what Blocklore is and where its machine-readable parts are. */
export function GET() {
  const topics = GROUPS.flatMap((g) => bundle.topics.filter((t) => t.group === g.id)).map(
    (t) => `- [${t.title}](${topicUrl(t.slug)}): ${getClaim(t.lede)?.statement ?? ""}`,
  );
  const body = `# ${SITE.name}

> ${SITE.promise} Every sentence is a claim with sources at exact locators, a short quote that code found at each link, and, where it can be, a check anyone can repeat against the chain or the code.

Claims carry a status (${STATUSES.join(", ")}), a confidence (${CONFIDENCES.join(", ")}) and a depth (${DEPTHS.join(", ")}). Contested positions are attributed to their proponents and dated; Blocklore does not take sides on value questions. Claims about safety, contested topics or named people wait for human review and are not published until approved. Cite a claim by its URL: ${claimUrl("<id>")}.

${LICENSE}

This edition was compiled at block ${bundle.generated.height} (${bundle.generated.time}) with ${bundle.stats.claims} claims.

## Topics

${topics.join("\n")}

## Machine access

- [All claims, full text](${SITE.url}/llms-full.txt): every published claim with its sources, grouped by topic
- [API](${SITE.url}/api/v1): JSON for claims, topics, changes since a block height, search and the BIP index
- [MCP server](${SITE.url}/mcp): Model Context Protocol over Streamable HTTP, read-only tools to search claims, read claims, topics, changes, BIPs and edition signatures; setup for each client at ${SITE.url}/connect
- [What it does not know](${SITE.url}/gaps): what Blocklore does not cover yet, by topic, what research takes next, and where readers suggest questions
- [Snapshots](${SITE.url}/verify): every claim's hash under a Merkle root, timestamped on Bitcoin with OpenTimestamps, and how to check them
- [Signing keys](${SITE.url}/verify/keys): who signs each edition with OrangeCheck, the owner's Bitcoin key behind the signing key, and how to check every signature offline
- [Claims as JSON Lines](${SITE.url}/exports/claims.jsonl): every claim's whole record, one per line
- [API documentation](${SITE.url}/about/api)

## How it works

- [What a claim is](${SITE.url}/about/claims): the schema, sources, checks and revisions
- [Editorial rules](${SITE.url}/about/editorial): voice, neutrality, depth and corrections
- [Sources](${SITE.url}/about/sources): what the brain reads and how it fetches

## Optional

- [Changes (Atom)](${SITE.url}/changes.xml): every claim published, corrected or refined
- [Daily digest](${SITE.url}/digest)
- [Research log](${SITE.url}/log): what each research run read, published and rejected
`;
  return text(body, "text/plain");
}
