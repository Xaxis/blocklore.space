import type { Metadata } from "next";
import { Embargo } from "@/components/admin/Embargo";
import { readEmbargo, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Security embargo" };
export const dynamic = "force-dynamic";

export default async function SecurityAdminPage() {
  const [items, { state, online }] = await Promise.all([readEmbargo(), readState()]);
  return (
    <>
      <header className="page-header">
        <h1>Security embargo</h1>
        <p className="lede">
          Findings the disclosure gate held because they may describe a weakness that is not public
          yet: a lab test that failed on a release, or a research claim about something no advisory
          covers. None of it reaches the site, the feed, the review queue or a run log. Report each
          one privately to the project first, and release it only after the project has published an
          advisory or a fix.
        </p>
        <div className="meta">
          <span>{items.length} held</span>
          {state && <span>As of {new Date(state.at).toUTCString().slice(5, 22)} UTC</span>}
          {!online && (
            <span className="badge badge-warn">The brain is offline: decisions wait for it</span>
          )}
        </div>
      </header>
      <Embargo items={items} />
    </>
  );
}
