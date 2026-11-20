import type { Metadata } from "next";
import Link from "next/link";
import { BipTable } from "@/components/BipTable";
import { bipRows } from "@/lib/bips";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Proposal tracker",
  description:
    "Every change to Bitcoin's consensus rules proposed as a BIP, with its status in the BIP index and the claims that cite it.",
};

const GROUPS: { title: string; blurb: string; pick: (layer: string, status: string) => boolean }[] =
  [
    {
      title: "Soft forks in progress",
      blurb: "Proposed tightenings of the rules, not yet deployed.",
      pick: (l, s) => l === "Consensus (soft fork)" && s !== "Deployed" && s !== "Closed",
    },
    {
      title: "Deployed soft forks",
      blurb: "Rules every upgraded node enforces today.",
      pick: (l, s) => l === "Consensus (soft fork)" && s === "Deployed",
    },
    {
      title: "Hard fork proposals",
      blurb: "Changes that would loosen the rules, so older nodes would reject the blocks.",
      pick: (l) => l === "Consensus (hard fork)",
    },
    {
      title: "Closed soft forks",
      blurb: "Withdrawn, replaced or abandoned.",
      pick: (l, s) => l === "Consensus (soft fork)" && s === "Closed",
    },
  ];

export default function Proposals() {
  const idx = bundle.bips;
  if (!idx)
    return (
      <div className="wrap">
        <header className="page-head">
          <h1>Proposal tracker</h1>
        </header>
        <p className="callout">The BIP index has not been read yet.</p>
      </div>
    );
  const rows = bipRows();
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Proposal tracker</h1>
        <p className="lede">
          Every change to Bitcoin&apos;s consensus rules proposed as a BIP, with its status as the
          BIP index gives it and the claims on Blocklore that cite it. Statuses are the index&apos;s
          own, read from <code>bitcoin/bips</code>, not Blocklore&apos;s judgment.
        </p>
        <p className="muted" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
          Index at commit{" "}
          <a
            href={`https://github.com/bitcoin/bips/blob/${idx.commit}/README.mediawiki`}
            className="mono"
          >
            {idx.commit.slice(0, 10)}
          </a>
          , read {dateTime(idx.read.time)} at block {height(idx.read.height)}.{" "}
          {plural(idx.changes.length, "change")} seen since the first reading.{" "}
          <Link href="/bips">The whole index</Link>.
        </p>
      </header>
      {GROUPS.map((g) => {
        const picked = rows.filter((r) => g.pick(r.layer ?? "", r.status));
        if (!picked.length) return null;
        return (
          <section key={g.title} aria-label={g.title}>
            <div className="section-head">
              <h2>{g.title}</h2>
              <span className="muted">
                {g.blurb} {plural(picked.length, "BIP")}.
              </span>
            </div>
            <BipTable rows={picked} commit={idx.commit} />
          </section>
        );
      })}
    </div>
  );
}
