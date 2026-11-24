import type { Metadata } from "next";
import { ThreatMap } from "@/components/admin/ThreatMap";
import { readState, readThreats } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Threat map" };
export const dynamic = "force-dynamic";

export default async function ThreatMapPage() {
  const [view, { online }] = await Promise.all([readThreats(), readState()]);
  return (
    <>
      <header className="page-header">
        <h1>Threat map</h1>
        <p className="lede">
          Which published claims explain each threat on the security map: what the threat is, and
          what defends against it. A threat missing either is a gap, and the gap map keeps asking
          research for it until a claim is linked here.
        </p>
        <p className="measure">
          Code suggests published claims whose statement names a threat by one of its terms; it
          links nothing. What you link decides what the threat&apos;s page cites. The brain edits
          the threat&apos;s file, checks it, commits it as yours and ships it.
        </p>
        <div className="meta">
          {view ? (
            <>
              <span>
                {view.counts.gaps} of {view.counts.threats} threats with a gap
              </span>
              <span>
                {view.counts.suggestions} suggestion{view.counts.suggestions === 1 ? "" : "s"}
              </span>
              <span className="mono">As of {view.head}</span>
            </>
          ) : null}
          {!online && (
            <span className="badge badge-warn">The brain is offline: changes wait for it</span>
          )}
        </div>
      </header>
      <ThreatMap view={view} />
    </>
  );
}
