import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";
import { digests } from "@/lib/data";
import { dateLong, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Digests",
  description:
    "What each day changed in Blocklore: new claims by topic, corrections, revisions and BIP status moves.",
  alternates: { canonical: "/digest" },
};

export default function Digests() {
  const days = digests();
  return (
    <Page>
      <PageHeader
        title="Digests"
        lede="What each UTC day changed. A digest has no prose of its own: every line is a published claim or a change to the BIP index, so it says nothing the store does not."
        meta={<span>{plural(days.length, "day")}</span>}
      />
      {days.length === 0 ? (
        <p className="empty">Nothing has been published yet.</p>
      ) : (
        <>
          <h2 className="visually-hidden">Every day</h2>
          <ol className="rows">
            {days.map((d) => {
              const created = d.created.reduce((n, g) => n + g.events.length, 0);
              return (
                <li key={d.date} className="row-item">
                  <div className="stack-sm">
                    <h3>
                      <Link href={`/digest/${d.date}`}>{dateLong(`${d.date}T00:00:00Z`)}</Link>
                    </h3>
                    <div className="meta">
                      {d.corrections.length > 0 && (
                        <span className="badge badge-bad">
                          {plural(d.corrections.length, "correction")}
                        </span>
                      )}
                      {created > 0 && (
                        <span className="badge badge-ok">{plural(created, "new claim")}</span>
                      )}
                      {d.revisions.length > 0 && (
                        <span className="badge">{plural(d.revisions.length, "revision")}</span>
                      )}
                      {d.bips.length > 0 && (
                        <span className="badge">{plural(d.bips.length, "BIP index change")}</span>
                      )}
                      {d.created.length > 0 && (
                        <span>{d.created.map((g) => g.topic).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <div className="row-side mono">
                    <span>
                      blocks {height(d.heights.from)} to {height(d.heights.to)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Page>
  );
}
