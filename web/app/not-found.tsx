import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <Page>
      <PageHeader
        bare
        title="No such page"
        lede={
          <>
            Nothing is published at this address. If a claim was here, it was not removed silently:{" "}
            <Link href="/changes">the change log</Link> has every revision.
          </>
        }
        meta={<span>Error 404</span>}
        actions={
          <>
            <Link className="btn btn-primary" href="/topics">
              Browse the topics
            </Link>
            <Link className="btn" href="/changes">
              Every change
            </Link>
            <Link className="btn btn-quiet" href="/">
              Home
            </Link>
          </>
        }
      />
    </Page>
  );
}
