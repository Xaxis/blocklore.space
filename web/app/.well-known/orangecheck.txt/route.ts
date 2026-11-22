import { wellKnownText } from "@blocklore/core";
import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

// The proof that the owner's attested Bitcoin key belongs to blocklore.space (OrangeCheck's attest
// spec reads this file for a dns: identity). Not found until the owner has attested in the admin.

export const dynamic = "force-static";

export function GET() {
  const text = wellKnownText(bundle.orangecheck, SITE.url);
  if (!text) return new Response("No attestation yet.\n", { status: 404 });
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
