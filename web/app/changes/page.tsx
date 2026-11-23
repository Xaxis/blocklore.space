import type { Metadata } from "next";
import Link from "next/link";
import { AsOfForm } from "@/components/AsOfForm";
import { ChangeFeed } from "@/components/ChangeFeed";
import { Page, PageHeader } from "@/components/ui";
import { bundle } from "@/lib/data";
import { plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Changes",
  description:
    "Every claim Blocklore published, corrected or refined, newest first, with what it said before.",
  alternates: { canonical: "/changes" },
};

export default function Changes() {
  const events = [...bundle.events].sort(
    (a, b) => b.at.time.localeCompare(a.at.time) || b.rev - a.rev,
  );
  const corrections = events.filter((e) => e.change === "corrected").length;
  return (
    <Page>
      <PageHeader
        title="Changes"
        lede="Every claim published, corrected, refined or re-sourced, newest first. A change shows what the claim said before it."
        meta={
          <>
            <span>{plural(events.length, "change")}</span>
            <Link href="/changes/corrections">{plural(corrections, "correction")}</Link>
            <Link href="/digest">Read a day at a time</Link>
            <Link href="/pulse">Upstream and the chain</Link>
          </>
        }
        actions={
          <>
            <a className="btn btn-sm" href="/changes.xml">
              Atom feed
            </a>
            <a className="btn btn-sm" href="/rss.xml">
              RSS feed
            </a>
          </>
        }
      />
      <div className="measure">
        <AsOfForm base="/changes" what="changes" segment="since" heading="h2" />
      </div>
      {events.length ? (
        <ChangeFeed events={events} />
      ) : (
        <p className="empty">Nothing has been published yet.</p>
      )}
    </Page>
  );
}
