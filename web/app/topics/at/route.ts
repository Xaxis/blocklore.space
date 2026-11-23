import { asOfTarget } from "@/lib/asof";

// The time machine's form without script: `?moment=` goes to every topic as it stood then.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const typed = new URL(req.url).searchParams.get("moment");
  return Response.redirect(new URL(asOfTarget("/topics", typed), req.url), 303);
}
