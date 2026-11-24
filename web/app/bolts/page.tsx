import type { Metadata } from "next";
import Link from "next/link";
import { TableWrap } from "@/components/TableWrap";
import { Page, PageHeader } from "@/components/ui";
import { boltRows } from "@/lib/bolts";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";

// The Lightning specification as its own index lists it (BOLT #0 in lightning/bolts), read at the
// repository's head by the brain (brain/src/bolts.ts). Titles are the index's; every line under a
// BOLT on its own page is a published claim.

export const metadata: Metadata = {
  title: "BOLTs, the Lightning specification",
  description:
    "Every BOLT of the Lightning Network's specification as its own index lists it, with the claims on Blocklore that cite each one and every change seen to its text.",
};

export default function Bolts() {
  const idx = bundle.bolts;
  const rows = boltRows();
  return (
    <Page>
      <PageHeader
        title="BOLTs, the Lightning specification"
        lede="Every BOLT as BOLT #0, the specification's own index in the lightning/bolts repository, lists it, with the claims on Blocklore that cite its text. Each BOLT's page shows when its text changed."
        meta={
          idx && (
            <>
              <span>
                Index at{" "}
                <a
                  href={`https://github.com/lightning/bolts/blob/${idx.commit}/00-introduction.md`}
                  className="mono"
                  rel="noopener noreferrer"
                >
                  {idx.commit.slice(0, 10)}
                </a>
              </span>
              <span>
                Read {dateTime(idx.read.time)}, block{" "}
                <span className="mono">{height(idx.read.height)}</span>
              </span>
              <span>{plural(idx.changes.length, "change")} seen since the first reading</span>
            </>
          )
        }
      />
      {idx ? (
        <TableWrap label="BOLTs">
          <table className="table bip-table">
            <thead>
              <tr>
                <th scope="col" className="num">
                  BOLT
                </th>
                <th scope="col">Title</th>
                <th scope="col" className="hide-phone">
                  Changes
                </th>
                <th scope="col">Claims</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n}>
                  <td className="num">{r.n}</td>
                  <td className="title">
                    <Link href={`/bolts/${r.n}`}>{r.title}</Link>
                  </td>
                  <td className="hide-phone">
                    {r.changes > 0 ? (
                      <Link href={`/bolts/${r.n}#history`}>{r.changes}</Link>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>
                    {r.cites.length > 0 ? (
                      <Link href={`/bolts/${r.n}#claims`}>{r.cites.length}</Link>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="empty">The Lightning specification&apos;s index has not been read yet.</p>
      )}
    </Page>
  );
}
