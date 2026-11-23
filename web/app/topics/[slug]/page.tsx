import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopicView } from "@/components/TopicView";
import { bundle, getClaim, getTopic, topicClaims } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return bundle.topics.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const t = getTopic((await params).slug);
  if (!t) return {};
  return {
    title: t.title,
    description: getClaim(t.lede)?.statement,
    alternates: { canonical: `/topics/${t.slug}` },
  };
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = getTopic((await params).slug);
  if (!topic) notFound();
  return (
    <TopicView
      topic={topic}
      lede={getClaim(topic.lede) ?? null}
      sections={topic.sections.map((s) => ({
        ...s,
        claims: s.claims.map((id) => getClaim(id)).filter((c) => c !== undefined),
      }))}
      claims={topicClaims(topic)}
      ladder={topic.ladder}
      updated={topic.updated}
      pendingReview={topic.pendingReview}
      gap={bundle.gaps.topics.find((g) => g.slug === topic.slug)}
    />
  );
}
