import type { Metadata } from "next";
import Link from "next/link";
import { ChangeFeed } from "@/components/ChangeFeed";
import { bundle } from "@/lib/data";

export const metadata: Metadata = {
  title: "Changes",
  description:
    "Every claim Blocklore published, corrected or refined, newest first, with what it said before.",
};

export default function Changes() {
  const events = [...bundle.events].sort(
    (a, b) => b.at.time.localeCompare(a.at.time) || b.rev - a.rev,
  );
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Changes</h1>
        <p className="lede">
          Every claim published, corrected, refined or re-sourced, newest first. A change shows what
          the claim said before it. Follow along with the <a href="/changes.xml">Atom</a> or{" "}
          <a href="/rss.xml">RSS</a> feed, read a day at a time in the{" "}
          <Link href="/digest">daily digest</Link>, or read only the{" "}
          <Link href="/changes/corrections">corrections</Link>.
        </p>
      </header>
      {events.length ? (
        <ChangeFeed events={events} />
      ) : (
        <p className="callout">Nothing has been published yet.</p>
      )}
    </div>
  );
}
