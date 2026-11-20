import type { Metadata } from "next";
import Link from "next/link";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Research log",
  description:
    "Every research run: what the brain read, what it published, what it rejected and why, and what it could not settle.",
};

export default function Log() {
  const runs = [...bundle.runs].sort((a, b) => b.started.time.localeCompare(a.started.time));
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Research log</h1>
        <p className="lede">
          Every run of the brain, in public: what it read, what it published, what it rejected and
          why, what waits for the owner, and any text in a source that tried to give it orders.
        </p>
      </header>
      {runs.length === 0 ? (
        <p className="callout">No runs have published yet.</p>
      ) : (
        <ol className="runs">
          {runs.map((r) => (
            <li key={r.id}>
              <div className="when mono muted">
                {dateTime(r.started.time)}, block {height(r.started.height)}, {r.kind}
              </div>
              <Link
                href={`/log/${r.id}`}
                style={{ fontFamily: "var(--serif)", fontSize: "1.15rem", color: "var(--ink)" }}
              >
                {r.id}
              </Link>
              <p style={{ fontFamily: "var(--serif)", color: "var(--ink-2)" }}>{r.summary}</p>
              <div className="counts">
                <span className="chip established">{r.published.length} published</span>
                {r.revised.length > 0 && (
                  <span className="chip plain">{r.revised.length} revised</span>
                )}
                <span className="chip plain">{r.rejected.length} rejected</span>
                {r.gated.length > 0 && (
                  <span className="chip plain">
                    {plural(
                      r.gated.reduce((n, g) => n + g.count, 0),
                      "claim",
                    )}{" "}
                    held for review
                  </span>
                )}
                <span className="chip plain">{plural(r.read.length, "source")} read</span>
                {r.injections.length > 0 && (
                  <span className="chip warn">
                    {plural(r.injections.length, "injection attempt")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
