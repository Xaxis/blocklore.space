import { type BipChange, bipSignaling } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CitingClaims } from "@/components/CitingClaims";
import { Block, FeedItem, Page, PageHeader } from "@/components/ui";
import { VersionBits } from "@/components/VersionBits";
import { bipHref, bipNumbers, getBip, readBipNumber } from "@/lib/bips";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";
import { bipStatusTone } from "@/lib/labels";

// A page per BIP: only what Blocklore's own record holds. The entry is the BIP index's at the
// commit it was read at; every sentence under it is a published claim; code appears only where a
// claim cites it, and Bitcoin Core's own entry for it (doc/bips.md) shows in Core's words, quoted.
// No sentence here is written about the BIP. BIP 9 and BIP 320, which define the
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
  const signaling = bipSignaling(entry.n, bundle.signaling, bundle.chainparams);

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
          cp={bundle.chainparams}
          only={signaling.scheme ? undefined : signaling.deployments}
        />
      )}

      <CitingClaims v={v} what="this BIP">
        {v.core && (
          <Block
            id="bitcoin-core"
            title="In Bitcoin Core"
            aside={<p>Bitcoin Core&apos;s own list of the BIPs it implements, in its words.</p>}
          >
            <blockquote className="quote">{v.core.text}</blockquote>
            <p className="small muted">
              {v.core.with.length > 0 && (
                <>
                  The same entry covers{" "}
                  {v.core.with.map((n, k) => {
                    const href = bipHref(n);
                    return (
                      <span key={n}>
                        {k > 0 && (k === (v.core?.with.length ?? 0) - 1 ? " and " : ", ")}
                        {href ? <Link href={href}>BIP {n}</Link> : `BIP ${n}`}
                      </span>
                    );
                  })}
                  .{" "}
                </>
              )}
              {v.core.prs.length > 0 && (
                <>
                  {v.core.prs.length === 1 ? "Pull request" : "Pull requests"}{" "}
                  {v.core.prs.map((p, k) => (
                    <span key={p.n}>
                      {k > 0 && " "}
                      <a href={p.url} rel="noopener noreferrer" className="mono">
                        #{p.n}
                      </a>
                    </span>
                  ))}
                  .{" "}
                </>
              )}
              <a href={v.core.url} rel="noopener noreferrer">
                doc/bips.md at <span className="mono">{v.core.commit.slice(0, 10)}</span>
              </a>
              , read {dateTime(v.core.read.time)}.
            </p>
          </Block>
        )}
      </CitingClaims>

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
