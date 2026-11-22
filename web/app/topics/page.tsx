import type { Metadata } from "next";
import Link from "next/link";
import { TopicTable } from "@/components/TopicTable";
import { Page, PageHeader } from "@/components/ui";
import { bundle } from "@/lib/data";
import { plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Knowledge",
  description:
    "Everything Blocklore knows about Bitcoin, by topic: every fact with its sources, checked by code and sealed in Bitcoin.",
  alternates: { canonical: "/topics" },
};

// The Knowledge view: every topic, each a set of sourced facts at five depths.
export default function KnowledgeView() {
  const s = bundle.stats;
  return (
    <Page>
      <PageHeader
        title="Knowledge"
        lede="Everything the brain has published, by topic. Each topic is a set of facts, each fact with its sources and the exact quote, written at five depths from first steps to protocol research."
        meta={
          <>
            <span>{plural(bundle.topics.length, "topic")}</span>
            <span>{plural(s.claims, "fact")}</span>
            <Link href="/gaps">What it does not know yet</Link>
          </>
        }
      />
      <TopicTable />
    </Page>
  );
}
