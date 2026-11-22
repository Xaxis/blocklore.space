import type { ChangeEvent } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Block, Page, PageHeader } from "@/components/ui";
import { digests, getTopic } from "@/lib/data";
import { dateLong, height, plural } from "@/lib/format";

export const dynamicParams = false;

export function generateStaticParams() {
  return digests().map((d) => ({ date: d.date }));
}

const find = (date: string) => digests().find((d) => d.date === date);

export async function generateMetadata({ params }: PageProps<"/digest/[date]">): Promise<Metadata> {
  const { date } = await params;
  const d = find(date);
  return d
    ? {
        title: `Digest for ${dateLong(`${date}T00:00:00Z`)}`,
        alternates: { canonical: `/digest/${date}` },
      }
    : {};
}

function Lines({ events, withBefore = false }: { events: ChangeEvent[]; withBefore?: boolean }) {
  return (
    <ul className="lines">
      {events.map((e) => (
        <li key={`${e.claim}-${e.rev}`}>
          <Link href={`/claims/${e.claim}`}>{e.statement}</Link>
          {withBefore && e.before?.statement && e.before.statement !== e.statement && (
            <p className="small muted">
              Before: <del>{e.before.statement}</del>
            </p>
          )}
          {withBefore && e.note && <p className="small muted">{e.note}</p>}
        </li>
      ))}
    </ul>
  );
}

export default async function Digest({ params }: PageProps<"/digest/[date]">) {
  const { date } = await params;
  const d = find(date);
  if (!d) notFound();
  const all = digests();
  const i = all.indexOf(d);
  const newer = all[i - 1];
  const older = all[i + 1];
  const created = d.created.reduce((n, g) => n + g.events.length, 0);
  const parts = [
    created && plural(created, "new claim"),
    d.corrections.length && plural(d.corrections.length, "correction"),
    d.revisions.length && plural(d.revisions.length, "other revision"),
    d.bips.length && plural(d.bips.length, "BIP index change"),
  ].filter((p): p is string => Boolean(p));
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/digest", label: "Digests" }, { label: date }]}
        title={dateLong(`${date}T00:00:00Z`)}
        lede={`${said ? `${said[0]?.toUpperCase()}${said.slice(1)}` : "No changes"}. Every line links to its evidence.`}
        meta={
          <span className="mono">
            blocks {height(d.heights.from)} to {height(d.heights.to)}
          </span>
        }
      />

      <div className="measure">
        {d.corrections.length > 0 && (
          <Block id="corrections" title="Corrections">
            <p className="small muted block-note">These replace something Blocklore said before.</p>
            <Lines events={d.corrections} withBefore />
          </Block>
        )}

        {d.created.map((g) => {
          const t = getTopic(g.topic);
          return (
            <Block
              key={g.topic}
              id={`topic-${g.topic}`}
              title={t?.title ?? g.topic}
              aside={
                <p>
                  {plural(g.events.length, "new claim")}
                  {t && (
                    <>
                      {" "}
                      on <Link href={`/topics/${t.slug}`}>the topic page</Link>
                    </>
                  )}
                </p>
              }
            >
              <Lines events={g.events} />
            </Block>
          );
        })}

        {d.revisions.length > 0 && (
          <Block id="revisions" title="Other revisions">
            <Lines events={d.revisions} withBefore />
          </Block>
        )}

        {d.bips.length > 0 && (
          <Block id="bips" title="The BIP index">
            <ul className="lines">
              {d.bips.map((c) => (
                <li key={`${c.n}-${c.field}`}>
                  BIP {c.n}, {c.title}: {c.field}
                  {c.before !== undefined && c.after !== undefined
                    ? `, ${c.before} to ${c.after}`
                    : c.after
                      ? `, ${c.after}`
                      : ""}{" "}
                  <span className="small muted">
                    (
                    <a href={`https://github.com/bitcoin/bips/blob/${c.commit}/README.mediawiki`}>
                      index at <span className="mono">{c.commit.slice(0, 10)}</span>
                    </a>
                    )
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {d.runs.length > 0 && (
          <Block id="runs" title="Research runs that finished">
            <ul className="lines">
              {d.runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/log/${r.id}`} className="mono">
                    {r.id}
                  </Link>
                  <p className="small muted">
                    {plural(r.published, "claim")} published, {plural(r.revised, "revision")},{" "}
                    {r.held} held for closer checks
                  </p>
                </li>
              ))}
            </ul>
          </Block>
        )}

        <nav className="pager" aria-label="Other days">
          {older ? (
            <Link href={`/digest/${older.date}`}>
              <span className="small muted">Earlier</span>
              {dateLong(`${older.date}T00:00:00Z`)}
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link href={`/digest/${newer.date}`} className="pager-next">
              <span className="small muted">Later</span>
              {dateLong(`${newer.date}T00:00:00Z`)}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </Page>
  );
}
