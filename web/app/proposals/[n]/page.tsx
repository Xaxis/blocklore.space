import { type BipChange, bipSignaling, DEPTH_LABEL } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimLine } from "@/components/ClaimLine";
import { Block, FeedItem, Page, PageHeader } from "@/components/ui";
import { VersionBits } from "@/components/VersionBits";
import { bipNumbers, getBip, readBipNumber } from "@/lib/bips";
import { bundle, getClaim } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";
import { bipStatusTone, SOURCE_KIND_LABEL } from "@/lib/labels";

// A page per BIP: only what Blocklore's own record holds. The entry is the BIP index's at the
// commit it was read at; every sentence under it is a published claim; code appears only where a
// claim cites it. No sentence here is written about the BIP. BIP 9 and BIP 320, which define the
// version bits, show the period's tally, and a BIP whose deployment Bitcoin Core's chainparams
// defines shows its bit's row (core/src/signaling.ts).

export const dynamicParams = false;

export function generateStaticParams() {
  return bipNumbers().map((n) => ({ n: String(n) }));
}

const bipOfParams = async (params: Promise<{ n: string }>) => {
  const n = readBipNumber((await params).n);
  return n === null ? null : getBip(n);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const v = await bipOfParams(params);
  if (!v) return {};
  const { n, title, status, layer, type } = v.entry;
  return {
    title: `BIP ${n}, ${title}`,
    description: `BIP ${n} as the bitcoin/bips index lists it: ${layer ?? type}, ${status}. ${
      v.claims.length
        ? `${plural(v.claims.length, "claim")} on Blocklore cite it, each with its sources and quotes.`
        : "No claim on Blocklore cites it yet."
    }`,
    alternates: { canonical: `/proposals/${n}` },
  };
}

const FIELD: Record<BipChange["field"], string> = {
  added: "Added",
  removed: "Removed",
  status: "Status",
  title: "Title",
  type: "Type",
  layer: "Layer",
};

/** One recorded change to the entry, in the index's own words. */
function change(c: BipChange): string {
  if (c.field === "added") return c.after ? `to the index as ${c.after}` : "to the index";
  if (c.field === "removed")
    return c.before ? `from the index; it was ${c.before}` : "from the index";
  return `${c.before ?? "none"} to ${c.after ?? "none"}`;
}

export default async function BipPage({ params }: { params: Promise<{ n: string }> }) {
  const v = await bipOfParams(params);
  if (!v) notFound();
  const { entry } = v;
  const number = new Map(v.claims.map((id, i) => [id, i + 1]));
  const marked = Object.keys(v.marks).length > 0;
  const signaling = bipSignaling(entry.n, bundle.signaling);

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: "/proposals", label: "Proposals" },
          { href: "/bips", label: "BIP index" },
          { label: `BIP ${entry.n}` },
        ]}
        title={`BIP ${entry.n}, ${entry.title}`}
        lede={`Its title, layer, type and status as the bitcoin/bips index lists them; the status is the index's own, not Blocklore's judgment.${v.text ? " Its owners are named in its text." : ""}`}
        meta={
          <>
            <span className={`badge ${bipStatusTone(entry.status)}`}>{entry.status}</span>
            {entry.layer && <span>{entry.layer}</span>}
            <span>{entry.type}</span>
            <span>
              Index at{" "}
              <a href={v.index} className="mono" rel="noopener noreferrer">
                {v.commit.slice(0, 10)}
              </a>
            </span>
            {v.text ? (
              <a href={v.text} rel="noopener noreferrer">
                Its text at this commit
              </a>
            ) : (
              <span>The index lists no file for it</span>
            )}
          </>
        }
      />

      {signaling && bundle.signaling && (
        <VersionBits
          s={bundle.signaling}
          only={signaling.scheme ? undefined : signaling.deployments}
        />
      )}

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
            Blocklore has no claims citing this BIP yet.{" "}
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

      <Block
        id="history"
        title="In the index"
        aside={
          <p>
            Read {dateTime(v.read.time)}, block{" "}
            <span className="mono">{height(v.read.height)}</span>
          </p>
        }
      >
        {v.history.length > 0 ? (
          <ol className="feed">
            {v.history.map((c) => (
              <FeedItem
                key={`${c.field}-${c.commit}-${c.at.time}`}
                when={dateTime(c.at.time)}
                block={c.at.height}
              >
                <p>
                  <span className="badge">{FIELD[c.field]}</span> {change(c)}
                </p>
                <div className="feed-meta">
                  <a
                    href={`https://github.com/bitcoin/bips/blob/${c.commit}/README.mediawiki`}
                    rel="noopener noreferrer"
                  >
                    Index at <span className="mono">{c.commit.slice(0, 10)}</span>
                  </a>
                </div>
              </FeedItem>
            ))}
          </ol>
        ) : (
          <p className="empty">
            Blocklore has seen no change to this entry since it began reading the index. Each change
            it sees appears here with the commit that made it.
          </p>
        )}
      </Block>
    </Page>
  );
}
