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
  const sealed = bundle.snapshots.reduce<number | null>(
    (h, x) => (h === null || x.at.height > h ? x.at.height : h),
    null,
  );
  const body = `# ${SITE.name}

> ${SITE.promise} Every sentence is a claim with sources at exact locators, a short quote that code found at each link, and, where it can be, a check anyone can repeat against the chain or the code.

Claims carry a status (${STATUSES.join(", ")}), a confidence (${CONFIDENCES.join(", ")}) and a depth (${DEPTHS.join(", ")}). Contested positions are attributed to their proponents and dated; Blocklore does not take sides on value questions. Claims about safety, contested topics or named people get closer checks (every source fetched again, rules from the editorial policy, and two verifiers on different models that must both accept) and are not published until they pass; the owner can withdraw any claim. Cite a claim by its URL: ${claimUrl("<id>")}.

${LICENSE}

This edition was compiled at block ${bundle.generated.height} (${bundle.generated.time}) with ${bundle.stats.claims} claims.

## Topics

${topics.join("\n")}

## Machine access

- [All claims, full text](${SITE.url}/llms-full.txt): every published claim with its sources, grouped by topic
- [API](${SITE.url}/api/v1): JSON for claims, topics, changes since a block height or on one topic, any claim or topic as it stood at a past block height or date (?at=), search and the BIP index
- [Version bits](${SITE.url}/api/v1/signaling): the version bits blocks set this difficulty period and the last, read from two explorers that must agree on every block: counts and shares per BIP 9 deployment bit, BIP 320's general purpose bits apart, never a forecast; shown at ${SITE.url}/proposals#version-bits
- [MCP server](${SITE.url}/mcp): Model Context Protocol over Streamable HTTP, read-only tools to search claims, read claims, topics, changes, BIPs, the version bits this period, edition signatures, the security threat map and its watches, and debate maps; setup for each client at ${SITE.url}/connect
- [Debate maps](${SITE.url}/debates): contested questions with each position's stances and arguments, attributed and dated, and the claims of fact and definition the sides share; JSON at ${SITE.url}/api/v1/debates
- [What it does not know](${SITE.url}/gaps): what Blocklore does not cover yet, by topic, what research takes next, and where readers suggest questions
- [Snapshots](${SITE.url}/verify): every claim's hash under a Merkle root, timestamped on Bitcoin with OpenTimestamps, and how to check them
- [Signatures](${SITE.url}/verify/keys): who signs each edition with OrangeCheck, the owner's Bitcoin key behind the signing key, and how to check every signature offline
- [Security](${SITE.url}/security): known threats to Bitcoin by layer, what defends against each, live watches on the chain and the network, and a lab that runs each Bitcoin Core release's own attack tests in regtest
- [Evaluator](${SITE.url}/verify/evaluator): how claims that need closer checks are decided, the test claims it caught, and every withdrawal
- [Claims as JSON Lines](${SITE.url}/exports/claims.jsonl): every claim's whole record, one per line
- [API documentation](${SITE.url}/about/api)

## How it works

- [What a claim is](${SITE.url}/about/claims): the schema, sources, checks and revisions
- [Editorial rules](${SITE.url}/about/editorial): voice, neutrality, depth and corrections
- [Sources](${SITE.url}/about/sources): what the brain reads and how it fetches

## Optional

- [Changes (Atom)](${SITE.url}/changes.xml): every claim published, corrected or refined; each topic has its own at /topics/{slug}/changes.xml
- Changes after a moment: every change after a block height or a UTC date, at ${SITE.url}/changes/since/{height or YYYY-MM-DD}${sealed ? `; since the last sealed edition, [${SITE.url}/changes/since/${sealed}](${SITE.url}/changes/since/${sealed})` : ""}
- [Daily digest](${SITE.url}/digest)
- [Research log](${SITE.url}/log): what each research run read, published and rejected
`;
  return text(body, "text/plain");
}
