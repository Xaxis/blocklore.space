// The daily digest: what one UTC day changed in the store, compiled from its own events, so every
// line is a published claim's statement and nothing needs checking twice. Pure: no clock, no files.
import type { ChangeEvent } from "./replay.ts";
import type { BipChange, Run } from "./schema.ts";

export interface DigestDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  /** Lowest and highest block heights the day's events were stamped at. */
  heights: { from: number; to: number };
  /** Corrections first: they change what a reader may already believe. */
  corrections: ChangeEvent[];
  /** Other revisions to claims published before. */
  revisions: ChangeEvent[];
  /** New claims, grouped by their primary topic, in the order topics are given. */
  created: { topic: string; events: ChangeEvent[] }[];
  bips: BipChange[];
  runs: { id: string; published: number; revised: number; held: number }[];
}

const day = (iso: string) => iso.slice(0, 10);

/** Every day with at least one event or BIP index change, newest first. */
export function digestDays(
  events: readonly ChangeEvent[],
  runs: readonly Run[],
  bipChanges: readonly BipChange[],
  topicOrder: readonly string[],
): DigestDay[] {
  const dates = new Set([
    ...events.map((e) => day(e.at.time)),
    ...bipChanges.map((c) => day(c.at.time)),
  ]);
  const rank = (t: string) => {
    const i = topicOrder.indexOf(t);
    return i === -1 ? topicOrder.length : i;
  };
  const byTime = (a: ChangeEvent, b: ChangeEvent) =>
    a.at.time.localeCompare(b.at.time) || a.claim.localeCompare(b.claim) || a.rev - b.rev;
  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const evs = events.filter((e) => day(e.at.time) === date).sort(byTime);
      const bips = bipChanges.filter((c) => day(c.at.time) === date);
      const hs = [...evs.map((e) => e.at.height), ...bips.map((c) => c.at.height)];
      const groups = new Map<string, ChangeEvent[]>();
      for (const e of evs.filter((x) => x.change === "created")) {
        const t = e.topics[0] ?? "";
        groups.set(t, [...(groups.get(t) ?? []), e]);
      }
      return {
        date,
        heights: { from: Math.min(...hs), to: Math.max(...hs) },
        corrections: evs.filter((e) => e.change === "corrected"),
        revisions: evs.filter((e) => e.change !== "created" && e.change !== "corrected"),
        created: [...groups]
          .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
          .map(([topic, list]) => ({ topic, events: list })),
        bips,
        runs: runs
          .filter((r) => day(r.finished.time) === date)
          .sort((a, b) => a.finished.time.localeCompare(b.finished.time))
          .map((r) => ({
            id: r.id,
            published: r.published.length,
            revised: r.revised.length,
            held: r.gated.reduce((n, g) => n + g.count, 0),
          })),
      };
    });
}
