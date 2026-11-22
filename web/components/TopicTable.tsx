import { DEPTHS } from "@blocklore/core";
import Link from "next/link";
import { bundle, GROUPS, getClaim, topicClaims } from "@/lib/data";
import { date, height } from "@/lib/format";
import { Coverage } from "./ui";

const titleCase = (slug: string) => slug.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());

/** Every topic, grouped, with how many claims it has at each depth and when it last changed. */
export function TopicTable({ withLede = true }: { withLede?: boolean }) {
  const published = new Set(bundle.topics.map((t) => t.slug));
  const waiting = bundle.review.filter((r) => !published.has(r.topic) && r.count > 0);
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
          const topics = bundle.topics.filter((t) => t.group === g.id);
          if (topics.length === 0) return null;
          return (
            <tbody key={g.id} id={g.id}>
              <tr className="group-row">
                <th scope="colgroup" colSpan={4}>
                  {g.label} <span className="muted small">{g.blurb}</span>
                </th>
              </tr>
              {topics.map((t) => {
                const claims = topicClaims(t);
                const counts = DEPTHS.map((d) => claims.filter((c) => c.depth === d).length);
                const lede = getClaim(t.lede);
                return (
                  <tr key={t.slug}>
                    <td>
                      <Link href={`/topics/${t.slug}`}>
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
                      {withLede && lede && <p>{lede.statement}</p>}
                    </td>
                    <td className="num">{t.claimCount}</td>
                    <td>
                      <Coverage counts={counts} />
                    </td>
                    <td className="num">
                      <span title={date(t.updated.time)}>{height(t.updated.height)}</span>
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
