import { asOfPath, isAfter } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AsOfForm } from "@/components/AsOfForm";
import { ChangeFeed } from "@/components/ChangeFeed";
import { Page, PageHeader } from "@/components/ui";
import { asOfName, readAsOf } from "@/lib/asof";
import { bundle } from "@/lib/data";
import { plural } from "@/lib/format";

// Every change published after a block height or the end of a UTC date: what a returning reader
// missed. A past moment's list only grows with new changes, which come with a deploy, so each page
// renders on its first request and is kept until the next one.
export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [];
}

type Params = Promise<{ moment: string }>;

async function read(params: Params) {
  const m = readAsOf((await params).moment);
  if ("error" in m) return null;
  const events = bundle.events
    .filter((e) => isAfter(e.at, m.asOf))
    .sort((a, b) => b.at.time.localeCompare(a.at.time) || b.rev - a.rev);
  return { asOf: m.asOf, path: asOfPath(m.asOf), events };
}

const after = (a: Parameters<typeof asOfName>[0]) =>
  "date" in a ? `the end of ${asOfName(a)} (UTC)` : asOfName(a);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await read(params);
  if (!r) return {};
  return {
    title: `Changes after ${asOfName(r.asOf)}`,
    alternates: { canonical: `/changes/since/${r.path}` },
    robots: { index: false, follow: true },
  };
}

export default async function ChangesSince({ params }: { params: Params }) {
  const r = await read(params);
  if (!r) notFound();
  const corrections = r.events.filter((e) => e.change === "corrected").length;
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/changes", label: "Changes" }, { label: `After ${asOfName(r.asOf)}` }]}
        title={`Changes after ${asOfName(r.asOf)}`}
        lede={`Every claim published, corrected, refined or re-sourced after ${after(r.asOf)}, newest first.`}
        meta={
          <>
            <span>{plural(r.events.length, "change")}</span>
            {corrections > 0 && <span>{plural(corrections, "correction")}</span>}
            <Link href="/changes">Every change</Link>
          </>
        }
      />
      <div className="measure">
        <AsOfForm base="/changes" what="changes" value={r.path} segment="since" heading="h2" />
      </div>
      {r.events.length ? (
        <ChangeFeed events={r.events} />
      ) : (
        <p className="empty">Nothing was published after {after(r.asOf)}.</p>
      )}
    </Page>
  );
}
