import { KEYS } from "@blocklore/core/control";
import { BrainFeed, FEED_STALE_MS } from "@blocklore/core/feed";
import { controlAvailable, getJson } from "@/lib/admin/store";

// The brain, live (core/src/feed.ts): what the research brain on the devbox is doing now, what
// comes next, and what it did in the last day. Public and read-only. The daemon rewrites the copy
// on every sync; `online` says whether that copy is fresh. Cached briefly at the edge, so any
// number of readers cost one Redis read every few seconds.

export const dynamic = "force-dynamic";

export async function GET() {
  const raw = controlAvailable() ? await getJson(KEYS.feed) : null;
  const parsed = BrainFeed.safeParse(raw);
  const feed = parsed.success ? parsed.data : null;
  const online = !!feed && Date.now() - Date.parse(feed.at) < FEED_STALE_MS;
  return new Response(`${JSON.stringify({ online, feed })}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=20",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
