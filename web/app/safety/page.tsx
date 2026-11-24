import { deskView } from "@blocklore/core/desk";
import type { Metadata } from "next";
import Link from "next/link";
import { ClaimLine } from "@/components/ClaimLine";
import s from "@/components/security/Security.module.css";
import { Page, PageHeader } from "@/components/ui";
import { plural } from "@/lib/format";
import { claimsOf, security } from "@/lib/security";

// The Safety Desk (EDITORIAL.md, "Safety Desk"; core/src/desk.ts): the threats to a person who
// holds bitcoin, by threat model, and the scam patterns. Every sentence under a threat is a
// published claim the threat map links to it; a threat with none says it is being researched.

export const metadata: Metadata = {
  title: "Safety Desk",
  description:
    "Threats to people who hold bitcoin, by threat model: what you hold, who can learn that you hold it, where you live and travel, and how the common scams work. Every sentence is a published claim with its sources.",
  alternates: { canonical: "/safety" },
};

const MISSING: Record<string, string> = {
  "claims,mitigations": "being researched: what it is and what defends against it",
  claims: "being researched: what it is",
  mitigations: "being researched: what defends against it",
};

export default function SafetyPage() {
  const desk = deskView(security);
  let n = 0;
  const lines = (ids: string[]) =>
    claimsOf(ids).map((c) => {
      n += 1;
      return <ClaimLine key={c.id} claim={c} n={n} />;
    });
  return (
    <Page>
      <PageHeader
        title="Safety Desk"
        lede="The threats to a person who holds bitcoin, by threat model rather than one checklist for everyone: what you hold, who can learn that you hold it, where you live and travel, and how the common scams work. Every sentence under a threat is a published claim with its sources."
        meta={
          <>
            <span>{plural(desk.counts.threats, "threat")}</span>
            <span>
              {desk.counts.explained} of {desk.counts.threats} explained
            </span>
            <span>{plural(desk.counts.claims, "published claim")}</span>
          </>
        }
      />

      <section className="callout callout-info block" aria-label="What Blocklore never asks for">
        <p>
          Blocklore never asks for a seed phrase, a key, an xpub or an address, and refuses any it
          is sent. The <Link href="/verify/evaluator">evaluator</Link> publishes a claim on a safety
          topic only when two independent publishers support it and it describes a threat or a cost
          rather than telling anyone what to do.
        </p>
      </section>

      <div className={`${s.layers} block`}>
        {desk.models.map((m) => (
          <section key={m.id} id={m.id} aria-labelledby={`${m.id}-h`}>
            <div className={s.layerHead}>
              <h2 id={`${m.id}-h`} className={s.deskModel}>
                {m.title}
              </h2>
              <span className={s.layerCounts}>{m.question}</span>
            </div>
            <ul className={s.threats}>
              {m.threats.map((t) => {
                const explains = lines(t.published.claims);
                const defends = lines(t.published.mitigations);
                return (
                  <li key={t.id} className={s.deskThreat}>
                    <h3 className={s.deskTitle}>
                      <Link href={`/security/${t.id}`} className={s.threatTitle}>
                        {t.title}
                      </Link>
                    </h3>
                    {t.missing.length > 0 && (
                      <p className={`${s.threatMeta} ${s.researching}`}>
                        {MISSING[t.missing.join(",")]}
                      </p>
                    )}
                    {explains.length > 0 && (
                      <div className={s.deskPart}>
                        <h4>What it is</h4>
                        <div className="claims">{explains}</div>
                      </div>
                    )}
                    {defends.length > 0 && (
                      <div className={s.deskPart}>
                        <h4>What defends against it</h4>
                        <div className="claims">{defends}</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="small muted block">
        A threat being researched is on the brain&apos;s <Link href="/gaps">research list</Link>; a
        claim appears here only once its sources check out. The full map of threats to Bitcoin
        itself, with live watches and a test lab, is on <Link href="/security">Security</Link>.
      </p>
    </Page>
  );
}
