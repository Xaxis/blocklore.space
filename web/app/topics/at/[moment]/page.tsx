import { asOfPath } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AsOfForm } from "@/components/AsOfForm";
import { AsOfNotice, sinceWords } from "@/components/AsOfNotice";
import { type TopicRow, TopicTable } from "@/components/TopicTable";
import { Page, PageHeader } from "@/components/ui";
import { asOfName, asOfTitle, readAsOf, topicAt } from "@/lib/asof";
import { bundle } from "@/lib/data";
import { plural } from "@/lib/format";

// The time machine's Knowledge view: every topic as it stood at a past block height or UTC date.
// /verify links each sealed edition here, so those heights render at build; any other moment
// renders on its first request and is kept until the next deploy.
export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return bundle.snapshots.map((s) => ({ moment: String(s.at.height) }));
}

type Params = Promise<{ moment: string }>;

async function read(params: Params) {
  const m = readAsOf((await params).moment);
  if ("error" in m) return null;
  const topics = bundle.writtenTopics.flatMap((t) => {
    const v = topicAt(t.slug, m.asOf);
    return v ? [v] : [];
  });
  return { asOf: m.asOf, path: asOfPath(m.asOf), topics };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await read(params);
  if (!r) return {};
  return {
    title: `Knowledge as of ${asOfName(r.asOf)}`,
    description: `Every Blocklore topic as it stood at ${asOfName(r.asOf)}.`,
    alternates: { canonical: `/topics/at/${r.path}` },
    robots: { index: false, follow: true },
  };
}

export default async function KnowledgeAsOf({ params }: { params: Params }) {
  const r = await read(params);
  if (!r) notFound();
  const rows: TopicRow[] = r.topics.map((t) => ({
    ...t.topic,
    pendingReview: 0,
    claims: t.claims,
    lede: t.lede,
    updated: t.updated,
  }));
  const claims = new Set(r.topics.flatMap((t) => t.claims.map((c) => c.id))).size;
  const sum = (k: "added" | "revised" | "withdrawn") =>
    new Set(r.topics.flatMap((t) => t.since[k])).size;
  const edition = bundle.snapshots.find((s) => asOfPath(r.asOf) === String(s.at.height));
  const changed = sum("added") + sum("revised") + sum("withdrawn") > 0;
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/topics", label: "Knowledge" }, { label: `As of ${asOfName(r.asOf)}` }]}
        title="Knowledge, as it stood"
        lede="Every topic exactly as Blocklore stated it at a past moment. Open one to read its claims as they were then, each with the sources and quotes it cited."
        meta={
          <>
            <span>{plural(rows.filter((t) => t.claims.length > 0).length, "topic")}</span>
            <span>{plural(claims, "fact")}</span>
            {edition && (
              <Link href={`/verify#snapshot-${edition.n}`}>Sealed in snapshot {edition.n}</Link>
            )}
          </>
        }
      />
      <AsOfNotice title={asOfTitle(r.asOf)} now="/topics">
        {changed
          ? `Since then: ${sinceWords([
              [sum("added"), sum("added") === 1 ? "claim added" : "claims added"],
              [sum("revised"), "revised"],
              [sum("withdrawn"), "withdrawn"],
            ])}.`
          : "Nothing has changed since."}
      </AsOfNotice>
      <div className="with-rail">
        <div>
          <TopicTable rows={rows} at={r.path} />
        </div>
        <aside className="rail" aria-label="Another moment">
          <AsOfForm base="/topics" what="every topic" value={r.path} />
        </aside>
      </div>
    </Page>
  );
}
