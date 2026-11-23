import type {
  AdvisoryRecord,
  CveCheck,
  FindingKind,
  LabRun,
  MatchRule,
  NvdBrief,
  ThreatStatus,
  ThreatView,
  WatchLevel,
  WatchState,
} from "@blocklore/core";
import { andList, SECP256K1_PREFIX, type WatchSpec, watchSpec } from "@blocklore/core";
import { labCounts } from "@blocklore/core/threatmap";
import Link from "next/link";
import type { ReactNode } from "react";
import { TableWrap } from "@/components/TableWrap";
import { date, dateTime, height, plural } from "@/lib/format";
import s from "./Security.module.css";

// The Security mode's pieces: status chips, a threat row, a watch reading with its sparkline, the
// lab's run on each maintained release and a threat's tests by release, the advisories list with
// why each is filed where it is, and the NVD check. The pages compose them; every sentence about
// a threat itself is a claim, rendered by ClaimLine on the threat's page.

export const THREAT_LABEL: Record<ThreatStatus, string> = {
  defended: "Defended",
  watching: "Watching",
  open: "Open",
};

export const THREAT_HINT: Record<ThreatStatus, string> = {
  defended: "Known, and fixed or defended in the software people run",
  watching: "Defended in part, or depends on conditions Blocklore keeps measuring",
  open: "No deployed defense yet, or the defense is not holding",
};

const THREAT_TONE: Record<ThreatStatus, string> = {
  defended: "badge-ok",
  watching: "badge-warn",
  open: "badge-bad",
};

const LEVEL_LABEL: Record<WatchLevel, string> = {
  ok: "Normal",
  elevated: "Elevated",
  alert: "Alert",
  unknown: "No data",
};

const LEVEL_TONE: Record<WatchLevel, string> = {
  ok: "badge-ok",
  elevated: "badge-warn",
  alert: "badge-bad",
  unknown: "badge-outline",
};

export function ThreatChip({ status }: { status: ThreatStatus }) {
  return (
    <span className={`badge ${THREAT_TONE[status]} ${s.chip}`} title={THREAT_HINT[status]}>
      <span className={s.mark} data-s={status} aria-hidden="true" />
      {THREAT_LABEL[status]}
    </span>
  );
}

export function LevelChip({ level }: { level: WatchLevel }) {
  return (
    <span className={`badge ${LEVEL_TONE[level]} ${s.chip}`}>
      <span className={s.mark} data-l={level} aria-hidden="true" />
      {LEVEL_LABEL[level]}
    </span>
  );
}

