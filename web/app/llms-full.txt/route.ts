import { claimUrl, LICENSE, text, topicUrl } from "@/lib/api";
import { bundle, GROUPS, getClaim } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** Every published claim as Markdown, topic by topic and section by section, with its sources. */
export function GET() {
  const out: string[] = [
    `# ${SITE.name}: every published claim`,
    "",
    `> ${SITE.promise} Compiled at block ${bundle.generated.height} (${bundle.generated.time}). ${LICENSE}`,
    "",
    "Each claim: its statement, then status, confidence and depth, its URL, and its sources with the quote code found at each.",
  ];
  for (const t of GROUPS.flatMap((g) => bundle.topics.filter((x) => x.group === g.id))) {
    out.push("", `## ${t.title}`, "", topicUrl(t.slug));
    if (t.pendingReview)
      out.push(
        "",
        `${t.pendingReview} more claims on this topic wait for human review and are not shown.`,
      );
    for (const s of t.sections) {
      out.push("", `### ${s.title}`);
      for (const id of s.claims) {
        const c = getClaim(id);
        if (!c) continue;
        out.push(
          "",
          `- ${c.statement}`,
          `  ${c.status}, ${c.confidence} confidence, ${c.depth} depth. ${claimUrl(c.id)}`,
        );
        for (const src of c.sources) {
          const where = src.url ? ` <${src.url}>` : "";
          const quote = src.quote ? `: "${src.quote}"` : "";
          out.push(`  - ${src.tier} ${src.title}, ${src.locator}${where}${quote}`);
        }
      }
    }
  }
  return text(`${out.join("\n")}\n`, "text/plain");
}
