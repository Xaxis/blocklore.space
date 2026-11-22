import type { LabRun, ThreatStatus, ThreatView, WatchLevel, WatchState } from "@blocklore/core";
import { type WatchSpec, watchSpec } from "@blocklore/core";
import Link from "next/link";
import { date, dateTime, height, plural } from "@/lib/format";
import s from "./Security.module.css";

// The Security mode's pieces: status chips, a threat row, a watch reading with its sparkline, the
// lab's latest run and the advisories list. The pages compose them; every sentence about a threat
// itself is a claim, rendered by ClaimLine on the threat's page.

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
  return (
    <div
      className={s.strip}
      role="img"
      aria-label={`${threats.length} threats: ${(["defended", "watching", "open"] as const)
        .map(
          (k) => `${threats.filter((t) => t.live === k).length} ${THREAT_LABEL[k].toLowerCase()}`,
        )
        .join(", ")}`}
    >
      {layers.map((l) => (
        <a key={l.id} href={`#${l.id}`} title={l.label} style={{ flexGrow: l.threats.length }}>
          {l.threats.map((t) => (
            <i key={t.id} data-s={t.live} />
          ))}
        </a>
      ))}
    </div>
  );
}

/** One threat in a layer's list: its status, its title, and what explains, watches and tests it. */
export function ThreatRow({ t }: { t: ThreatView }) {
  const claims = t.published.claims.length + t.published.mitigations.length;
  const passed = t.results.filter((r) => r.ok).length;
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
              {t.results.length === 0
                ? `${plural(t.lab.length, "lab test")}, not run yet`
                : `lab ${passed} of ${t.lab.length} passing`}
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

/** The lab's newest published run, or a plain empty state. */
export function LabSummary({ run }: { run: LabRun | null }) {
  if (!run) return <p className="empty">The lab has not published a run yet.</p>;
  const passed = run.tests.filter((t) => t.ok).length;
  const all = passed === run.tests.length;
  return (
    <section className="panel" aria-label={`Lab run on Bitcoin Core ${run.version}`}>
      <div className="panel-head">
        <h3>Bitcoin Core {run.version}</h3>
        <span className={`badge ${all ? "badge-ok" : "badge-bad"}`}>
          {passed} of {run.tests.length} tests passed
        </span>
      </div>
      <div className="panel-body">
        <dl className="dl">
          <dt>Download matched SHA256SUMS</dt>
          <dd>{run.verified.sha256 ? "Yes" : "No"}</dd>
          <dt>Builder signatures found good</dt>
          <dd>
            {run.verified.signatures === null
              ? "Not checked"
              : `${run.verified.signatures}${run.verified.signers !== null ? ` of ${run.verified.signers}` : ""}`}
          </dd>
          <dt>Ran</dt>
          <dd>{dateTime(run.at)}</dd>
          <dt>Took</dt>
          <dd>
            {minutes(run.seconds)}, {run.jobs} at a time
          </dd>
          <dt>Machine</dt>
          <dd>{run.platform}</dd>
        </dl>
      </div>
    </section>
  );
}

export type Advisory = NonNullable<
  Extract<WatchState, { id: "advisories" }>["data"]
>["items"][number];

const SEVERITY_TONE: Record<string, string> = {
  low: "badge-outline",
  medium: "badge-warn",
  high: "badge-bad",
  critical: "badge-bad",
};

export function Advisories({ items }: { items: Advisory[] }) {
  return (
    <ul className="lines">
      {items.map((a) => (
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
          </span>
        </li>
      ))}
    </ul>
  );
}
