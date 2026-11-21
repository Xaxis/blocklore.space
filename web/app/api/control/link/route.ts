import { verifyLinkRequest } from "@blocklore/core/control";
import { makeLink, trustedOrigin } from "@/lib/admin/auth";
import { hit } from "@/lib/admin/store";

// `pnpm brain admin-link`: the devbox asks for a one-time sign-in link when mail does not arrive.
// Only a request signed under CONTROL_KEY gets one, so the sync token alone cannot open a session.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (!verifyLinkRequest(process.env.CONTROL_KEY ?? "", raw, new Date()))
    return Response.json({ error: "Not authorized." }, { status: 401 });
  if ((await hit("adm:rl:devbox-link", 3600)) > 10)
    return Response.json({ error: "Too many links this hour." }, { status: 429 });
  const nonce = (raw as { nonce: string }).nonce;
  if ((await hit(`adm:link-nonce:${nonce}`, 600)) > 1)
    return Response.json({ error: "Already used." }, { status: 409 });
  // The link opens on the host the devbox asked (BLOCKLORE_SITE), when it is one of the site's own.
  const url = await makeLink(trustedOrigin(new URL(req.url).origin));
  return Response.json({ url });
}
