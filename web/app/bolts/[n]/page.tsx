import type { BoltChange } from "@blocklore/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CitingClaims } from "@/components/CitingClaims";
import { Block, FeedItem, Page, PageHeader } from "@/components/ui";
import { boltNumbers, getBolt, readBoltNumber } from "@/lib/bolts";
import { dateTime, height, plural } from "@/lib/format";

// A page per BOLT: only what Blocklore's own record holds. The title is BOLT #0's at the commit the
// brain read; every sentence under it is a published claim; code appears only where a claim cites
// it; the history is each change the brain has seen to the entry or the text, with the commits to
// compare. No sentence here is written about the BOLT.

export const dynamicParams = false;

export function generateStaticParams() {
  return boltNumbers().map((n) => ({ n: String(n) }));
}

const boltOfParams = async (params: Promise<{ n: string }>) => {
  const n = readBoltNumber((await params).n);
  return n === null ? null : getBolt(n);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const v = await boltOfParams(params);
  if (!v) return {};
  const { n, title } = v.entry;
  return {
    title: `BOLT ${n}, ${title}`,
    description: `BOLT ${n} of the Lightning specification as its own index lists it. ${
      v.claims.length
        ? `${plural(v.claims.length, "claim")} on Blocklore cite it, each with its sources and quotes.`
        : "No claim on Blocklore cites it yet."
    }`,
    alternates: { canonical: `/bolts/${n}` },
  };
}

const FIELD: Record<BoltChange["field"], string> = {
  added: "Added",
  removed: "Removed",
  title: "Title",
  text: "Text",
};

const BLOB = "https://github.com/lightning/bolts/blob";

/** One recorded change, in the index's own words, or the two commits to compare for a text change. */
function Change({ c, file }: { c: BoltChange; file: string }) {
  if (c.field === "added") return <>{c.after ? `to the index as ${c.after}` : "to the index"}</>;
  if (c.field === "removed")
    return <>{c.before ? `from the index; it was ${c.before}` : "from the index"}</>;
  if (c.field === "title") return <>{`${c.before ?? "none"} to ${c.after ?? "none"}`}</>;
  return c.before ? (
    <>
      changed between{" "}
      <a
        href={`https://github.com/lightning/bolts/compare/${c.before}...${c.commit}`}
        rel="noopener noreferrer"
      >
        <span className="mono">{c.before.slice(0, 10)}</span> and{" "}
        <span className="mono">{c.commit.slice(0, 10)}</span>
      </a>
    </>
  ) : (
    <>
      changed at{" "}
      <a href={`${BLOB}/${c.commit}/${file}`} rel="noopener noreferrer" className="mono">
        {c.commit.slice(0, 10)}
      </a>
    </>
  );
}

export default async function BoltPage({ params }: { params: Promise<{ n: string }> }) {
  const v = await boltOfParams(params);
  if (!v) notFound();
  const { entry } = v;

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/bolts", label: "BOLTs" }, { label: `BOLT ${entry.n}` }]}
        title={`BOLT ${entry.n}, ${entry.title}`}
        lede="Its title as BOLT #0, the Lightning specification's own index, lists it. Its authors are named in its text."
        meta={
          <>
            <span>
              Index at{" "}
              <a href={v.index} className="mono" rel="noopener noreferrer">
                {v.commit.slice(0, 10)}
              </a>
            </span>
            <a href={v.text} rel="noopener noreferrer">
              Its text at this commit
            </a>
            <span>
              SHA-256 of the text <span className="mono">{entry.hash.slice(0, 12)}</span>
            </span>
          </>
        }
      />

      <CitingClaims v={v} what="this BOLT" />

      <Block
        id="history"
        title="In the specification"
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
                  <span className="badge">{FIELD[c.field]}</span> <Change c={c} file={entry.file} />
                </p>
              </FeedItem>
            ))}
          </ol>
        ) : (
          <p className="empty">
            Blocklore has seen no change to this BOLT since it began reading the specification. Each
            change to its title or text appears here with the commits to compare.
          </p>
        )}
      </Block>
    </Page>
  );
}
