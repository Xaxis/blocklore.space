import { nip05Document } from "@blocklore/core";
import { bundle } from "@/lib/data";

// NIP-05: `_@blocklore.space` (shown by clients as blocklore.space) and `blocklore@blocklore.space`
// name the key of Blocklore's Nostr channel, `records@blocklore.space` the key that carries its
// OrangeCheck records, each with the relays they post to. Built from knowledge/nostr.json, which the
// brain writes when the owner first turns the channel on; until then no name resolves.

export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(nip05Document(bundle.nostr))}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // NIP-05: clients in browsers fetch this from other origins.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
