import { bundle } from "@/lib/data";
import { atomFeed } from "@/lib/feeds";

export const dynamic = "force-static";

/** The change log as Atom: one entry per revision, newest first. */
export function GET() {
  return atomFeed({
    page: "/changes",
    self: "/changes.xml",
    title: "Blocklore: changes",
    events: bundle.events,
    fallback: bundle.generated.time,
  });
}
