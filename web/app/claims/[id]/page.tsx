import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimView } from "@/components/ClaimView";
import { anyClaim } from "@/lib/asof";
import { allClaims, allWithdrawn, eventsFor, getClaim, snapshotFor } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...allClaims(), ...allWithdrawn()].map((c) => ({ id: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const c = anyClaim((await params).id);
  if (!c) return {};
  const title = c.statement.length > 70 ? `${c.statement.slice(0, 67)}...` : c.statement;
  return {
    title: c.withdrawal ? `Withdrawn: ${title}` : title,
    description: c.statement,
    alternates: { canonical: `/claims/${c.id}` },
    ...(c.withdrawal ? { robots: { index: false, follow: true } } : {}),
  };
}

/** A published claim, or one the owner withdrew: its page stays, so links to it keep working. */
export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const claim = anyClaim((await params).id);
  if (!claim) notFound();
  return (
    <ClaimView
      claim={claim}
      events={eventsFor(claim.id).slice().reverse()}
      snapshot={snapshotFor(claim)}
      related={(claim.related ?? []).map((id) => getClaim(id)).filter((c) => c !== undefined)}
      supersededBy={claim.superseded_by ? getClaim(claim.superseded_by) : undefined}
    />
  );
}
