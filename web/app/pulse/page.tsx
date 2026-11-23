import { btc, nextHalvingHeight, nextRetargetHeight, subsidySats } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { BipName } from "@/components/BipName";
import { ChangeFeed } from "@/components/ChangeFeed";
import { CopyCommand } from "@/components/CopyCommand";
import { Block, FeedItem, Page, PageHeader } from "@/components/ui";
import { Wire } from "@/components/Wire";
import { chainNow } from "@/lib/chain";
import { bundle } from "@/lib/data";
import { date, dateTime, height } from "@/lib/format";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Pulse",
  description:
    "What the chain is doing now, how proposals moved, what Blocklore published, and what its brain is reading upstream.",
  alternates: { canonical: "/pulse" },
};

const TEN_MINUTES = 600_000;

/** One chain number: what it is, where it came from, and the command that repeats it. */
function Metric({
  label,
  value,
  sub,
  source,
  command,
}: {
  label: string;
  value: string;
  sub?: string;
  source: string;
  command?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {sub && <span className="metric-sub">{sub}</span>}
      <span className="metric-source">{source}</span>
      {command && <CopyCommand command={command} />}
    </div>
  );
}

export default async function Pulse() {
  const c = await chainNow();
  const built = Date.parse(c.read);
  const h = c.tip;
  const recent = [...bundle.events].sort((a, b) => b.at.time.localeCompare(a.at.time)).slice(0, 6);
  const bipChanges = [...(bundle.bips?.changes ?? [])].reverse().slice(0, 10);
  const both = "mempool.space and blockstream.info";
  const agreement =
    c.agreement === "same"
      ? `Both explorers report block ${height(h ?? 0)}.`
      : c.agreement === "one block apart"
        ? "The explorers are one block apart while a block propagates; the lower height is shown."
        : c.agreement === "disagree"
          ? "The explorers disagree, so no height is shown. Check your own node."
          : "Only one explorer answered, so no height is shown. Check your own node.";

  return (
    <Page>
      <PageHeader
        title="Pulse"
        lede="What the chain is doing now, how proposals moved, what Blocklore published, and what its brain read upstream."
        meta={
          <>
            <span>Chain read {dateTime(c.read)}</span>
            <span>Refreshed every minute from two independent explorers</span>
          </>
        }
      />

      <Block id="chain" title="The chain now">
        <p className="small muted block-note">{agreement}</p>
        {h === null ? (
          <p className="callout callout-warn">
            mempool.space reports {c.heights.mempool ?? "nothing"} and blockstream.info reports{" "}
            {c.heights.blockstream ?? "nothing"}. Blocklore shows a height only when both agree.
          </p>
        ) : (
          <div className="metrics">
            <Metric
              label="Block height"
              value={height(h)}
              sub={
                c.tipTime
                  ? `Mined ${dateTime(new Date(c.tipTime * 1000).toISOString())}`
                  : undefined
              }
              source={`${both} agree`}
              command="bitcoin-cli getblockcount"
            />
            <Metric
              label="Block subsidy"
              value={`${btc(subsidySats(h))} BTC`}
              sub={`${subsidySats(h).toLocaleString("en-US")} sats per block, plus fees`}
              source="Computed from the height as GetBlockSubsidy does"
              command={`bitcoin-cli getblockstats ${h} '["subsidy"]'`}
            />
            <Metric
              label="Next halving"
              value={`Block ${height(nextHalvingHeight(h))}`}
              sub={`${height(nextHalvingHeight(h) - h)} blocks away; at ten minutes a block, about ${date(new Date(built + (nextHalvingHeight(h) - h) * TEN_MINUTES).toISOString())}`}
              source="Every 210,000 blocks; the date is an estimate"
            />
            {c.difficulty && (
              <Metric
                label="Difficulty period"
                value={`${c.difficulty.progressPercent.toFixed(1)}% done`}
                sub={`${height(c.difficulty.remainingBlocks)} blocks to block ${height(nextRetargetHeight(h))}; a ${c.difficulty.estimatedChangePercent >= 0 ? "rise" : "fall"} of ${Math.abs(c.difficulty.estimatedChangePercent).toFixed(1)}% expected`}
                source="mempool.space's estimate"
                command="bitcoin-cli getdifficulty"
              />
            )}
            {c.fees && (
              <Metric
                label="Fee rates"
                value={`${c.fees.fastest} sat/vB`}
                sub={`For the next block; ${c.fees.halfHour} within half an hour, ${c.fees.hour} within an hour, ${c.fees.minimum} minimum`}
                source="mempool.space's estimate"
                command="bitcoin-cli estimatesmartfee 1"
              />
            )}
          </div>
        )}
      </Block>

      <div className="grid-2 block">
        <section aria-labelledby="published-h">
          <div className="block-head">
            <h2 id="published-h">Published lately</h2>
            <Link href="/changes">Every change</Link>
          </div>
          {recent.length > 0 ? (
            <ChangeFeed events={recent} compact />
          ) : (
            <p className="empty">Nothing has been published yet.</p>
          )}
        </section>

        <section aria-labelledby="bips-h">
          <div className="block-head">
            <h2 id="bips-h">Proposals</h2>
            <Link href="/proposals">The proposal tracker</Link>
          </div>
          {bundle.bips ? (
            bipChanges.length ? (
              <ol className="feed compact">
                {bipChanges.map((ch) => (
                  <FeedItem
                    key={`${ch.n}-${ch.field}-${ch.commit}`}
                    when={dateTime(ch.at.time)}
                    block={ch.at.height}
                  >
                    <p>
                      <span className="badge">{ch.field}</span>{" "}
                      <BipName n={ch.n} title={ch.title} />
                      {ch.before !== undefined && ch.after !== undefined
                        ? `: ${ch.before} to ${ch.after}`
                        : ch.after
                          ? `: ${ch.after}`
                          : ""}
                    </p>
                    <div className="feed-meta">
                      <a
                        href={`https://github.com/bitcoin/bips/blob/${ch.commit}/README.mediawiki`}
                      >
                        Index at <span className="mono">{ch.commit.slice(0, 10)}</span>
                      </a>
                    </div>
                  </FeedItem>
                ))}
              </ol>
            ) : (
              <p className="empty">
                Watching the BIP index since commit{" "}
                <span className="mono">{bundle.bips.commit.slice(0, 10)}</span>, read at block{" "}
                {height(bundle.bips.read.height)}. No status has changed since; when one does, it
                appears here with the commit that changed it.
              </p>
            )
          ) : (
            <p className="empty">The BIP index has not been read yet.</p>
          )}
        </section>
      </div>

      {bundle.wire && (
        <Block id="upstream" title="Upstream">
          <p className="small muted block-note">
            What the brain&apos;s feeds saw, titled as their authors wrote them. Not reviewed by
            Blocklore.
          </p>
          <Wire items={bundle.wire.items.slice(0, 30)} />
        </Block>
      )}
    </Page>
  );
}
