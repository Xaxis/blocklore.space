import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";
import { allDebates, debateTopics } from "@/lib/debates";
import { date, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Debates",
  description:
    "Maps of contested Bitcoin questions: the positions side by side, each in its holders' own words, and the claims of fact and definition they rest on, so you can see which disagreements evidence could settle.",
  alternates: { canonical: "/debates" },
};

// Every debate map that keeps its rules (core/src/debateview.ts). A map holds a question, its
// positions' labels and claim ids; what a reader reads on it is published claims.
export default function Debates() {
  const debates = allDebates();
  return (
    <Page>
      <PageHeader
        title="Debates"
        lede="Maps of contested questions. Each puts the positions side by side, every stance and argument attributed to who holds it and dated, and below them the claims of fact and definition the sides share, so you can see which disagreements evidence could settle and which are about values. Blocklore takes no side on a question of values."
        meta={
          <>
            <span>{plural(debates.length, "map")}</span>
            <Link href="/about/claims#debate-maps">How a map is made</Link>
          </>
        }
      />
      {debates.length === 0 ? (
        <p className="empty">
          No debate map is published yet. A map publishes only once every claim in it has passed the
          evaluator and it keeps every rule: each position has at least one stance or argument in
          its holders&apos; words, attributed and dated, and each claim of fact or definition it
          rests on is published. Until then the contested claims are on their topics.
        </p>
      ) : (
        <>
          <h2 className="visually-hidden">Every map</h2>
          <ul className="rows">
            {debates.map((d) => {
              const topics = debateTopics(d);
              return (
                <li key={d.slug} className="row-item">
                  <div className="stack-sm">
                    <h3>
                      <Link href={`/debates/${d.slug}`}>{d.question}</Link>
                    </h3>
                    <ul className="debate-index-sides" aria-label="Positions">
                      {d.positions.map((p) => (
                        <li key={p.id}>
                          {p.label}{" "}
                          <span className="muted">
                            {p.claims.length}
                            <span className="visually-hidden">
                              {p.claims.length === 1 ? " claim" : " claims"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="meta">
                      <span>
                        {plural(d.empirical.length + d.definitional.length, "shared claim")}
                      </span>
                      {topics.map((t) => (
                        <Link key={t.slug} href={`/topics/${t.slug}`}>
                          {t.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <div className="row-side">
                    <span>Updated {date(d.updated.time)}</span>
                    <span className="mono">block {height(d.updated.height)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Page>
  );
}
