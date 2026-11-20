import type { Store } from "../bundle.ts";
import type { Stamp } from "../schema.ts";

/**
 * The store's own latest moment: the newest verification, revision, run or snapshot in it. A
 * bundle compiled at this moment depends on nothing but the files, so the same commit always
 * builds the same bundle.
 */
export function storeMoment(store: Store): Stamp {
  let best: Stamp = { time: "2009-01-03T18:15:05Z", height: 0 };
  const consider = (s: Stamp | undefined) => {
    if (s && (s.time > best.time || (s.time === best.time && s.height > best.height))) best = s;
  };
  for (const c of store.claims) {
    consider({ time: c.last_verified.time, height: c.last_verified.height });
    for (const r of c.revisions) consider(r.at);
  }
  for (const r of store.runs) consider(r.finished);
  for (const s of store.snapshots) consider(s.manifest.at);
  return best;
}
