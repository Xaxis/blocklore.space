import { monthProgress, progressMonths, REACH_LABELS, type ReachDay } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Block, Page, PageHeader, Stat } from "@/components/ui";
import { digests, getTopic, progressInput } from "@/lib/data";
import { dateLong, height, monthLong, plural } from "@/lib/format";
import { readReach } from "@/lib/reach";
import { SITE } from "@/lib/site";

// One month of Blocklore's work, from its own public record (core/src/progress.ts), and how much
// programs and assistants used it (core/src/reach.ts). Rebuilt hourly for the reach counts.

export const dynamicParams = false;
export const revalidate = 3600;

/** The first day reach was counted; earlier days have no counts, not zero use. */
const REACH_SINCE = "2026-11-23";
const REPO = "https://github.com/Xaxis/blocklore.space";

export function generateStaticParams() {
  return progressMonths(progressInput()).map((month) => ({ month }));
}

export async function generateMetadata({
  params,
}: PageProps<"/progress/[month]">): Promise<Metadata> {
  const { month } = await params;
  return {
    title: `Progress in ${monthLong(month)}`,
    description: `What Blocklore did in ${monthLong(month)}, counted from its own public record.`,
    alternates: { canonical: `/progress/${month}` },
  };
}

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** The noun alone, agreeing with n: the number is shown on its own above it. */
const noun = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** An API counter's route as a reader would call it. */
const apiPath = (k: string) =>
  k === "index"
    ? "/api/v1"
    : k === "claim"
      ? "/api/v1/claims/{id}"
      : k === "topic"
        ? "/api/v1/topics/{slug}"
        : `/api/v1/${k}`;

