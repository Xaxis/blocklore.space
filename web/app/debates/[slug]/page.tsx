import type { ClaimMark, DebateNode, DebateView } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimLine } from "@/components/ClaimLine";
import { Block, Page, PageHeader } from "@/components/ui";
import { getClaim } from "@/lib/data";
import { allDebates, debateTopics, getDebate } from "@/lib/debates";
import { date, height, plural } from "@/lib/format";

// One debate map (core/src/debateview.ts). The question and the position labels are the map's only
// words of its own; every other sentence is a published claim, opened in place for its sources.
// Positions sit side by side in the map's order, which is not a ranking. Supports and rebuts are
// lists of links under each claim, so they read without a picture.

export const dynamicParams = false;

export function generateStaticParams() {
  return allDebates().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const d = getDebate((await params).slug);
  if (!d) return {};
  return {
    title: d.question,
    description: `A map of the positions on this question: ${d.positions.map((p) => p.label).join("; ")}. Each in its holders' words, attributed and dated, with the claims of fact and definition they rest on.`,
    alternates: { canonical: `/debates/${d.slug}` },
  };
}

const REL: { key: "supports" | "rebuts" | "supportedBy" | "rebuttedBy"; label: string }[] = [
  { key: "supports", label: "Supports" },
  { key: "rebuts", label: "Rebuts" },
  { key: "supportedBy", label: "Supported by" },
  { key: "rebuttedBy", label: "Rebutted by" },
];

/** Where a claim sits on the map, in words: its position's label, or the shared ground's name. */
function placeOf(d: DebateView, n: DebateNode): string {
  if (n.nature === "empirical") return "shared evidence";
  if (n.nature === "definitional") return "a shared definition";
  return d.positions.find((p) => p.id === n.position)?.label ?? "";
}

function Node({ d, id }: { d: DebateView; id: string }) {
  const n = d.nodes[id];
  const claim = getClaim(id);
  if (!n || !claim) return null;
  const marks: ClaimMark[] = n.kind === "stance" || n.kind === "argument" ? [n.kind] : [];
  const rels = REL.map((r) => ({ ...r, ids: n[r.key] })).filter((r) => r.ids.length > 0);
  return (
    <li className="debate-node">
      <ClaimLine claim={claim} n={n.n} href={`/claims/${id}`} marks={marks} />
      {n.holders.length > 0 && (
        <p className="debate-holders">
          {n.kind === "argument" ? "Argued by " : "Held by "}
          {n.holders.map((h, i) => (
            <span key={h.name}>
              {i > 0 && "; "}
              {h.url ? (
                <a href={h.url} rel="noopener noreferrer">
                  {h.name}
                </a>
              ) : (
                h.name
              )}
              {h.stated && <span className="muted">, stated {date(h.stated)}</span>}
            </span>
          ))}
        </p>
      )}
      {rels.length > 0 && (
        <ul className="debate-rels" aria-label={`How claim ${n.n} bears on the others`}>
          {rels.map((r) => (
            <li key={r.key}>
              <span className="debate-rel">{r.label}</span>
              {r.ids.map((other) => {
                const o = d.nodes[other];
                return o ? (
                  <a
                    key={other}
                    href={`#${other}`}
                    className="cite"
                    title={`${o.statement} (${placeOf(d, o)})`}
                  >
                    <span className="visually-hidden">claim </span>
                    {o.n}
                  </a>
                ) : null;
              })}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function DebatePage({ params }: { params: Promise<{ slug: string }> }) {
  const d = getDebate((await params).slug);
  if (!d) notFound();
  const topics = debateTopics(d);
  const shared = d.empirical.length + d.definitional.length;

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/debates", label: "Debates" }]}
        title={d.question}
        lede="The positions on this question side by side, each stance and argument attributed to who holds it and dated, then the claims of fact and definition the sides share. Blocklore takes no side on the values in it; the order of the positions is not a ranking."
        meta={
          <>
            <span className="badge badge-warn">Contested question</span>
            <span>{plural(d.positions.length, "position")}</span>
            <span>{plural(d.claims.length, "claim")}</span>
            {topics.map((t) => (
              <Link key={t.slug} href={`/topics/${t.slug}`}>
                {t.title}
              </Link>
            ))}
            <span>
              Updated {date(d.updated.time)}, block{" "}
              <span className="mono">{height(d.updated.height)}</span>
            </span>
          </>
        }
      />

      <Block
        id="positions"
        title="Positions"
        aside={
          <p>What each side holds, in its holders&apos; words. Open a claim for its sources.</p>
        }
      >
        <div className="debate-sides">
          {d.positions.map((p) => (
            <section key={p.id} className="debate-side" aria-labelledby={`side-${p.id}`}>
              <h3 id={`side-${p.id}`}>
                {p.label}
                <small>{plural(p.claims.length, "claim")}</small>
              </h3>
              <ol className="debate-nodes">
                {p.claims.map((id) => (
                  <Node key={id} d={d} id={id} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      </Block>

      <Block
        id="shared"
        title="What evidence or a shared definition could settle"
        aside={<p>Claims every side meets: data, code or a definition, not a value.</p>}
      >
        {shared === 0 ? (
          <p className="empty">
            No claim of fact or definition is on this map yet: as far as its claims go, every
            disagreement in it is about values.
          </p>
        ) : (
          <div className="debate-ground">
            {d.empirical.length > 0 && (
              <section aria-labelledby="ground-empirical">
                <h3 id="ground-empirical">
                  Evidence could settle
                  <small>facts, mechanisms, events and traces in specs and code</small>
                </h3>
                <ol className="debate-nodes">
                  {d.empirical.map((id) => (
                    <Node key={id} d={d} id={id} />
                  ))}
                </ol>
              </section>
            )}
            {d.definitional.length > 0 && (
              <section aria-labelledby="ground-definitional">
                <h3 id="ground-definitional">
                  A shared definition could settle
                  <small>where people may use one word for different things</small>
                </h3>
                <ol className="debate-nodes">
                  {d.definitional.map((id) => (
                    <Node key={id} d={d} id={id} />
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </Block>

      {d.edges.length > 0 && (
        <Block
          id="links"
          title="How the claims bear on each other"
          aside={<p>Each link as the map states it; the numbers are the claims above.</p>}
        >
          <ul className="lines debate-edges">
            {d.edges.map((e) => {
              const from = d.nodes[e.from];
              const to = d.nodes[e.to];
              if (!from || !to) return null;
              return (
                <li key={`${e.from} ${e.rel} ${e.to}`}>
                  <span>
                    <a href={`#${e.from}`} className="cite" title={from.statement}>
                      <span className="visually-hidden">claim </span>
                      {from.n}
                    </a>{" "}
                    {e.rel}{" "}
                    <a href={`#${e.to}`} className="cite" title={to.statement}>
                      <span className="visually-hidden">claim </span>
                      {to.n}
                    </a>
                  </span>
                  <span className="small muted">
                    From {placeOf(d, from)} to {placeOf(d, to)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      )}
    </Page>
  );
}
