import { DISCLOSURE, labReleaseList } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Advisories,
  LabReleases,
  StatusLegend,
  StatusStrip,
  THREAT_LABEL,
  ThreatRow,
  WatchItem,
} from "@/components/security/parts";
import s from "@/components/security/Security.module.css";
import { Block, Page, PageHeader } from "@/components/ui";
import { dateTime, plural } from "@/lib/format";
import { allThreats, getThreat, security } from "@/lib/security";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Every known way Bitcoin can be attacked, what defends against each, and what Blocklore watches and tests for each, from public data and a local lab.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  const threats = allThreats();
  const counts = { defended: 0, watching: 0, open: 0 };
  for (const t of threats) counts[t.live]++;
  const researching = threats.filter((t) => t.missing.length > 0).length;
  const known = security.advisories;
  const items = known.advisories.slice(0, 8).map((a) => ({
    ...a,
    threats: a.matches.flatMap((m) => {
      const t = getThreat(m.threat);
      return t ? [{ id: t.id, title: t.title }] : [];
    }),
  }));
  const lab = security.labReleases;
  return (
    <Page>
      <PageHeader
        title="Security"
        lede="Every known way Bitcoin can be attacked, what defends against each, and what Blocklore watches and tests. From public data and a lab on its own machine; nothing undisclosed is ever shown."
        meta={
          <>
            <span>{plural(threats.length, "threat")}</span>
            <span>{plural(security.layers.length, "layer")}</span>
            <span>{researching} being researched</span>
            {security.updated && <span>Watches read {dateTime(security.updated)}</span>}
            {lab.length > 0 && <span>Lab: {labReleaseList(lab)}</span>}
          </>
        }
      />

      <section className="block" aria-labelledby="map-h">
        <div className="block-head">
          <h2 id="map-h">The threat map</h2>
        </div>
        <StatusStrip layers={security.layers} />
        <StatusLegend counts={counts} />
      </section>

      <div className={`${s.layers} block`}>
        {security.layers.map((l) => (
          <section key={l.id} id={l.id} aria-labelledby={`${l.id}-h`}>
            <div className={s.layerHead}>
              <h3 id={`${l.id}-h`}>{l.label}</h3>
              <span className={s.layerCounts}>
                {(["defended", "watching", "open"] as const)
                  .filter((k) => l.counts[k] > 0)
                  .map((k) => (
                    <span key={k}>
                      <span className={s.mark} data-s={k} aria-hidden="true" />
                      {l.counts[k]} {THREAT_LABEL[k].toLowerCase()}
                    </span>
                  ))}
              </span>
            </div>
            <ul className={s.threats}>
              {l.threats.map((t) => (
                <ThreatRow key={t.id} t={t} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Block
        id="watches"
        title="Watches"
        aside={<span className="small muted">Open one to see how it is judged</span>}
      >
        {security.watches.length ? (
          <ul className={s.watches}>
            {security.watches.map((w) => (
              <WatchItem key={w.id} w={w} />
            ))}
          </ul>
        ) : (
          <p className="empty">
            The watches have not read yet. They read the chain and public security feeds every hour.
          </p>
        )}
      </Block>

      <Block
        id="lab"
        title="The lab"
        aside={
          lab.length > 0 && (
            <span className="small muted">
              {plural(lab.length, "release")}, each project&apos;s newest first
            </span>
          )
        }
      >
        <p className="small muted" style={{ marginBottom: "var(--s3)" }}>
          Bitcoin Core&apos;s own tests of past attacks, run on a private test network against the
          newest release of each major version Bitcoin Core still maintains, after each download is
          checked, and the test programs of libsecp256k1, the library that checks every signature,
          built from the copy each release ships. Then LND&apos;s own unit tests of the code that
          punishes an old state, forwards payments and sweeps funds, built from the source of its
          newest release once the release&apos;s signed manifest checks out. Then LDK&apos;s own
          tests of the same defenses, built from its newest release once the release tag&apos;s
          signature checks out against a maintainer key its security policy lists. Then
          Eclair&apos;s own tests of its channels, penalties, transaction publishing, routing and
          onions, built from the commit its newest release names once the release&apos;s signed
          checksums check out against the ACINQ key its release notes name. Then Core
          Lightning&apos;s own unit tests of its channels, payments, onions, gossip and the keys
          that punish an old state, built from the source of its newest release once the
          maintainers&apos; signatures over its checksums check out, with every tool its build needs
          built from its own checked release.
        </p>
        <LabReleases runs={lab} />
      </Block>

      <Block
        id="advisories"
        title="Latest advisories"
        aside={
          known.counts.advisories > 0 && (
            <span className="small muted">
              {known.counts.advisories} read, {known.counts.matched} filed under a threat
              {known.counts.unmatched > 0 && (
                <>
                  , <Link href="/gaps#advisories">{known.counts.unmatched} to map</Link>
                </>
              )}
            </span>
          )
        }
      >
        {items.length ? (
          <Advisories items={items} />
        ) : (
          <p className="empty">No advisory has been read yet.</p>
        )}
      </Block>

      <aside className="rail block" aria-label="Report a vulnerability">
        <section className="rail-block">
          <h3>Found a vulnerability?</h3>
          <p>
            Report it privately to the project, never in public. Each publishes how to reach its
            security team:
          </p>
          <ul className={s.contacts}>
            {DISCLOSURE.map((d) => (
              <li key={d.project}>
                <strong>{d.project}</strong>
                <span>
                  <a href={`mailto:${d.email}`}>{d.email}</a>,{" "}
                  <a href={d.policy} rel="noopener noreferrer">
                    policy
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </Page>
  );
}
