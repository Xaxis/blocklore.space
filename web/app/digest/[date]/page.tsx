import type { ChangeEvent } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  return d ? { title: `Digest for ${dateLong(`${date}T00:00:00Z`)}` } : {};
}

function Lines({ events, withBefore = false }: { events: ChangeEvent[]; withBefore?: boolean }) {
  return (
    <ul className="digest-lines">
      {events.map((e) => (
        <li key={`${e.claim}-${e.rev}`}>
          <Link href={`/claims/${e.claim}`}>{e.statement}</Link>
          {withBefore && e.before?.statement && e.before.statement !== e.statement && (
            <div className="diff">
              <del>{e.before.statement}</del>
            </div>
          )}
          {withBefore && e.note && <div className="muted digest-note">{e.note}</div>}
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
    <div className="wrap narrow">
      <header className="page-head">
        <div className="crumbs">
          <Link href="/digest">Daily digest</Link> / {date}
        </div>
        <h1>{dateLong(`${date}T00:00:00Z`)}</h1>
        <p className="lede">
          Blocks {height(d.heights.from)} to {height(d.heights.to)}: {said}. Every line links to its
          evidence.
        </p>
      </header>

      {d.corrections.length > 0 && (
        <section aria-labelledby="corr-h">
          <h2 id="corr-h">Corrections</h2>
          <p className="muted">
            These replace something Blocklore said before. The old wording is struck through.
          </p>
          <Lines events={d.corrections} withBefore />
        </section>
      )}

      {d.created.map((g) => {
        const t = getTopic(g.topic);
        return (
          <section key={g.topic} aria-label={t?.title ?? g.topic}>
            <div className="section-head">
              <h2>{t?.title ?? g.topic}</h2>
              <span className="muted">
                {plural(g.events.length, "new claim")}
                {t && (
                  <>
                    {" "}
                    on <Link href={`/topics/${t.slug}`}>the topic page</Link>
                  </>
                )}
              </span>
            </div>
            <Lines events={g.events} />
          </section>
        );
      })}

      {d.revisions.length > 0 && (
        <section aria-labelledby="rev-h">
          <h2 id="rev-h">Other revisions</h2>
          <Lines events={d.revisions} withBefore />
        </section>
      )}

      {d.bips.length > 0 && (
        <section aria-labelledby="bip-h">
          <h2 id="bip-h">The BIP index</h2>
          <ul className="digest-lines">
            {d.bips.map((c) => (
              <li key={`${c.n}-${c.field}`}>
                BIP {c.n}, {c.title}: {c.field}
                {c.before !== undefined && c.after !== undefined
                  ? `, ${c.before} to ${c.after}`
                  : c.after
                    ? `, ${c.after}`
                    : ""}{" "}
                (
                <a href={`https://github.com/bitcoin/bips/blob/${c.commit}/README.mediawiki`}>
                  at {c.commit.slice(0, 10)}
                </a>
                )
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.runs.length > 0 && (
        <section aria-labelledby="runs-h">
          <h2 id="runs-h">Research runs that finished</h2>
          <ul className="digest-lines">
            {d.runs.map((r) => (
              <li key={r.id}>
                <Link href={`/log/${r.id}`}>{r.id}</Link>: {plural(r.published, "claim")} published,{" "}
                {plural(r.revised, "revision")}, {r.held} held for the owner&apos;s review
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="pager" aria-label="Other days">
        {older ? <Link href={`/digest/${older.date}`}>Earlier: {older.date}</Link> : <span />}
        {newer ? <Link href={`/digest/${newer.date}`}>Later: {newer.date}</Link> : <span />}
      </nav>
    </div>
  );
}
