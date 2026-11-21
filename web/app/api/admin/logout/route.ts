import { cookies } from "next/headers";
import { z } from "zod";
import { COOKIE, endSession, ownerFor } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await ownerFor(req))) return Response.json({ error: "Not signed in." }, { status: 401 });
  const all = z.object({ all: z.boolean() }).safeParse(await req.json().catch(() => ({})));
  await endSession(all.success && all.data.all);
  (await cookies()).delete(COOKIE);
  return Response.json({ ok: true });
}
