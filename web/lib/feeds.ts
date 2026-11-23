import type { ChangeEvent } from "@blocklore/core";
import { SITE } from "@/lib/site";

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

/**
 * Change events as an Atom feed, one entry per revision, newest first: the whole store's at
 * /changes.xml and each topic's at /topics/<slug>/changes.xml.
 */
export function atomFeed(opts: {
  /** The page the feed follows, as a site path: /changes or /topics/<slug>. */
  page: string;
  /** The feed's own path. */
  self: string;
  title: string;
  events: readonly ChangeEvent[];
  /** When nothing has changed yet. */
  fallback: string;
}): Response {
  const events = [...opts.events]
    .sort((a, b) => b.at.time.localeCompare(a.at.time) || b.rev - a.rev)
    .slice(0, 200);
  const updated = events[0]?.at.time ?? opts.fallback;
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
  <id>${SITE.url}${opts.page}</id>
  <title>${esc(opts.title)}</title>
  <subtitle>${esc(SITE.promise)}</subtitle>
  <link rel="self" href="${SITE.url}${opts.self}"/>
  <link href="${SITE.url}${opts.page}"/>
  <updated>${updated}</updated>
  <author><name>Blocklore</name></author>
${entries}
</feed>
`;
  return new Response(xml, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
