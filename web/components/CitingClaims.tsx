import { type CitingGroups, DEPTH_LABEL } from "@blocklore/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClaimLine } from "@/components/ClaimLine";
import { Block } from "@/components/ui";
import { getClaim } from "@/lib/data";
import { plural } from "@/lib/format";
import { SOURCE_KIND_LABEL } from "@/lib/labels";

/**
 * The published claims citing one document (a BIP, a BOLT) by topic and depth, numbered in reading
 * order, with their marks, then the code they cite. Shared by the BIP and BOLT pages
 * (core/src/bipview.ts, citingGroups) so both read the same way. `what` names the document in the
 * empty state ("this BIP"); `children` sit between the claims and the code, where a BIP's page puts
 * Bitcoin Core's own entry.
 */
export function CitingClaims({
  v,
  what,
  children,
}: {
  v: CitingGroups;
  what: string;
  children?: ReactNode;
}) {
  const number = new Map(v.claims.map((id, i) => [id, i + 1]));
  const marked = Object.keys(v.marks).length > 0;
  return (
    <>
      <Block
        id="claims"
        title="Claims that cite it"
        aside={
          v.claims.length > 0 && (
            <p>
              {plural(v.claims.length, "claim")}, by topic and depth.
              {marked &&
                " Contested claims, stances and arguments are marked: each reports a position, attributed to who holds it, never Blocklore's view."}
            </p>
          )
        }
      >
        {v.claims.length === 0 ? (
          <p className="empty">
            Blocklore has no claims citing {what} yet.{" "}
            <Link href="/gaps#suggest-block">Suggest a question</Link> for its brain to research.
          </p>
        ) : (
          v.topics.map((t) => (
            <section
              key={t.slug}
              className="bip-topic"
              id={`topic-${t.slug}`}
              aria-labelledby={`topic-${t.slug}-h`}
            >
              <h3 id={`topic-${t.slug}-h`}>
                {t.title ? <Link href={`/topics/${t.slug}`}>{t.title}</Link> : t.slug}
                <small>
                  {plural(
                    t.depths.reduce((k, d) => k + d.claims.length, 0),
                    "claim",
                  )}
                </small>
              </h3>
              {t.depths.map((d) => (
                <div key={d.depth} className="bip-depth">
                  <h4>{DEPTH_LABEL[d.depth]}</h4>
                  <div className="claims">
                    {d.claims.map((id) => {
                      const c = getClaim(id);
                      return c ? (
                        <ClaimLine key={id} claim={c} n={number.get(id) ?? 0} marks={v.marks[id]} />
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </Block>

      {children}

      {v.implementations.length > 0 && (
        <Block
          id="code"
          title="In code"
          aside={<p>Code the claims above cite; a line appears only where a claim cites it.</p>}
        >
          <ul className="lines">
            {v.implementations.map((i) => (
              <li key={i.url}>
                <a href={i.url} rel="noopener noreferrer">
                  {i.title}
                </a>
                <span className="small muted">
                  {SOURCE_KIND_LABEL[i.kind]}
                  {i.repo ? `, ${i.repo}` : ""}, cited by{" "}
                  {i.claims.map((id, k) => (
                    <span key={id}>
                      {k > 0 && " "}
                      <a href={`#${id}`} className="cite" title={getClaim(id)?.statement}>
                        {number.get(id)}
                      </a>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </>
  );
}
