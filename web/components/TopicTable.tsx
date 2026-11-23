import { type BundleClaim, type BundleTopic, DEPTHS, type Stamp } from "@blocklore/core";
import Link from "next/link";
import { bundle, GROUPS, getClaim, topicClaims } from "@/lib/data";
import { date, height } from "@/lib/format";
import { Coverage } from "./ui";

const titleCase = (slug: string) => slug.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());

/** One topic's row: its claims, opening claim and newest change, now or at a past moment. */
export interface TopicRow {
  slug: string;
  title: string;
  group: BundleTopic["group"];
  contested: boolean;
  pendingReview: number;
  claims: BundleClaim[];
  lede: BundleClaim | null;
  updated: Stamp | null;
}

const live = (): TopicRow[] =>
  bundle.topics.map((t) => ({
    ...t,
    claims: topicClaims(t),
    lede: getClaim(t.lede) ?? null,
  }));

/**
 * Every topic, grouped, with how many claims it has at each depth and when it last changed. With
 * `at`, the rows are the topics as they stood at that moment (the time machine) and link there.
 */
export function TopicTable({
  withLede = true,
  rows = live(),
  at,
}: {
  withLede?: boolean;
  rows?: TopicRow[];
  /** The moment as written in a URL, when the rows are the time machine's. */
  at?: string;
}) {
  const published = new Set(bundle.topics.map((t) => t.slug));
  const waiting = at ? [] : bundle.review.filter((r) => !published.has(r.topic) && r.count > 0);
  return (
    <div className="table-wrap">
      <table className="table topic-table">
        <caption className="visually-hidden">
          Topics by group, with claims, depth coverage and the last update
        </caption>
        <thead>
          <tr>
            <th scope="col">Topic</th>
            <th scope="col" className="num">
              Facts
            </th>
            <th scope="col">
              <span title="Curious, User, Holder, Builder, Researcher">Depths</span>
            </th>
            <th scope="col" className="num">
              Updated
            </th>
          </tr>
        </thead>
        {GROUPS.map((g) => {
          const topics = rows.filter((t) => t.group === g.id);
          if (topics.length === 0) return null;
          return (
            <tbody key={g.id} id={g.id}>
              <tr className="group-row">
                <th scope="colgroup" colSpan={4}>
                  {g.label} <span className="muted small">{g.blurb}</span>
                </th>
              </tr>
              {topics.map((t) => {
                const counts = DEPTHS.map((d) => t.claims.filter((c) => c.depth === d).length);
                return (
                  <tr key={t.slug}>
                    <td>
                      <Link href={`/topics/${t.slug}${at ? `/at/${at}` : ""}`}>
                        <strong>{t.title}</strong>
                      </Link>
                      {t.contested && (
                        <>
                          {" "}
                          <span className="badge badge-warn">Contested</span>
                        </>
                      )}
                      {t.pendingReview > 0 && (
                        <>
                          {" "}
                          <span className="badge">{t.pendingReview} in review</span>
                        </>
                      )}
                      {withLede && t.lede && <p>{t.lede.statement}</p>}
                      {withLede && !t.lede && <p className="muted">No claims yet.</p>}
                    </td>
                    <td className="num">{t.claims.length}</td>
                    <td>
                      <Coverage counts={counts} />
                    </td>
                    <td className="num">
                      {t.updated ? (
                        <span title={date(t.updated.time)}>{height(t.updated.height)}</span>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
        {waiting.length > 0 && (
          <tbody id="in-review">
            <tr className="group-row">
              <th scope="colgroup" colSpan={4}>
                In review{" "}
                <span className="muted small">
                  Researched and checked; nothing publishes until it passes the closer checks.
                </span>
              </th>
            </tr>
            {waiting.map((w) => (
              <tr key={w.topic}>
                <td>
                  <strong className="muted">{titleCase(w.topic)}</strong>
                  {withLede && (
                    <p>
                      Contested or touches safety, so every claim gets closer checks before it
                      publishes.
                    </p>
                  )}
                </td>
                <td className="num muted">{w.count}</td>
                <td>
                  <span className="badge">Waiting</span>
                </td>
                <td className="num muted">n/a</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
