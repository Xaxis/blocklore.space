import {
  compareUrl,
  DEPTH_LABEL,
  type GapQuestion,
  researchedAfter,
  THIN_AT,
} from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Suggest } from "@/components/Suggest";
import { Advisories } from "@/components/security/parts";
import { Block, Page, PageHeader, Stat } from "@/components/ui";
import { allClaims, bundle } from "@/lib/data";
import { date, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "What it does not know",
  description:
    "What Blocklore does not cover yet: questions it answers only in part or not at all, depths with few claims, claims whose sources no longer bear them out, passages the code or specification has moved on from, and security advisories not yet on the threat map.",
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
  // Passages a claim quotes at a pinned commit that are no longer in the file at the repository's
  // head, as the brain last read them (core/src/athead.ts).
  const moved = allClaims().flatMap((c) =>
    c.at_head
      .filter((a) => a.state !== "current")
      .map((a) => ({
        id: c.id,
        a,
        looked: researchedAfter(c.topics[0] ?? "", a.since, bundle.runs),
      })),
  );
  return (
    <Page>
      <PageHeader
        title="What it does not know"
        lede="What Blocklore does not cover yet, worked out from what it has published, and what readers asked for. Research looks first at claims readers reported and the questions below, then takes the topic with the most open gaps, and a question is marked answered once the claims that answer it publish."
      />

      <Block id="suggest-block" title="Suggest a question">
        <Suggest />
      </Block>

      <div className="stats block">
        <Stat value={questions} label="questions short of a full answer" />
        <Stat value={thin} label="thin depths" note={`fewer than ${THIN_AT} claims`} />
        <Stat value={rechecks} label="failed rechecks" />
        <Stat value={moved.length} label="sources moved on" note="at their repository's head" />
        <Stat value={pending} label="claims waiting for closer checks" />
        <Stat value={g.advisories.length} label="advisories to map" note="on no threat yet" />
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
                  {/* a topic with nothing published has no page yet */}
                  {t.title ? <Link href={`/topics/${t.slug}`}>{t.title}</Link> : t.slug}
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
                {t.moved.length > 0 && (
                  <p className="small muted">
                    Sources moved on:{" "}
                    {[...new Set(t.moved.map((m) => m.claim))].map((id, j) => (
                      <span key={id}>
                        {j > 0 && ", "}
                        <Link href={`/claims/${id}#evidence`}>{id}</Link>
                      </span>
                    ))}
                    .
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

          {bundle.atHead && (
            <Block
              id="moved"
              title="Sources that moved on"
              aside={<span className="small muted">{plural(moved.length, "passage")}</span>}
            >
              <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
                Each day the brain reads every passage a claim quotes from a file at a pinned commit
                again at the head of its repository,{" "}
                {plural(bundle.atHead.heads.length, "repository", "repositories")} in all, last on{" "}
                {date(bundle.atHead.read.time)}. These are no longer there. Each claim still holds
                as cited at its commit, but may no longer describe the code or specification as it
                is today. The next research run on each one&apos;s topic has it in its task: it
                cites a claim about the code as it is now at head, or corrects it, and leaves a
                claim about what happened then as it is.
              </p>
              {moved.length ? (
                <ul className="rows">
                  {moved.map(({ id, a, looked }) => (
                    <li
                      key={`${id}#${a.source}`}
                      className="row-item"
                      style={{ padding: "var(--s3) 0" }}
                    >
                      <p>
                        <Link href={`/claims/${id}#evidence`}>{id}</Link>, source {a.source + 1}:{" "}
                        <span className="mono">{a.path}</span> in {a.repo}{" "}
                        {a.state === "gone" ? "is gone at its head" : "no longer has the passage"} (
                        <a href={compareUrl(a)} rel="noopener noreferrer">
                          compare
                        </a>
                        ).{" "}
                        <span className="muted">
                          {looked
                            ? `Research had it in its task on ${date(looked.time)}; the claim stands as cited.`
                            : "Waiting for research on its topic."}
                        </span>
                      </p>
                      <span className="badge badge-info">
                        {a.state === "gone" ? "gone" : "changed"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Every passage is still at its repository&apos;s head.</p>
              )}
            </Block>
          )}

          <Block
            id="advisories"
            title="Advisories to map"
            aside={
              <span className="small muted">
                {plural(g.advisories.length, "advisory", "advisories")}
              </span>
            }
          >
            <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
              Security advisories the projects published that no rule files under a threat on the{" "}
              <Link href="/security">security map</Link>. The owner files each in the advisory map,
              or adds the threat it concerns; until then it waits here. Research does not take
              these.
            </p>
            {g.advisories.length ? (
              <Advisories items={g.advisories} />
            ) : (
              <p className="empty">Every advisory the watch has read is filed under a threat.</p>
            )}
          </Block>
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
              matched its sources when they were read again. A source moved on when the passage a
              claim quotes from a pinned commit is no longer at its repository&apos;s head.
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
