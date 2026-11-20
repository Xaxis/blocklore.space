import type { Rung } from "@blocklore/core";
import { TierTag } from "./bits";

const SHOW = 5;

/** From concept to code to history: the primary record behind what the page says, rung by rung. */
export function Ladder({ rungs }: { rungs: Rung[] }) {
  if (rungs.length === 0) return null;
  return (
    <nav className="ladder" aria-label="Sources, from specification to coverage">
      {rungs.map((r) => (
        <section className="rung" key={r.id}>
          <h3>{r.label}</h3>
          <ul>
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
            <p className="more">and {r.items.length - SHOW} more in the claims</p>
          )}
        </section>
      ))}
    </nav>
  );
}
