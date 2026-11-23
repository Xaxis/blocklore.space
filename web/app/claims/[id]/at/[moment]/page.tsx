import { asOfPath } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AsOfNotice } from "@/components/AsOfNotice";
import { CHANGE, ClaimView } from "@/components/ClaimView";
import { Page, PageHeader } from "@/components/ui";
import { anyClaim, asOfName, asOfTitle, changesSince, claimAt, readAsOf } from "@/lib/asof";
import { eventsFor, snapshotFor } from "@/lib/data";
import { date, dateTime, height, plural } from "@/lib/format";

// The time machine: a claim exactly as Blocklore stated it at a past block height or UTC date. A
// past moment never changes, so each page renders on its first request and is kept until the next
// deploy.
export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [];
}

type Params = Promise<{ id: string; moment: string }>;

async function read(params: Params) {
  const { id, moment } = await params;
  const now = anyClaim(id);
  const m = readAsOf(moment);
  if (!now || "error" in m) return null;
  return { now, past: claimAt(id, m.asOf) ?? null, asOf: m.asOf, path: asOfPath(m.asOf) };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await read(params);
  if (!r) return {};
  const s = (r.past ?? r.now).statement;
  return {
    title: `As of ${asOfName(r.asOf)}: ${s.length > 50 ? `${s.slice(0, 47)}...` : s}`,
    description: r.past?.statement,
    alternates: { canonical: `/claims/${r.now.id}/at/${r.path}` },
    robots: { index: false, follow: true },
  };
}

export default async function ClaimAsOfPage({ params }: { params: Params }) {
  const r = await read(params);
  if (!r) notFound();
  const { now, past: then, asOf, path } = r;
  const title = asOfTitle(asOf);
  const current = `/claims/${now.id}`;

  if (!then)
    return (
      <Page>
        <PageHeader
          crumbs={[
            { href: `/topics/at/${path}`, label: "Topics" },
            { label: "Claim" },
            { label: `As of ${asOfName(asOf)}` },
          ]}
          title="Not published yet"
        />
        <AsOfNotice title={title} now={current}>
          Blocklore had not stated this claim yet. It was first published at block{" "}
          {height(now.first_seen.height)}, on {dateTime(now.first_seen.time)}.
        </AsOfNotice>
      </Page>
    );

  const later = changesSince(now.id, asOf);
  const kept = new Set(then.revisions.map((x) => x.rev));
  const exists = (id: string) => claimAt(id, asOf);
  return (
    <ClaimView
      claim={then}
      events={eventsFor(now.id)
        .filter((e) => kept.has(e.rev))
        .reverse()}
      snapshot={snapshotFor(then)}
      related={(then.related ?? []).map(exists).filter((c) => c != null)}
      supersededBy={then.superseded_by ? (exists(then.superseded_by) ?? undefined) : undefined}
      at={{
        path,
        label: `As of ${asOfName(asOf)}`,
        notice: (
          <AsOfNotice title={title} now={current}>
            The claim as Blocklore stated it then, with its hash at that moment.{" "}
            {later.length === 0 ? (
              "It has not changed since."
            ) : (
              <>
                Since then: {plural(later.length, "revision")} (
                {later.map((e, i) => (
                  <span key={e.rev}>
                    {i > 0 && ", "}
                    {CHANGE[e.change].label.toLowerCase()} on {date(e.at.time)}
                  </span>
                ))}
                ). <Link href={`${current}#history`}>The history</Link> shows what each changed.
              </>
            )}
          </AsOfNotice>
        ),
      }}
    />
  );
}
