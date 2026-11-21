import { z } from "zod";
import { requestLink, sameOrigin, trustedOrigin } from "@/lib/admin/auth";
import { clientIp } from "@/lib/kv";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().max(320) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed." }, { status: 403 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Send an email address." }, { status: 400 });
  try {
    await requestLink(p.data.email, trustedOrigin(req.headers.get("origin")), clientIp(req));
  } catch (e) {
    console.error("[admin] sign-in link failed", e instanceof Error ? e.message : e);
  }
  // The same answer whether or not the address is the owner's.
  return Response.json({ ok: true });
}
