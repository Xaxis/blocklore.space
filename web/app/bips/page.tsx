import type { Metadata } from "next";
import { BipTable } from "@/components/BipTable";
import { Page, PageHeader } from "@/components/ui";
import { bipRows } from "@/lib/bips";
import { bundle } from "@/lib/data";
import { dateTime, height } from "@/lib/format";

export const metadata: Metadata = {
  title: "BIP index",
  description:
    "Every Bitcoin Improvement Proposal with its layer and status, as the bitcoin/bips index gives them, and the claims that cite each one.",
};

export default function Bips() {
  const idx = bundle.bips;
  return (
    <Page>
      <PageHeader
        title="BIP index"
        lede="Every BIP as the index in the bitcoin/bips repository lists it, with the claims on Blocklore that cite its text."
        meta={
          idx && (
            <>
              <span>
                Commit{" "}
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
              <span>Owners are listed in each BIP&apos;s own file</span>
            </>
          )
        }
      />
      {idx ? (
        <BipTable rows={bipRows()} filter />
      ) : (
        <p className="empty">The BIP index has not been read yet.</p>
      )}
    </Page>
  );
}
