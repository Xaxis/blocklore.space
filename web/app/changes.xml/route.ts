import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const VERB: Record<string, string> = {
  created: "New",
  corrected: "Corrected",
  refined: "Refined",
  reviewed: "Reviewed",
};

/** The change log as Atom: one entry per revision, newest first. */
export function GET() {
  const events = [...bundle.events]
    .sort((a, b) => b.at.time.localeCompare(a.at.time))
    .slice(0, 200);
  const updated = events[0]?.at.time ?? bundle.generated.time;
  const entries = events
    .map((e) => {
      const url = `${SITE.url}/claims/${e.claim}`;
      const title = `${VERB[e.change] ?? "Changed"}: ${e.statement}`;
      const body = [
        e.statement,
        e.before?.statement ? `Before: ${e.before.statement}` : "",
        e.note ? `Why: ${e.note}` : "",
        `Block ${e.at.height}, run ${e.run}.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      return `  <entry>
    <id>${url}#rev-${e.rev}</id>
    <title>${esc(title)}</title>
    <link href="${url}"/>
    <updated>${e.at.time}</updated>
    <content type="text">${esc(body)}</content>
  </entry>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${SITE.url}/changes</id>
  <title>Blocklore: changes</title>
  <subtitle>${esc(SITE.promise)}</subtitle>
  <link rel="self" href="${SITE.url}/changes.xml"/>
  <link href="${SITE.url}/changes"/>
  <updated>${updated}</updated>
  <author><name>Blocklore</name></author>
${entries}
</feed>
`;
  return new Response(xml, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
