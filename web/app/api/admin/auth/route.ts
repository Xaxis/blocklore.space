import { cookies } from "next/headers";
import { z } from "zod";
import { COOKIE, cookieOptions, redeemLink, sameOrigin } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ t: z.string().max(100) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed." }, { status: 403 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "No sign-in token." }, { status: 400 });
  const sid = await redeemLink(p.data.t);
  if (!sid)
    return Response.json(
      { error: "This link was already used or has expired. Ask for a new one." },
      { status: 401 },
    );
  (await cookies()).set(COOKIE, sid, cookieOptions());
  return Response.json({ ok: true });
}
