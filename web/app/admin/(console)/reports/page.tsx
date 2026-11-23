import type { Metadata } from "next";
import { Reports } from "@/components/admin/Reports";
import { getClaim } from "@/lib/data";
import { pullReports } from "@/lib/reports";

export const metadata: Metadata = { title: "Reader reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  // `all` reads every report without marking any as pulled, so the brain still sees new ones.
  const items = await pullReports(true).catch(() => null);
  return (
    <>
      <header className="page-header">
        <h1>Reader reports</h1>
        <p className="lede">
          Problems readers reported with published claims, with their notes. The brain rechecks each
          claim on its hourly tick and sends wrong or outdated ones that still hold to research.
          Notes are shown only here; the public sees each report's kind, date and outcome.
        </p>
      </header>
      <Reports
        initial={
          items?.map((i) => ({ ...i, statement: getClaim(i.claim)?.statement ?? null })) ?? null
        }
      />
    </>
  );
}
