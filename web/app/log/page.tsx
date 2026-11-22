import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Research log",
  description:
    "Every research run: what the brain read, what it published, what it rejected and why, and what it could not settle.",
  alternates: { canonical: "/log" },
};

export default function Log() {
  const runs = [...bundle.runs].sort((a, b) => b.started.time.localeCompare(a.started.time));
  const published = runs.reduce((n, r) => n + r.published.length, 0);
  return (
    <Page>
      <PageHeader
        title="Research log"
        lede="Every run of the brain, in public: what it read, what it published, what it rejected and why, what waits for closer checks, and any text in a source that tried to give it orders."
        meta={
          <>
            <span>{plural(runs.length, "run")}</span>
            <span>{plural(published, "claim")} published</span>
          </>
        }
      />
      {runs.length === 0 ? (
        <p className="empty">No runs have published yet.</p>
      ) : (
        <>
          <h2 className="visually-hidden">Every run</h2>
          <ol className="rows">
            {runs.map((r) => {
              const held = r.gated.reduce((n, g) => n + g.count, 0);
              return (
                <li key={r.id} className="row-item">
                  <div className="stack-sm">
                    <h3>
                      <Link href={`/log/${r.id}`} className="mono">
                        {r.id}
                      </Link>
                    </h3>
                    <p>{r.summary}</p>
                    <div className="meta">
                      <span className="badge badge-ok">{r.published.length} published</span>
                      {r.revised.length > 0 && (
                        <span className="badge badge-info">{r.revised.length} revised</span>
                      )}
                      <span className="badge">{r.rejected.length} rejected</span>
                      {held > 0 && (
                        <span className="badge badge-accent">
                          {plural(held, "claim")} held for closer checks
                        </span>
                      )}
                      <span>{plural(r.read.length, "source")} read</span>
                      {r.injections.length > 0 && (
                        <span className="badge badge-bad">
                          {plural(r.injections.length, "injection attempt")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="row-side">
                    <span className="badge badge-outline">{r.kind}</span>
                    <span>{dateTime(r.started.time)}</span>
                    <span className="mono">block {height(r.started.height)}</span>
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
