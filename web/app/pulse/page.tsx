import { btc, nextHalvingHeight, nextRetargetHeight, subsidySats } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { ChangeFeed } from "@/components/ChangeFeed";
import { CopyCommand } from "@/components/CopyCommand";
import { Wire } from "@/components/Wire";
import { chainNow } from "@/lib/chain";
import { bundle } from "@/lib/data";
import { date, dateTime, height } from "@/lib/format";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Pulse",
  description:
    "What the chain is doing now, how proposals moved, what Blocklore published, and what its brain is reading upstream.",
};

const TEN_MINUTES = 600_000;

function Stat({
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
    <div className="stat-card">
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      <div className="stat-source">{source}</div>
      {command && <CopyCommand command={command} label="Check it yourself" />}
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

  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Pulse</h1>
        <p className="lede">
          What the chain is doing now, how proposals moved, what Blocklore published, and what its
          brain is reading upstream. Chain numbers are read on our server from two independent
          explorers and refreshed every minute.
        </p>
        <p className="muted" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
          Read {dateTime(c.read)}.
        </p>
      </header>

      <section aria-labelledby="chain-h">
        <div className="section-head">
          <h2 id="chain-h">The chain now</h2>
          <span className="muted">
            {c.agreement === "same" && `Both explorers report block ${height(h ?? 0)}.`}
            {c.agreement === "one block apart" &&
              "The explorers are one block apart while a block propagates; the lower height is shown."}
            {c.agreement === "disagree" &&
              "The explorers disagree, so no height is shown. Check your own node."}
            {c.agreement === "one explorer" &&
              "Only one explorer answered, so no height is shown. Check your own node."}
          </span>
        </div>
        {h === null ? (
          <p className="callout">
            mempool.space reports {c.heights.mempool ?? "nothing"} and blockstream.info reports{" "}
            {c.heights.blockstream ?? "nothing"}. Blocklore shows a height only when both agree.
          </p>
        ) : (
          <div className="stat-grid">
            <Stat
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
            <Stat
              label="Block subsidy"
              value={`${btc(subsidySats(h))} BTC`}
              sub={`${subsidySats(h).toLocaleString("en-US")} sats per block, plus fees`}
              source="Computed from the height as GetBlockSubsidy does"
              command={`bitcoin-cli getblockstats ${h} '["subsidy"]'`}
            />
            <Stat
              label="Next halving"
              value={`Block ${height(nextHalvingHeight(h))}`}
              sub={`${height(nextHalvingHeight(h) - h)} blocks away; at ten minutes a block, about ${date(new Date(built + (nextHalvingHeight(h) - h) * TEN_MINUTES).toISOString())}`}
              source="Every 210,000 blocks; the date is an estimate"
            />
            {c.difficulty && (
              <Stat
                label="Difficulty period"
                value={`${c.difficulty.progressPercent.toFixed(1)}% done`}
                sub={`${height(c.difficulty.remainingBlocks)} blocks to block ${height(nextRetargetHeight(h))}; mempool.space estimates a ${c.difficulty.estimatedChangePercent >= 0 ? "rise" : "fall"} of ${Math.abs(c.difficulty.estimatedChangePercent).toFixed(1)}%`}
                source="mempool.space's estimate"
                command="bitcoin-cli getdifficulty"
              />
            )}
            {c.fees && (
              <Stat
                label="Fee rates"
                value={`${c.fees.fastest} sat/vB`}
                sub={`for the next block; ${c.fees.halfHour} within half an hour, ${c.fees.hour} within an hour, ${c.fees.minimum} minimum`}
                source="mempool.space's estimate"
                command="bitcoin-cli estimatesmartfee 1"
              />
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="bips-h">
        <div className="section-head">
          <h2 id="bips-h">Proposals</h2>
          <Link href="/proposals">The proposal tracker</Link>
        </div>
        {bundle.bips ? (
          bipChanges.length ? (
            <ol className="feed">
              {bipChanges.map((ch) => (
                <li key={`${ch.n}-${ch.field}-${ch.commit}`}>
                  <div className="when">
                    <div>{dateTime(ch.at.time)}</div>
                    <div>block {height(ch.at.height)}</div>
                  </div>
                  <div>
                    <span className="change">{ch.field}</span>
                    <div className="what">
                      BIP {ch.n}, {ch.title}
                      {ch.before !== undefined && ch.after !== undefined
                        ? `: ${ch.before} to ${ch.after}`
                        : ch.after
                          ? `: ${ch.after}`
                          : ""}
                    </div>
                    <div className="meta">
                      <a
                        href={`https://github.com/bitcoin/bips/blob/${ch.commit}/README.mediawiki`}
                      >
                        index at {ch.commit.slice(0, 10)}
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              Watching the BIP index since commit{" "}
              <span className="mono">{bundle.bips.commit.slice(0, 10)}</span>, read at block{" "}
              {height(bundle.bips.read.height)}. No status has changed since; when one does, it
              appears here with the commit that changed it.
            </p>
          )
        ) : (
          <p className="muted">The BIP index has not been read yet.</p>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="pub-h">
          <div className="section-head">
            <h2 id="pub-h">Published lately</h2>
            <Link href="/changes">Every change</Link>
          </div>
          <ChangeFeed events={recent} />
        </section>
      )}

      {bundle.wire && (
        <section aria-labelledby="wire-h">
          <div className="section-head">
            <h2 id="wire-h">Upstream</h2>
            <span className="muted">
              What the brain&apos;s feeds saw, titled as their authors wrote them. Not reviewed by
              Blocklore.
            </span>
          </div>
          <Wire items={bundle.wire.items.slice(0, 30)} />
        </section>
      )}
    </div>
  );
}
