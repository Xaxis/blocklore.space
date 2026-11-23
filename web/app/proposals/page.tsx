import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { BipTable } from "@/components/BipTable";
import { Block, Page, PageHeader } from "@/components/ui";
import { VersionBits } from "@/components/VersionBits";
import { bipRows } from "@/lib/bips";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Proposals",
  description:
    "Every change to Bitcoin's consensus rules proposed as a BIP, with its status in the BIP index, the claims that cite it, and the version bits blocks set this difficulty period.",
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
      <Page>
        <PageHeader title="Proposals" />
        <p className="empty">The BIP index has not been read yet.</p>
      </Page>
    );
  const rows = bipRows();
  return (
    <Page>
      <PageHeader
        title="Proposals"
        lede="Every change to Bitcoin's consensus rules proposed as a BIP, with its status as the BIP index gives it and the claims that cite it. Statuses are the index's own, not Blocklore's judgment."
        meta={
          <>
            <span>
              Index at{" "}
              <a
                href={`https://github.com/bitcoin/bips/blob/${idx.commit}/README.mediawiki`}
                className="mono"
              >
                {idx.commit.slice(0, 10)}
              </a>
            </span>
            <span>
              Read {dateTime(idx.read.time)}, block{" "}
              <span className="mono">{height(idx.read.height)}</span>
            </span>
            <span>{plural(idx.changes.length, "change")} seen since the first reading</span>
            <Link href="/bips">The whole index</Link>
          </>
        }
      />
      {GROUPS.map((g, i) => {
        const picked = rows.filter((r) => g.pick(r.layer ?? "", r.status));
        return (
          <Fragment key={g.title}>
            {picked.length > 0 && (
              <Block
                id={g.title.toLowerCase().replaceAll(" ", "-")}
                title={g.title}
                aside={
                  <p>
                    {g.blurb} {plural(picked.length, "BIP")}.
                  </p>
                }
              >
                <BipTable rows={picked} label={`BIPs: ${g.title}`} />
              </Block>
            )}
            {i === 0 &&
              (bundle.signaling ? (
                <VersionBits s={bundle.signaling} />
              ) : (
                <Block id="version-bits" title="Version bits this period">
                  <p className="empty">The brain has not counted a period's version bits yet.</p>
                </Block>
              ))}
          </Fragment>
        );
      })}
    </Page>
  );
}
