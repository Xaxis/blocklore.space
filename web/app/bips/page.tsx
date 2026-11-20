import type { Metadata } from "next";
import Link from "next/link";
import { BipTable } from "@/components/BipTable";
import { bipRows } from "@/lib/bips";
import { bundle } from "@/lib/data";
import { dateTime, height } from "@/lib/format";

export const metadata: Metadata = {
  title: "The BIP index",
  description:
    "Every Bitcoin Improvement Proposal with its layer and status, as the bitcoin/bips index gives them, and the claims that cite each one.",
};

export default function Bips() {
  const idx = bundle.bips;
  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs">
          <Link href="/proposals">Proposal tracker</Link> / The BIP index
        </div>
        <h1>The BIP index</h1>
        <p className="lede">
          Every BIP as the index in the bitcoin/bips repository lists it, with the claims on
          Blocklore that cite its text.
        </p>
        {idx && (
          <p className="muted" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
            Commit{" "}
            <a
              href={`https://github.com/bitcoin/bips/blob/${idx.commit}/README.mediawiki`}
              className="mono"
            >
              {idx.commit.slice(0, 10)}
            </a>
            , read {dateTime(idx.read.time)} at block {height(idx.read.height)}. Owners are listed
            in each BIP&apos;s own file.
          </p>
        )}
      </header>
      {idx ? (
        <BipTable rows={bipRows()} commit={idx.commit} filter />
      ) : (
        <p className="callout">The BIP index has not been read yet.</p>
      )}
    </div>
  );
}
