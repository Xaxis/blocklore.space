import { asOfTarget } from "@/lib/asof";

// The since form without script: `?moment=` goes to the page of changes after that moment.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const typed = new URL(req.url).searchParams.get("moment");
  return Response.redirect(new URL(asOfTarget("/changes", typed, "since"), req.url), 303);
}