/** The three statuses with what each means, in one line each. */
export function StatusLegend({ counts }: { counts?: Record<ThreatStatus, number> }) {
  return (
    <dl className={s.legend}>
      {(["defended", "watching", "open"] as const).map((k) => (
        <div key={k}>
          <dt>
            <ThreatChip status={k} />
            {counts && <span className={s.legendCount}>{counts[k]}</span>}
          </dt>
          <dd>{THREAT_HINT[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every threat as one segment, a group per layer in map order, colored and patterned by status. */
export function StatusStrip({
  layers,
}: {
  layers: { id: string; label: string; threats: ThreatView[] }[];
}) {
  const threats = layers.flatMap((l) => l.threats);
  const counts = (ts: ThreatView[]) =>
    (["defended", "watching", "open"] as const)
      .map((k) => `${ts.filter((t) => t.live === k).length} ${THREAT_LABEL[k].toLowerCase()}`)
      .join(", ");
  // Links to each layer, each named with its counts: an image cannot hold links.
  return (
    <nav className={s.strip} aria-label={`${threats.length} threats: ${counts(threats)}`}>
      {layers.map((l) => (
        <a
          key={l.id}
          href={`#${l.id}`}
          title={l.label}
          aria-label={`${l.label}: ${counts(l.threats)}`}
          style={{ flexGrow: l.threats.length }}
        >
          {l.threats.map((t) => (
            <i key={t.id} data-s={t.live} />
          ))}
        </a>
      ))}
    </nav>
  );
}

/** One threat in a layer's list: its status, its title, and what explains, watches and tests it. */
export function ThreatRow({ t }: { t: ThreatView }) {
  const claims = t.published.claims.length + t.published.mitigations.length;
  const lab = labCounts(t);
  return (
    <li className={s.threat}>
      <ThreatChip status={t.live} />
      <div className={s.threatBody}>
        <Link href={`/security/${t.id}`} className={s.threatTitle}>
          {t.title}
        </Link>
        <span className={s.threatMeta}>
          {claims > 0 && <span>{plural(claims, "claim")}</span>}
          {t.missing.length > 0 && <span className={s.researching}>being researched</span>}
          {t.watches.length > 0 && <span>{plural(t.watches.length, "watch", "watches")}</span>}
          {t.lab.length > 0 && (
            <span>
              {lab.run === 0
                ? `${plural(t.lab.length, "lab test")}, not run yet`
                : `lab ${lab.passed} of ${t.lab.length} passing on ${plural(lab.releases.length, "release")}`}
            </span>
          )}
          {t.raisedBy.length > 0 && <span className={s.raised}>raised by a watch</span>}
        </span>
      </div>
    </li>
  );
}

/** A small line of a watch's recent values, newest at the right; gaps where it had no reading. */
export function Sparkline({ w, wide = false }: { w: WatchState; wide?: boolean }) {
  const W = wide ? 160 : 76;
  const H = wide ? 32 : 22;
  const pts = w.history;
  const values = pts.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length < 2)
    return wide ? null : (
      <svg className={s.spark} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <line x1="2" x2={W - 2} y1={H / 2} y2={H / 2} className={s.sparkEmpty} />
      </svg>
    );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 2 + (i * (W - 6)) / Math.max(pts.length - 1, 1);
  const y = (v: number) => (max === min ? H / 2 : H - 3 - ((v - min) * (H - 6)) / (max - min));
  const runs: string[] = [];
  let cur: string[] = [];
  pts.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length) runs.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (cur.length) runs.push(cur.join(" "));
  const lastIndex = pts.findLastIndex((p) => p.value !== null);
  const last = pts[lastIndex];
  return (
    <svg
      className={s.spark}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Last ${values.length} readings, from ${values[0]} to ${values.at(-1)}`}
    >
      {runs.map((r) => (
        <polyline key={r} points={r} className={s.sparkLine} />
      ))}
      {last && last.value !== null && (
        <circle
          cx={x(lastIndex)}
          cy={y(last.value)}
          r="2.4"
          className={s.sparkDot}
          data-l={last.status}
        />
      )}
    </svg>
  );
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** The headline number in the watch's unit. */
export function watchValue(w: WatchState, spec: WatchSpec = watchSpec(w.id)): string {
  if (w.value === null) return "No reading";
  switch (spec.unit) {
    case "%":
      return w.id === "difficulty" ? `${sign(w.value)}%` : `${w.value}%`;
    case "minutes":
      return `${w.value} min`;
    case "blocks":
      return plural(w.value, "block");
    case "advisories":
      return plural(w.value, "advisory", "advisories");
  }
}

/** One short line of context from the watch's data. */
export function watchContext(w: WatchState): string | null {
  switch (w.id) {
    case "hashrate": {
      const top = w.data?.pools[0];
      return top && w.data ? `${top.name}, of ${height(w.data.blocks)} blocks this week` : null;
    }
    case "block-gaps":
      return w.data
        ? `At block ${height(w.data.longest.height)}; typical gap ${w.data.median} min`
        : null;
    case "timestamps":
      if (!w.data) return null;
      return w.data.backward.length
        ? `${plural(w.data.backward.length, "step")} back, deepest at block ${height(w.data.backward[0]?.height ?? 0)}`
        : `No step back in blocks ${height(w.data.from)} to ${height(w.data.to)}`;
    case "difficulty":
      if (!w.data) return null;
      return w.data.projected === null
        ? `Last adjustment at block ${height(w.data.period)}`
        : `Next on course for ${sign(w.data.projected)}%`;
    case "reorgs":
      if (!w.data) return null;
      return w.data.events.length
        ? `Last at block ${height(w.data.events[0]?.height ?? 0)}, ${date(w.data.events[0]?.at ?? w.at)}`
        : `None seen over ${plural(w.data.followed, "block")} followed`;
    case "advisories":
      return w.data?.items[0] ? `Newest ${date(w.data.items[0].published)}` : null;
    case "node-versions":
      return w.data
        ? `${height(w.data.eol)} of ${height(w.data.core)} nodes below ${w.data.below}.0`
        : null;
  }
}

/** A watch in a list: title and context, the number, its recent line, its status. */
export function WatchItem({ w }: { w: WatchState }) {
  const spec = watchSpec(w.id);
  const context = watchContext(w);
  return (
    <li className={s.watch} id={`watch-${w.id}`}>
      <details>
        <summary>
          <span className={s.watchName}>
            <strong>{spec.title}</strong>
            {context && <span>{context}</span>}
          </span>
          <span className={s.watchValue}>{watchValue(w, spec)}</span>
          <Sparkline w={w} />
          <LevelChip level={w.status} />
        </summary>
        <dl className={s.watchMore}>
          <dt>Measures</dt>
          <dd>{spec.measures}.</dd>
          <dt>Thresholds</dt>
          <dd>{spec.thresholds}</dd>
          <dt>Source</dt>
          <dd>{spec.source}.</dd>
          <dt>Last read</dt>
          <dd>
            {dateTime(w.at)}
            {w.height !== null && `, block ${height(w.height)}`}
            {w.error && <span className={s.error}> The latest attempt failed: {w.error}</span>}
          </dd>
        </dl>
      </details>
    </li>
  );
}

export function minutes(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

function signatures(run: LabRun): string {
  const v = run.verified;
  if (v.signatures === null) return "builder signatures not checked";
  return `${v.signatures}${v.signers !== null ? ` of ${v.signers}` : ""} builder signatures good`;
}

/**
 * The lab's run on the newest release of each maintained major, newest first, one line each:
 * tests passed of run, when it ran, whether the download verified and how long the tests took.
 */
export function LabReleases({ runs }: { runs: LabRun[] }) {
  if (!runs.length) return <p className="empty">The lab has not published a run yet.</p>;
  const platforms = [...new Set(runs.map((r) => r.platform))];
  const jobs = [...new Set(runs.map((r) => r.jobs))];
  return (
    <>
      <ul className="lines">
        {runs.map((run) => {
          const passed = run.tests.filter((t) => t.ok).length;
          const library = run.tests.filter((t) => t.name.startsWith(SECP256K1_PREFIX));
          return (
            <li key={`${run.version} ${run.at}`}>
              <span className={s.labReleaseHead}>
                <strong>Bitcoin Core {run.version}</strong>
                <span className={`badge ${passed === run.tests.length ? "badge-ok" : "badge-bad"}`}>
                  {passed} of {run.tests.length} tests passed
                </span>
              </span>
              <span className={s.advisoryMeta}>
                <span>Ran {dateTime(run.at)}</span>
                <span>
                  {run.verified.sha256 ? "Matched SHA256SUMS" : "Did not match SHA256SUMS"}
                </span>
                <span>{signatures(run)}</span>
                {library.length > 0 && (
                  <span>
                    libsecp256k1&apos;s own tests: {library.filter((t) => t.ok).length} of{" "}
                    {plural(library.length, "program")} passed
                  </span>
                )}
                <span>Tests took {minutes(run.seconds)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="small muted" style={{ marginTop: "var(--s2)" }}>
        Each on {andList(platforms)}, Bitcoin Core&apos;s tests {andList(jobs.map(String))} at a
        time
        {runs.some((r) => r.tests.some((t) => t.name.startsWith(SECP256K1_PREFIX))) &&
          ", libsecp256k1's one by one"}
        . An older release runs the tests it has; one added after it shipped is not counted against
        it.
      </p>
    </>
  );
}

/**
 * A threat's lab tests on each maintained release: one row per test, one column per release,
 * newest first. A release whose run did not have a test says so; that is not a failure.
 */
export function LabMatrix({
  tests,
  runs,
}: {
  tests: { name: string; label: string; results: ThreatView["results"] }[];
  runs: LabRun[];
}) {
  return (
    <TableWrap label="This threat's lab tests by release">
      <table className={`table ${s.labMatrix}`}>
        <thead>
          <tr>
            <th scope="col">Test</th>
            {runs.length ? (
              runs.map((run) => (
                <th key={run.version} scope="col">
                  <span className="visually-hidden">Bitcoin Core </span>
                  {run.version}
                  <small>{date(run.at)}</small>
                </th>
              ))
            ) : (
              <th scope="col">Result</th>
            )}
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr key={t.name}>
              <th scope="row">
                {/* A narrow column breaks a script's name after an underscore, not mid-word. */}
                <code>
                  {t.label.split("_").map((part, i) => (
                    <span key={i}>
                      {i > 0 && (
                        <>
                          _<wbr />
                        </>
                      )}
                      {part}
                    </span>
                  ))}
                </code>
              </th>
              {runs.length ? (
                runs.map((run) => {
                  const r = t.results.find((x) => x.version === run.version);
                  return (
                    <td key={run.version}>
                      {r ? (
                        <span className={`badge ${r.ok ? "badge-ok" : "badge-bad"}`}>
                          {r.ok ? "Passed" : "Failed"}
                        </span>
                      ) : (
                        <span className="badge badge-outline">Not run</span>
                      )}
                    </td>
                  );
                })
              ) : (
                <td>
                  <span className="badge badge-outline">Not run yet</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  low: "badge-outline",
  medium: "badge-warn",
  high: "badge-bad",
  critical: "badge-bad",
};

const quoted = (words: string[]) =>
  words.map((w, i) => (
    <span key={w}>
      {i > 0 && (i === words.length - 1 ? " and " : ", ")}
      <q className={s.words}>{w}</q>
    </span>
  ));

/** Why an advisory is filed under a threat, in the rule's own terms, with the words that matched. */
export function matchReason(rule: MatchRule, by: string[]): ReactNode {
  switch (rule) {
    case "owner":
      return "Filed here by the owner's advisory map.";
    case "record":
      return "Filed here because this threat's public record cites its page.";
    case "id":
      return `Filed here because this threat's record names ${by.join(" and ")}.`;
    case "source":
      return `Filed here with every advisory ${by.join(" and ")} publishes, by the advisory map.`;
    case "term":
      return <>Matched by words in its title: {quoted(by)}, a name this threat is known by.</>;
    case "keyword":
      return (
        <>
          Matched by words in its title: {quoted(by)}, which the advisory map files under this
          threat.
        </>
      );
  }
}

/** One CVE id of an advisory, linked to NVD, with what NVD said. */
function NvdTag({ n }: { n: NvdBrief }) {
  return (
    <span className={s.cve}>
      <a href={n.url} rel="noopener noreferrer">
        {n.id}
      </a>
      {n.state === "found" && n.published && <span>in NVD since {date(n.published)}</span>}
      {n.state === "missing" && <span className="badge badge-outline">Not in NVD yet</span>}
    </span>
  );
}

export interface AdvisoryLine extends AdvisoryRecord {
  nvd?: NvdBrief[];
  /** Why it is on this page (a threat's page says which rule filed it). */
  why?: ReactNode;
  /** The threats it is filed under (the map lists them; an empty list says none yet). */
  threats?: { id: string; title: string }[];
}

export function Advisories({ items }: { items: AdvisoryLine[] }) {
  return (
    <ul className="lines">
      {items.map((a) => {
        const nvd = a.nvd ?? [];
        const others = a.ids.filter((id) => !nvd.some((n) => n.id === id));
        return (
          <li key={a.url} className={s.advisory}>
            <a href={a.url} rel="noopener noreferrer">
              {a.title}
            </a>
            <span className={s.advisoryMeta}>
              <span>{a.source}</span>
              <span>{date(a.published)}</span>
              {a.severity && (
                <span className={`badge ${SEVERITY_TONE[a.severity]}`}>
                  {a.severity[0]?.toUpperCase()}
                  {a.severity.slice(1)}
                </span>
              )}
              {nvd.map((n) => (
                <NvdTag key={n.id} n={n} />
              ))}
              {others.map((id) => (
                <span key={id} className={s.cve}>
                  {id}
                </span>
              ))}
            </span>
            {a.why && <span className={s.advisoryWhy}>{a.why}</span>}
            {a.threats && (
              <span className={s.advisoryWhy}>
                {a.threats.length ? (
                  <>
                    Filed under{" "}
                    {a.threats.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ", "}
                        <Link href={`/security/${t.id}`}>{t.title}</Link>
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    On no threat yet: <Link href="/gaps#advisories">an advisory to map</Link>
                  </>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const FINDING_LABEL: Record<FindingKind, string> = {
  missing: "No NVD record",
  rejected: "Rejected by NVD",
  product: "Another product",
  unnamed: "Product unclear",
};

/** What a finding means, for the owner who settles it in the advisory map. */
const BASIS: Record<CveCheck["basis"], string> = {
  owner: "the owner's advisory map",
  advisory: "its advisory",
  page: "the page this threat cites it at",
  any: "the advisory map",
};

function findingText(c: CveCheck): string {
  switch (c.finding) {
    case "missing":
      return "NVD has no record of this id. It may be mistyped, or not published to NVD yet.";
    case "rejected":
      return "NVD lists this id as rejected.";
    case "product":
      return c.expected.length
        ? `NVD's record does not name ${c.expected.join(" or ")}, the project ${BASIS[c.basis]} implies.`
        : "NVD's record names none of the projects the advisory map lists; the map can name the product this id belongs to.";
    case "unnamed":
      return "NVD's record names no product the advisory map knows, so the check could not tell.";
    default:
      return "";
  }
}

/** The threat's CVE ids against NVD: whether each exists, what NVD says it affects, and when. */
export function CveChecks({ cves, threat }: { cves: CveCheck[]; threat: string }) {
  return (
    <ul className={s.tests}>
      {cves.map((c) => (
        <li key={c.id}>
          <code>
            <a href={c.nvd.url} rel="noopener noreferrer">
              {c.id}
            </a>
          </code>
          {c.finding ? (
            <span className={`badge ${c.finding === "unnamed" ? "badge-outline" : "badge-warn"}`}>
              {FINDING_LABEL[c.finding]}
            </span>
          ) : c.nvd.state === "unchecked" ? (
            <span className="badge badge-outline">Not checked yet</span>
          ) : (
            <span className="badge badge-ok">Matches</span>
          )}
          <small>
            {c.nvd.state === "found" && (
              <>
                {c.nvd.published && `In NVD since ${date(c.nvd.published)}. `}
                {c.products.length > 0
                  ? `NVD lists as affected: ${c.products.join(", ")}${c.named.length ? ` (${c.named.join(", ")})` : ""}. `
                  : c.named.length > 0 && `NVD's description names ${c.named.join(" and ")}. `}
              </>
            )}
            {c.threats.find((t) => t.id === threat)?.where.includes("history")
              ? "In this threat's public record."
              : "In the names this threat is known by."}
            {c.nvd.checked && ` Checked ${date(c.nvd.checked)}.`}
          </small>
          {c.finding && <small className={s.finding}>For the owner: {findingText(c)}</small>}
        </li>
      ))}
    </ul>
  );
}
