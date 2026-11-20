// The time machine's engine: a claim as the brain knew it at a moment. The claim's top-level fields
// are its current state; walking its revisions backwards and restoring each `before` rebuilds any
// earlier one (CLAIMS.md, "Revisions").
import type { Claim, Revision } from "./schema.ts";

/** A moment by wall time (ISO 8601, UTC) or by block height. */
export type Moment = { time: string } | { height: number };

function after(r: Revision["at"], m: Moment): boolean {
  return "time" in m ? r.time > m.time : r.height > m.height;
}

/** The claim as it stood at `m`, or null when it did not exist yet. */
export function claimAsOf(claim: Claim, m: Moment): Claim | null {
  const first = claim.revisions[0];
  if (!first || after(first.at, m)) return null;
  let state: Claim = { ...claim };
  const kept: Revision[] = [];
  for (let i = claim.revisions.length - 1; i >= 0; i--) {
    const r = claim.revisions[i] as Revision;
    if (after(r.at, m)) {
      if (r.before) state = { ...state, ...r.before } as Claim;
    } else kept.unshift(r);
  }
  const latest = kept[kept.length - 1] as Revision;
  return { ...state, revisions: kept, run: latest.run };
}

/** One revision as a change event, for the Pulse and the changelogs. */
export interface ChangeEvent {
  claim: string;
  topics: string[];
  rev: number;
  change: Revision["change"];
  at: Revision["at"];
  run: string;
  note?: string;
  statement: string;
  before?: Revision["before"];
}

export function changeEvents(claim: Claim): ChangeEvent[] {
  return claim.revisions.map((r) => {
    const state = claimAsOf(claim, { time: r.at.time }) as Claim;
    return {
      claim: claim.id,
      topics: state.topics,
      rev: r.rev,
      change: r.change,
      at: r.at,
      run: r.run,
      note: r.note,
      statement: state.statement,
      before: r.before,
    };
  });
}
