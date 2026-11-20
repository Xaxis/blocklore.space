import { DEPTH_LABEL, type GapQuestion, THIN_AT } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { bundle } from "@/lib/data";
import { date, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Open gaps",
  description:
    "What Blocklore does not cover yet: questions it answers only in part or not at all, depths with few claims, and claims whose sources no longer bear them out.",
  alternates: { canonical: "/gaps" },
};

const GOT: Record<string, string> = {
  partial: "answered in part",
  not_covered: "not covered",
  no_match: "no claim found",
  check_failed: "the answer failed its check",
  model_declined: "no answer written",
};

function Questions({ items }: { items: GapQuestion[] }) {
  return (
    <ul className="gap-questions">
      {items.map((q) => (
        <li key={q.id}>
          {q.q} <span className="muted">({GOT[q.got] ?? q.got})</span>
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
    <div className="wrap">
      <header className="page-head">
        <h1>Open gaps</h1>
        <p className="lede">
          What Blocklore does not cover yet, worked out from what it has published: questions it
          answers only in part or not at all, depths where a topic has few claims, and claims whose
          sources no longer bear them out. Research takes the topic with the most open gaps next.
        </p>
      </header>

      <p className="badges">
        {plural(questions, "question")} short of a full answer; {plural(thin, "thin depth")};{" "}
        {plural(rechecks, "failed recheck")}; {plural(pending, "claim")} waiting for review.
      </p>

      <article className="doc gaps">
        {open.map((t) => (
          <section key={t.slug} id={t.slug} aria-labelledby={`h-${t.slug}`}>
            <h2 id={`h-${t.slug}`}>
              <Link href={`/topics/${t.slug}`}>{t.title ?? t.slug}</Link>
            </h2>
            <p className="muted gap-facts">
              {plural(t.claims, "claim")} published
              {t.pending > 0 && `, ${t.pending} waiting for review`}.
            </p>
            {t.rechecks.length > 0 && (
              <p>
                Recheck failed:{" "}
                {t.rechecks.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link href={`/claims/${id}`}>{id}</Link>
                  </span>
                ))}
                .
              </p>
            )}
            {t.thin.length > 0 && (
              <p>
                Few claims for{" "}
                {t.thin.map((d) => `${DEPTH_LABEL[d.depth]} readers (${d.claims})`).join(", ")}.
              </p>
            )}
            {t.questions.length > 0 && <Questions items={t.questions} />}
          </section>
        ))}

        {g.unplaced.length > 0 && (
          <section id="unplaced" aria-labelledby="h-unplaced">
            <h2 id="h-unplaced">Not near any topic</h2>
            <p>Search found no published claim at all for these.</p>
            <Questions items={g.unplaced} />
          </section>
        )}

        {waiting.length > 0 && (
          <section id="waiting" aria-labelledby="h-waiting">
            <h2 id="h-waiting">Waiting for review</h2>
            <p>
              Claims that touch contested questions, safety advice, stances or named people wait for
              the owner before they publish. Some of the questions above may already be answered by
              them. Research leaves a topic alone while any of its claims wait.
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

        <h2 id="how">How this list is made</h2>
        <ul>
          <li>
            The questions are the golden questions Ask answered only in part or not at all when it
            was last scored
            {g.scored ? ` (${date(g.scored)})` : ""}, placed on the topic whose claims search finds
            nearest, so a question can sit near a topic it does not belong to. The{" "}
            <Link href="/scorecard">scorecard</Link> has the scores; questions readers ask go to the{" "}
            <Link href="/queue">research queue</Link>.
          </li>
          <li>
            A depth is thin when a topic has fewer than {THIN_AT} claims written for it, so the
            depth dial has little to show there.
          </li>
          <li>
            A failed recheck means a published claim no longer matched its sources when they were
            read again; it stays up, marked, until a correction or a later recheck.
          </li>
          {g.misses.length > 0 && (
            <li>
              For {plural(g.misses.length, "question")} the claims exist but search ranks them below
              5: a search gap rather than a knowledge gap, listed on the{" "}
              <Link href="/scorecard#misses">scorecard</Link>.
            </li>
          )}
          <li>
            Research picks the topic with the most open gaps among those with nothing waiting for
            review, and is told these questions, to answer the ones within its scope.
          </li>
        </ul>
      </article>
    </div>
  );
}
