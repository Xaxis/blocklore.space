import type { Metadata } from "next";
import Link from "next/link";
import { digests } from "@/lib/data";
import { dateLong, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Daily digest",
  description:
    "What each day changed in Blocklore: new claims by topic, corrections, revisions and BIP status moves.",
};

export default function Digests() {
  const days = digests();
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Daily digest</h1>
        <p className="lede">
          What each day changed, in UTC days. A digest has no prose of its own: every line is a
          published claim or a change to the BIP index, so it says nothing the store does not.
        </p>
      </header>
      {days.length === 0 ? (
        <p className="callout">Nothing has been published yet.</p>
      ) : (
        <ol className="runs">
          {days.map((d) => {
            const created = d.created.reduce((n, g) => n + g.events.length, 0);
            return (
              <li key={d.date}>
                <div className="when mono muted">
                  blocks {height(d.heights.from)} to {height(d.heights.to)}
                </div>
                <Link
                  href={`/digest/${d.date}`}
                  style={{ fontFamily: "var(--serif)", fontSize: "1.15rem", color: "var(--ink)" }}
                >
                  {dateLong(`${d.date}T00:00:00Z`)}
                </Link>
                <div className="counts">
                  {d.corrections.length > 0 && (
                    <span className="chip contested">
                      {plural(d.corrections.length, "correction")}
                    </span>
                  )}
                  {created > 0 && (
                    <span className="chip established">{plural(created, "new claim")}</span>
                  )}
                  {d.revisions.length > 0 && (
                    <span className="chip">{plural(d.revisions.length, "revision")}</span>
                  )}
                  {d.bips.length > 0 && (
                    <span className="chip">{plural(d.bips.length, "BIP index change")}</span>
                  )}
                  {d.created.length > 0 && (
                    <span className="muted">{d.created.map((g) => g.topic).join(", ")}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
