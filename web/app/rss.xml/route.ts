import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The change log as RSS 2.0, for readers that do not take Atom (/changes.xml). */
export function GET() {
  const events = [...bundle.events]
    .sort((a, b) => b.at.time.localeCompare(a.at.time))
    .slice(0, 100);
  const items = events
    .map((e) => {
      const url = `${SITE.url}/claims/${e.claim}`;
      const body = [
        e.before?.statement ? `Before: ${e.before.statement}` : "",
        e.note ? `Why: ${e.note}` : "",
        `Block ${e.at.height}.`,
      ]
        .filter(Boolean)
        .join(" ");
      return `    <item>
      <title>${esc(e.statement)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">${url}#rev-${e.rev}</guid>
      <pubDate>${new Date(e.at.time).toUTCString()}</pubDate>
      <category>${esc(e.change)}</category>
      <description>${esc(body)}</description>
    </item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blocklore: changes</title>
    <link>${SITE.url}/changes</link>
    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(SITE.promise)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(events[0]?.at.time ?? bundle.generated.time).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
