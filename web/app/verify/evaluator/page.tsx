import { MUTATION_LABEL, type Mutation } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { TableWrap } from "@/components/TableWrap";
import { Block, Page, PageHeader, Stat } from "@/components/ui";
import { allClaims, allWithdrawn, bundle } from "@/lib/data";
import { dateTime, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Evaluator",
  description:
    "How Blocklore decides claims on contested questions, safety, positions and named people: the checks every one passes, the test claims that prove the checks work, and what the owner withdrew.",
  alternates: { canonical: "/verify/evaluator" },
};

const pct = (n: number, of: number) => (of === 0 ? "none yet" : `${Math.round((n / of) * 100)}%`);

/**
 * The evaluator's public scorecard: decisions by day, how many of its test claims it caught, what
 * stopped the claims it did not publish, and every claim the owner withdrew. Only counts and
 * published claims appear; nothing unpublished does.
 */
export default function EvaluatorScorecard() {
  const r = bundle.evaluator;
  const claims = allClaims();
  const byEvaluator = claims.filter((c) => c.review?.by === "evaluator").length;
  const byOwner = claims.filter((c) => c.review?.by === "owner").length;
  const withdrawn = allWithdrawn().sort((a, b) =>
    (b.withdrawal?.at.time ?? "").localeCompare(a.withdrawal?.at.time ?? ""),
  );
  const days = [...(r?.days ?? [])].reverse().slice(0, 30);
  const totals = (r?.days ?? []).reduce(
    (t, d) => ({
      published: t.published + d.published,
      held: t.held + d.held,
      rejected: t.rejected + d.rejected,
    }),
    { published: 0, held: 0, rejected: 0 },
  );

  return (
    <Page>
      <PageHeader
        title="Evaluator"
        lede="Claims on contested questions, safety, positions and named people get closer checks before they publish, and a program runs them: it checks every quote and chain fact again, applies rules written from the editorial policy, and asks two verifiers on different models, which must both accept. To prove those checks work, it mixes in test claims, copies of published claims with one thing made false, and stops publishing when it catches too few. The owner can withdraw any claim."
        meta={
          r ? (
            <>
              <span className={`badge ${r.paused ? "badge-warn" : "badge-ok"}`}>
                {r.paused ? "Publishing paused" : "Publishing"}
              </span>
              <span>Updated {dateTime(r.updated.time)}</span>
            </>
          ) : (
            <span>The evaluator has not decided a claim yet.</span>
          )
        }
      />

      <div className="stats block">
        <Stat
          value={r ? pct(r.canaries.recentCaught, r.canaries.recent) : "none yet"}
          label="Test claims caught lately"
          note={
            r
              ? `${r.canaries.recentCaught} of the last ${r.canaries.recent}; publishing needs ${Math.round(r.threshold * 100)}%`
              : undefined
          }
        />
        <Stat value={byEvaluator} label="Claims the evaluator published" note="now on the site" />
        <Stat value={withdrawn.length} label="Withdrawn by the owner" />
        <Stat value={byOwner} label="Approved by the owner by hand" />
      </div>

      {r?.paused && (
        <p className="callout callout-warn block">
          <span>
            <strong>Publishing is paused.</strong> {r.paused}. Claims keep waiting until the
            evaluator catches enough test claims again; nothing that waits is public.
          </span>
        </p>
      )}

      <Block
        id="days"
        title="Decisions by day"
        aside={
          <p className="small muted">
            {totals.published} published, {totals.held} held, {totals.rejected} not published in all
          </p>
        }
      >
        {days.length === 0 ? (
          <p className="empty">No decisions yet.</p>
        ) : (
          <TableWrap label="Decisions by day">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Day (UTC)</th>
                  <th scope="col" className="num">
                    Published
                  </th>
                  <th scope="col" className="num">
                    Held
                  </th>
                  <th scope="col" className="num">
                    Not published
                  </th>
                  <th scope="col" className="num">
                    Test claims
                  </th>
                  <th scope="col" className="num">
                    Caught
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <th scope="row" className="mono">
                      {d.day}
                    </th>
                    <td className="num">{d.published}</td>
                    <td className="num">{d.held}</td>
                    <td className="num">{d.rejected}</td>
                    <td className="num">{d.canaries}</td>
                    <td className="num">{d.caught}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="small muted">
          Held means a check could not finish (a page did not load, a verifier did not answer) or
          publishing was paused; it is tried again later. Not published means a check failed.
        </p>
      </Block>

      <div className="grid-2">
        <Block id="canaries" title="Test claims, by what was made false">
          {!r || r.canaries.kinds.length === 0 ? (
            <p className="empty">No test claims yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Made false</th>
                  <th scope="col" className="num">
                    Tried
                  </th>
                  <th scope="col" className="num">
                    Caught
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.canaries.kinds.map((k) => (
                  <tr key={k.kind}>
                    <th scope="row">{MUTATION_LABEL[k.kind as Mutation] ?? k.kind}</th>
                    <td className="num">{k.n}</td>
                    <td className="num">{pct(k.caught, k.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r && (
            <p className="small muted">
              {plural(r.canaries.total, "test claim")} so far, {r.canaries.caught} caught. A test
              claim never publishes: the publisher refuses its id and its words before it writes
              anything.
            </p>
          )}
        </Block>

        <Block id="stopped" title="What stopped claims">
          {!r || r.stopped.length === 0 ? (
            <p className="empty">Nothing has been stopped yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col" className="num">
                    Claims
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.stopped.map((s) => (
                  <tr key={s.check}>
                    <th scope="row">{s.check}</th>
                    <td className="num">{s.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Block>
      </div>

      <Block id="withdrawn" title="Withdrawn by the owner">
        {withdrawn.length === 0 ? (
          <p className="empty">The owner has withdrawn no claim.</p>
        ) : (
          <ul className="rows">
            {withdrawn.map((c) => (
              <li key={c.id} className="row-item">
                <div className="stack-sm">
                  <Link href={`/claims/${c.id}`}>{c.statement}</Link>
                  <span className="small muted">{c.withdrawal?.note}</span>
                </div>
                <span className="row-side small muted">
                  {c.withdrawal ? dateTime(c.withdrawal.at.time) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          A withdrawal is a new revision, never an edit: the claim keeps its page and history, and
          leaves every topic, list and search. Each one also becomes a test claim and a lesson for
          research.
        </p>
      </Block>

      <Block id="how" title="How a claim is decided">
        <ol className="plain-list stack-sm">
          <li>
            <strong>Recheck.</strong> Every quote is fetched again and must still be found; every
            chain and code check runs again.
          </li>
          <li>
            <strong>Rules.</strong> Code written from the editorial policy: primary evidence, and
            for positions a dated, linked attribution in the proponent&apos;s own words; for safety,
            two independent sources and no advice voice; for named people, their words or a primary
            record.
          </li>
          <li>
            <strong>Two verifiers.</strong> Two separate runs on different models read the claim and
            its sources. Both must accept; a request to revise is a no.
          </li>
          <li>
            <strong>Calibration.</strong> If the evaluator lets through a test claim, or catches too
            few lately, nothing publishes until it does better.
          </li>
        </ol>
        <p className="small muted">
          A failed check means the claim does not publish. A check that cannot finish means it
          waits. <Link href="/verify">Snapshots</Link> prove what was published and when.
        </p>
      </Block>
    </Page>
  );
}