function ReachList({
  total,
  prefix,
  label,
  name = (k) => k,
}: {
  total: ReachDay;
  prefix: string;
  label: string;
  name?: (k: string) => string;
}) {
  const rows = Object.entries(total)
    .filter(([k]) => k.startsWith(prefix))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!rows.length) return null;
  return (
    <div className="stack-sm">
      <h3>{label}</h3>
      <ul className="lines small">
        {rows.map(([k, n]) => (
          <li key={k}>
            <span>
              <span className="mono">{name(k.slice(prefix.length))}</span>:{" "}
              {n.toLocaleString("en-US")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function Progress({ params }: PageProps<"/progress/[month]">) {
  const { month } = await params;
  const months = progressMonths(progressInput());
  if (!months.includes(month)) notFound();
  const m = monthProgress(progressInput(), month);
  const i = months.indexOf(month);
  const newer = months[i - 1];
  const older = months[i + 1];
  const days = digests().filter((d) => d.date.startsWith(month));

  const today = new Date().toISOString().slice(0, 10);
  // ISO dates sort as strings: the later start and the earlier end.
  const from = [`${month}-01`, REACH_SINCE].sort()[1] ?? REACH_SINCE;
  const to = [lastDay(month), today].sort()[0] ?? today;
  const reach = from <= to ? await readReach(from, to) : null;
  const total = reach?.total ?? {};
  const mainReach = Object.keys(REACH_LABELS).filter((k) => (total[k] ?? 0) > 0);

  const ev = m.evaluator;
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/progress", label: "Progress" }, { label: monthLong(month) }]}
        title={monthLong(month)}
        lede="What Blocklore did this month, counted from its own public record. Every number links to the things it counts, so the month can be checked rather than trusted."
        meta={
          m.heights && (
            <span className="mono">
              blocks {height(m.heights.from)} to {height(m.heights.to)}
            </span>
          )
        }
      />

      <div className="measure">
        <div className="stats block">
          <Stat
            value={m.claims.created}
            label={noun(m.claims.created, "new claim")}
            note="each with its sources"
          />
          <Stat value={m.claims.corrected} label={noun(m.claims.corrected, "correction")} />
          <Stat
            value={m.runs.length}
            label={noun(m.runs.length, "research or check run", "research and check runs")}
            note={`${plural(m.read, "page")} read`}
          />
          <Stat
            value={m.editions.length}
            label={noun(
              m.editions.length,
              "edition sealed in Bitcoin",
              "editions sealed in Bitcoin",
            )}
          />
        </div>

        <Block id="store" title="The store">
          <div className="stack">
            <p>
              {plural(m.claims.created, "new claim")}, {plural(m.claims.corrected, "correction")},{" "}
              {plural(m.claims.revised, "other revision")}
              {m.claims.withdrawn > 0 && <> and {plural(m.claims.withdrawn, "withdrawal")}</>}.{" "}
              {days.length > 0 && (
                <>
                  Day by day in {plural(days.length, "digest")}:{" "}
                  {days
                    .slice()
                    .reverse()
                    .map((d, k) => (
                      <span key={d.date}>
                        {k > 0 && ", "}
                        <Link href={`/digest/${d.date}`}>{dateLong(d.date)}</Link>
                      </span>
                    ))}
                  .
                </>
              )}
            </p>
            {m.topics.length > 0 && (
              <ul className="lines">
                {m.topics.map((t) => (
                  <li key={t.slug}>
                    <Link href={`/topics/${t.slug}`}>{getTopic(t.slug)?.title ?? t.slug}</Link>
                    <span className="small muted">
                      {plural(t.created, "new claim")}
                      {t.changed > 0 && <>, {plural(t.changed, "change")}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {m.corrections.length > 0 && (
              <div className="stack-sm">
                <h3>Corrections</h3>
                <ul className="lines">
                  {m.corrections.map((e) => (
                    <li key={`${e.claim}-${e.rev}`}>
                      <Link href={`/claims/${e.claim}`}>{e.statement}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Block>

        {m.runs.length > 0 && (
          <Block
            id="research"
            title="Research and checks"
            aside={<p>Each run&apos;s log lists every page it read and every claim it rejected.</p>}
          >
            <ul className="lines">
              {m.runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/log/${r.id}`} className="mono">
                    {r.id}
                  </Link>
                  <span className="small muted">
                    {[
                      r.published && `${r.published} published`,
                      r.revised && `${r.revised} revised`,
                      r.held && `${r.held} held for closer checks`,
                      r.rejected && `${r.rejected} rejected`,
                      `${plural(r.read, "page")} read`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {ev && (
          <Block id="evaluator" title="The evaluator">
            <p>
              Of the claims that needed closer checks, it published {ev.published}, held {ev.held}{" "}
              for later and kept {ev.rejected} out. It caught{" "}
              <strong>
                {ev.caught} of {ev.canaries}
              </strong>{" "}
              test claims made false on purpose. <Link href="/verify/evaluator">Its record</Link>.
            </p>
          </Block>
        )}

        {m.editions.length > 0 && (
          <Block id="editions" title="Sealed editions">
            <ul className="lines">
              {m.editions.map((s) => (
                <li key={s.n}>
                  <Link href={`/verify#snapshot-${s.n}`}>Edition {s.n}</Link>
                  <span className="small muted">
                    {plural(s.count, "claim")}, taken at block {height(s.at.height)},{" "}
                    {s.block ? <>sealed in block {height(s.block)}</> : "waiting for its block"}
                    {s.signed ? ", signed" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {(m.lab.length > 0 || m.bips > 0) && (
          <Block id="security" title="Security and the BIPs">
            <ul className="lines">
              {m.lab.map((l) => (
                <li key={l.at}>
                  <Link href="/security#lab">Bitcoin Core {l.version}</Link>
                  <span className="small muted">
                    {l.sha256 ? "Its release checked against its signed checksums, and " : ""}
                    {l.passed} of {l.tests} of its own attack tests passed in the lab on{" "}
                    {dateLong(l.at)}
                  </span>
                </li>
              ))}
              {m.bips > 0 && (
                <li>
                  <Link href="/bips">{plural(m.bips, "change")} to the BIP index</Link>
                  <span className="small muted">each recorded at its commit</span>
                </li>
              )}
            </ul>
          </Block>
        )}

        <Block id="reach" title="Use by programs and assistants">
          <div className="stack">
            {reach === null && from <= to ? (
              <p className="muted">The counts cannot be read right now.</p>
            ) : mainReach.length === 0 ? (
              <p className="muted">
                {from > to
                  ? `Counting began on ${dateLong(REACH_SINCE)}.`
                  : "Nothing counted yet this month."}
              </p>
            ) : (
              <>
                <ul className="lines">
                  {mainReach.map((k) => (
                    <li key={k}>
                      <span>
                        {REACH_LABELS[k]}:{" "}
                        <strong>{(total[k] ?? 0).toLocaleString("en-US")}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
                <ReachList total={total} prefix="mcp:tool:" label="MCP calls by tool" />
                <ReachList
                  total={total}
                  prefix="api:"
                  label="API requests by route"
                  name={apiPath}
                />
              </>
            )}
            <p className="small muted">
              Counted from {dateLong(from)} as numbers per day: no address, no query, nothing that
              tells one reader from another. Requests the site&apos;s own pages make are left out;
              crawlers are not.
              {(total["site:api:search"] ?? 0) > 0 &&
                ` Readers searched ${plural(total["site:api:search"] ?? 0, "time")} on the site itself.`}
            </p>
          </div>
        </Block>

        <Block id="check" title="Check it yourself">
          <div className="stack">
            <p>The month&apos;s changes to the store, in its public history:</p>
            <pre className="code">
              <code>{`git clone ${REPO}
git log --since=${month}-01 --until=${lastDay(month)}T23:59:59Z --oneline -- knowledge/
pnpm install && pnpm verify:snapshot`}</code>
            </pre>
            <p className="small muted">
              The store is at {SITE.url}/exports/claims.jsonl; each claim&apos;s page lists its
              revisions with what it said before.
            </p>
          </div>
        </Block>

        <nav className="pager" aria-label="Other months">
          {older ? (
            <Link href={`/progress/${older}`}>
              <span className="small muted">Earlier</span>
              {monthLong(older)}
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link href={`/progress/${newer}`} className="pager-next">
              <span className="small muted">Later</span>
              {monthLong(newer)}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </Page>
  );
}
