import type { Rung } from "@blocklore/core";
import { TierTag } from "./bits";

const SHOW = 4;

/** From specification to code to coverage: the record behind what the page says, rung by rung. */
export function Ladder({ rungs }: { rungs: Rung[] }) {
  if (rungs.length === 0) return null;
  return (
    <>
      {rungs.map((r) => (
        <section className="rail-block" key={r.id} aria-label={r.label}>
          <h3>{r.label}</h3>
          <ul className="source-list">
            {r.items.slice(0, SHOW).map((it) => (
              <li key={it.url}>
                <TierTag tier={it.tier} />
                <a href={it.url} rel="noopener noreferrer" target="_blank">
                  {it.title}
                </a>
              </li>
            ))}
          </ul>
          {r.items.length > SHOW && (
            <p className="small muted">and {r.items.length - SHOW} more in the claims</p>
          )}
        </section>
      ))}
    </>
  );
}
