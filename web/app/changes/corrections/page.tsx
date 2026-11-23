import type { Metadata } from "next";
import Link from "next/link";
import { ChangeFeed } from "@/components/ChangeFeed";
import { ReportLog } from "@/components/Report";
import { Block, Page, PageHeader } from "@/components/ui";
import { bundle } from "@/lib/data";
import { plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Corrections",
  description:
    "Every time Blocklore was wrong and fixed it, with what it said before, and every problem readers reported with what became of it.",
  alternates: { canonical: "/changes/corrections" },
};

export default function Corrections() {
  const events = bundle.events
    .filter((e) => e.change === "corrected")
    .sort((a, b) => b.at.time.localeCompare(a.at.time));
  return (
    <Page>
      <PageHeader
        title="Corrections"
        lede="When Blocklore gets something wrong, the fix is a new revision that keeps the old text, and it is listed here. A correction is the record working, not a failure to hide."
        meta={
          <>
            <span>{plural(events.length, "correction")}</span>
            <Link href="#reports">Reader reports</Link>
            <Link href="/changes">Every change</Link>
          </>
        }
      />
      {events.length ? (
        <ChangeFeed events={events} />
      ) : (
        <p className="empty">No corrections yet. When there are, every one is listed here.</p>
      )}
      <Block
        id="reports"
        title="Reader reports"
        aside={
          <p>
            Any reader can report a problem on a claim's page. The brain rechecks the claim within
            the hour and says what it found here. Readers' notes are never published.
          </p>
        }
      >
        <ReportLog />
      </Block>
    </Page>
  );
}
