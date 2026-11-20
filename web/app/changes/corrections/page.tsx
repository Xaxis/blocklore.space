import type { Metadata } from "next";
import { ChangeFeed } from "@/components/ChangeFeed";
import { bundle } from "@/lib/data";

export const metadata: Metadata = {
  title: "Corrections",
  description: "Every time Blocklore was wrong and fixed it, with what it said before.",
};

export default function Corrections() {
  const events = bundle.events
    .filter((e) => e.change === "corrected")
    .sort((a, b) => b.at.time.localeCompare(a.at.time));
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Corrections</h1>
        <p className="lede">
          When Blocklore gets something wrong, the fix is a new revision that keeps the old text,
          and it is listed here. A correction is the record working, not a failure to hide.
        </p>
      </header>
      {events.length ? (
        <ChangeFeed events={events} />
      ) : (
        <p className="callout">No corrections yet. When there are, every one is listed here.</p>
      )}
    </div>
  );
}
