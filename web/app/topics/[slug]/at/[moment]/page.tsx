import { asOfPath } from "@blocklore/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AsOfNotice, sinceWords } from "@/components/AsOfNotice";
import { TopicView } from "@/components/TopicView";
import { anyClaim, asOfName, asOfTitle, readAsOf, topicAt } from "@/lib/asof";
import { bundle } from "@/lib/data";
import { date, height } from "@/lib/format";

// The time machine: a topic exactly as Blocklore stated it at a past block height or UTC date. A
// past moment never changes, so each page renders on its first request and is kept until the next
// deploy; the sealed editions' heights, which /verify links to, render at build.
export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return bundle.snapshots.flatMap((s) =>
    bundle.writtenTopics.map((t) => ({ slug: t.slug, moment: String(s.at.height) })),
  );
}

type Params = Promise<{ slug: string; moment: string }>;

async function read(params: Params) {
  const { slug, moment } = await params;
  const m = readAsOf(moment);
  if ("error" in m) return null;
  const t = topicAt(slug, m.asOf);
  return t ? { ...t, asOf: m.asOf, path: asOfPath(m.asOf) } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const t = await read(params);
  if (!t) return {};
  return {
    title: `${t.topic.title} as of ${asOfName(t.asOf)}`,
    description: t.lede?.statement,
    alternates: { canonical: `/topics/${t.topic.slug}/at/${t.path}` },
    robots: { index: false, follow: true },
  };
}

export default async function TopicAsOfPage({ params }: { params: Params }) {
  const t = await read(params);
  if (!t) notFound();
  const now = `/topics/${t.topic.slug}`;
  const { added, revised, withdrawn } = t.since;
  const changed = added.length + revised.length + withdrawn.length > 0;
  const first = t.topic.sections
    .flatMap((s) => s.claims)
    .map((id) => anyClaim(id)?.first_seen)
    .reduce((a, b) => (b && (!a || b.time < a.time) ? b : a), undefined);
  return (
    <TopicView
      topic={t.topic}
      lede={t.lede}
      sections={t.sections}
      claims={t.claims}
      ladder={t.ladder}
      updated={t.updated}
      at={{
        path: t.path,
        label: `As of ${asOfName(t.asOf)}`,
        notice: (
          <AsOfNotice title={asOfTitle(t.asOf)} now={now}>
            {t.claims.length > 0 &&
              "The topic as Blocklore stated it then: each claim as it stood at that moment, under today's section titles. "}
            {changed
              ? `Since then: ${sinceWords([
                  [added.length, added.length === 1 ? "claim added" : "claims added"],
                  [revised.length, "revised"],
                  [withdrawn.length, "withdrawn"],
                ])}.`
              : "Nothing in it has changed since."}
          </AsOfNotice>
        ),
        empty: (
          <p className="empty">
            Blocklore had published no claims on this topic yet at {asOfName(t.asOf)}.
            {first && ` The first came at block ${height(first.height)}, on ${date(first.time)}.`}
          </p>
        ),
      }}
    />
  );
}
