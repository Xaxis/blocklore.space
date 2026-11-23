import { ownerFor } from "@/lib/admin/auth";
import { readLiveEvents, readNostr, readResults, readState, watch } from "@/lib/admin/control";

// What an open admin page refreshes every few seconds: the daemon's state, the live session, the
// Nostr channel's preview and the results of commands the page sent. Asking marks the admin as
// open, so the daemon syncs fast.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await ownerFor(req))) return Response.json({ error: "Not signed in." }, { status: 401 });
  const url = new URL(req.url);
  const ids = (url.searchParams.get("results") ?? "").split(",").filter(Boolean);
  const live = url.searchParams.get("live") === "1";
  const nostr = url.searchParams.get("nostr") === "1";
  await watch();
  const [{ state, online }, results, events, channel] = await Promise.all([
    readState(),
    readResults(ids),
    live ? readLiveEvents() : Promise.resolve(null),
    nostr ? readNostr() : Promise.resolve(null),
  ]);
  return Response.json(
    { state, online, results, live: events, nostr: channel, at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
