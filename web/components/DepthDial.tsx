"use client";

import { DEPTH_LABEL, DEPTHS, type Depth } from "@blocklore/core";
import { useEffect, useState } from "react";
import { DEPTH_HINT } from "@/lib/labels";

/**
 * The depth dial: five stops from Curious to Researcher. It sets `data-dial` on the topic body, and
 * CSS hides claims deeper than the stop. The choice lives in the URL (?depth=), so a link keeps it
 * and nothing is stored in the browser. Without script every claim shows.
 */
export function DepthDial({
  target,
  counts,
  initial,
}: {
  target: string;
  /** Claims visible at each stop, shallowest first. */
  counts: number[];
  initial: Depth;
}) {
  const [depth, setDepth] = useState<Depth>(initial);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("depth");
    if (q && (DEPTHS as readonly string[]).includes(q)) setDepth(q as Depth);
  }, []);

  useEffect(() => {
    const el = document.getElementById(target);
    if (el) el.dataset.dial = String(DEPTHS.indexOf(depth));
  }, [depth, target]);

  const choose = (d: Depth) => {
    setDepth(d);
    const url = new URL(window.location.href);
    if (d === initial) url.searchParams.delete("depth");
    else url.searchParams.set("depth", d);
    window.history.replaceState(null, "", url);
  };

  const i = DEPTHS.indexOf(depth);
  const total = counts[counts.length - 1] ?? 0;
  return (
    <div className="dial">
      <div className="dial-label">
        <span aria-hidden="true">How deep</span>
        <span>
          {counts[i]} of {total} claims
        </span>
      </div>
      <fieldset className="dial-stops">
        <legend className="visually-hidden">How deep to read</legend>
        {DEPTHS.map((d, j) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === depth}
            className={j < i ? "below" : undefined}
            onClick={() => choose(d)}
            title={DEPTH_HINT[d]}
          >
            {DEPTH_LABEL[d]}
          </button>
        ))}
      </fieldset>
      <p className="dial-hint">{DEPTH_HINT[depth]}</p>
    </div>
  );
}
