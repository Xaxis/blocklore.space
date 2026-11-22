import { DEPTH_LABEL, type GapQuestion, THIN_AT } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Suggest } from "@/components/Suggest";
import { Block, Page, PageHeader, Stat } from "@/components/ui";
import { bundle } from "@/lib/data";
import { date, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "What it does not know",
  description:
    "What Blocklore does not cover yet: questions it answers only in part or not at all, depths with few claims, and claims whose sources no longer bear them out.",
  alternates: { canonical: "/gaps" },
};

const GOT: Record<string, string> = {
  partial: "covered in part",
  not_covered: "not covered",
  no_match: "no claim found",
  check_failed: "covered in part",
  model_declined: "not covered",
};

function Questions({ items }: { items: GapQuestion[] }) {
  return (
    <ul className="rows">
      {items.map((q) => (
        <li key={q.id} className="row-item" style={{ padding: "var(--s3) 0" }}>
          <p>{q.q}</p>
          <span className="badge">{GOT[q.got] ?? q.got}</span>
        </li>
      ))}
    </ul>
  );
}

export default function GapsPage() {
  const g = bundle.gaps;
  const open = g.topics.filter((t) => t.claims > 0 && t.score > 0);
  const waiting = g.topics.filter((t) => t.pending > 0);
  const questions = g.topics.reduce((n, t) => n + t.questions.length, 0) + g.unplaced.length;
  const thin = g.topics.reduce((n, t) => n + t.thin.length, 0);
  const rechecks = g.topics.reduce((n, t) => n + t.rechecks.length, 0);
  const pending = waiting.reduce((n, t) => n + t.pending, 0);
  return (
    <Page>
      <PageHeader
        title="What it does not know"
        lede="What Blocklore does not cover yet, worked out from what it has published, and what readers asked for. Research takes the topic with the most open gaps next."
      />

      <Block id="suggest-block" title="Suggest a question">
        <Suggest />
      </Block>

      <div className="stats block">
        <Stat value={questions} label="questions short of a full answer" />
        <Stat value={thin} label="thin depths" note={`fewer than ${THIN_AT} claims`} />
        <Stat value={rechecks} label="failed rechecks" />
        <Stat value={pending} label="claims waiting for closer checks" />
      </div>

      <div className="with-rail block">
        <div>
          {open.map((t, i) => (
            <section
              key={t.slug}
              id={t.slug}
              aria-labelledby={`h-${t.slug}`}
              className={i ? "block" : undefined}
            >
              <div className="block-head">
                <h2 id={`h-${t.slug}`}>
                  <Link href={`/topics/${t.slug}`}>{t.title ?? t.slug}</Link>
                </h2>
                <span className="small muted nowrap">
                  {plural(t.claims, "claim")}
                  {t.pending > 0 && `, ${t.pending} in review`}
                </span>
              </div>
              <div className="stack-sm">
                {t.rechecks.length > 0 && (
                  <p className="callout callout-bad">
                    <span>
                      Recheck failed:{" "}
                      {t.rechecks.map((id, j) => (
                        <span key={id}>
                          {j > 0 && ", "}
                          <Link href={`/claims/${id}`}>{id}</Link>
                        </span>
                      ))}
                      .
                    </span>
                  </p>
                )}
                {t.thin.length > 0 && (
                  <p className="small muted">
                    Few claims for{" "}
                    {t.thin.map((d) => `${DEPTH_LABEL[d.depth]} readers (${d.claims})`).join(", ")}.
                  </p>
                )}
                {t.questions.length > 0 && <Questions items={t.questions} />}
              </div>
            </section>
          ))}

          {g.unplaced.length > 0 && (
            <Block id="unplaced" title="Not near any topic">
              <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
                Search found no published claim at all for these.
              </p>
              <Questions items={g.unplaced} />
            </Block>
          )}
        </div>

        <aside className="rail" aria-label="How this list is made">
          <section className="rail-block" aria-label="Topics">
            <h3>By topic</h3>
            <ul className="toc">
              {open.map((t) => (
                <li key={t.slug}>
                  <a href={`#${t.slug}`}>
                    {t.title ?? t.slug} <span className="mono">{t.score}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          {waiting.length > 0 && (
            <section className="rail-block" aria-label="Waiting for review">
              <h3>Waiting for review</h3>
              <p>
                Claims on contested questions, safety, stances or named people get closer checks
                before they publish. Some may already answer the questions here. Research leaves a
                topic alone while any of its claims wait.
              </p>
              <ul>
                {waiting.map((t) => (
                  <li key={t.slug}>
                    {t.claims > 0 ? <Link href={`/topics/${t.slug}`}>{t.title}</Link> : t.slug}:{" "}
                    {plural(t.pending, "claim")}
                    {t.claims === 0 && ", nothing published yet"}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rail-block" aria-label="How this list is made">
            <h3>How this list is made</h3>
            <p>
              Questions come from Blocklore&apos;s test set of 200 with known answers: the ones its
              published claims covered only in part or not at all when last measured
              {g.scored ? ` (${date(g.scored)})` : ""}, placed on the topic whose claims search
              finds nearest, so one can sit near a topic it does not belong to.
            </p>
            <p>
              A depth is thin under {THIN_AT} claims. A failed recheck means a claim no longer
              matched its sources when they were read again.
            </p>
            {g.misses.length > 0 && (
              <p>
                For {plural(g.misses.length, "question")} the claims exist but search ranks them
                below 5: a search gap, not a knowledge gap.
              </p>
            )}
          </section>
        </aside>
      </div>
    </Page>
  );
}
