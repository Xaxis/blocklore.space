import { asOfHelp } from "@blocklore/core";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";
import { LATEST } from "@/lib/asof";

/** A time machine address with no such topic or claim, or with something that is not a moment. */
export function AsOfMissing({ kind }: { kind: "topic" | "claim" }) {
  const example = kind === "topic" ? "/topics/taproot/at/976771" : "/claims/<id>/at/2026-11-21";
  return (
    <Page>
      <PageHeader
        bare
        title={`No such ${kind} or moment`}
        lede={
          <>
            Nothing can be shown at this address. {asOfHelp(LATEST)} For example{" "}
            <span className="mono">{example}</span>.
          </>
        }
        meta={<span>Error 404</span>}
        actions={
          <>
            <Link className="btn btn-primary" href="/topics">
              Browse the topics
            </Link>
            <Link className="btn" href="/verify">
              Sealed editions
            </Link>
          </>
        }
      />
    </Page>
  );
}
