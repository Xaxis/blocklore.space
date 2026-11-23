import { monthProgress, progressMonths } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";
import { progressInput } from "@/lib/data";
import { monthLong, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Progress",
  description:
    "What Blocklore did each month, counted from its own public record: claims, corrections, research runs, the evaluator, sealed editions and the security lab.",
  alternates: { canonical: "/progress" },
};

export default function ProgressIndex() {
  const months = progressMonths(progressInput()).map((m) => monthProgress(progressInput(), m));
  return (
    <Page>
      <PageHeader
        title="Progress"
        lede="Each month of Blocklore's work, counted from its own public record. A report has no claims of its own: every number links to the claims, runs, decisions and editions it counts."
        meta={<span>{plural(months.length, "month")}</span>}
      />
      {months.length === 0 ? (
        <p className="empty">Nothing has been recorded yet.</p>
      ) : (
        <>
          <h2 className="visually-hidden">Every month</h2>
          <ol className="rows">
            {months.map((m) => (
              <li key={m.month} className="row-item">
                <div className="stack-sm">
                  <h3>
                    <Link href={`/progress/${m.month}`}>{monthLong(m.month)}</Link>
                  </h3>
                  <div className="meta">
                    {m.claims.created > 0 && (
                      <span className="badge badge-ok">
                        {plural(m.claims.created, "new claim")}
                      </span>
                    )}
                    {m.claims.corrected > 0 && (
                      <span className="badge badge-bad">
                        {plural(m.claims.corrected, "correction")}
                      </span>
                    )}
                    {m.runs.length > 0 && (
                      <span className="badge">{plural(m.runs.length, "run")}</span>
                    )}
                    {m.editions.length > 0 && (
                      <span className="badge">{plural(m.editions.length, "edition")} sealed</span>
                    )}
                    {m.lab.length > 0 && (
                      <span className="badge">{plural(m.lab.length, "lab run")}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Page>
  );
}
