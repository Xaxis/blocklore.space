import type { Metadata } from "next";
import { AdvisoryMap } from "@/components/admin/AdvisoryMap";
import { readAdvisories, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Advisories and NVD" };
export const dynamic = "force-dynamic";

export default async function AdvisoriesAdminPage() {
  const [view, { online }] = await Promise.all([readAdvisories(), readState()]);
  return (
    <>
      <header className="page-header">
        <h1>Advisories and NVD</h1>
        <p className="lede">
          Which threats each security advisory concerns, and what NVD says about the CVE ids the
          threat map names. What you decide here goes into knowledge/security/advisory-map.yaml: the
          brain checks it, commits it as yours and ships it, and the public threat pages and /gaps
          show it from the next deploy.
        </p>
        <div className="meta">
          {view ? (
            <>
              <span>
                {view.counts.unmatched} of {view.counts.advisories} advisories to map
              </span>
              <span>
                {view.counts.findings} NVD finding{view.counts.findings === 1 ? "" : "s"} of{" "}
                {view.counts.cves} CVE ids
              </span>
              <span className="mono">As of {view.head}</span>
            </>
          ) : null}
          {!online && (
            <span className="badge badge-warn">The brain is offline: changes wait for it</span>
          )}
        </div>
      </header>
      <AdvisoryMap view={view} />
    </>
  );
}
