"use client";

import type { DaemonState } from "@blocklore/core/control";
import type { NostrView } from "@blocklore/core/nostr";
import { BrainStatus, SentList, useBrain } from "./live";
import { NostrPanel } from "./NostrPanel";

const TICK_HINT = {
  hourly:
    "Feeds, the BIP index, timestamp upgrades, OrangeCheck records, reader suggestions, reader reports (each reported claim rechecked), the security watches that are due, and Nostr notes while posting is on; then ships.",
  daily: "Rechecks the 30 stalest claims, snapshots when claims changed; then ships.",
  weekly:
    "The search bench (free), published to the gaps view, and the security lab on the newest Bitcoin Core release; then ships.",
} as const;

export function SettingsPanel({
  initial,
  online,
  nostr,
  email,
}: {
  initial: DaemonState | null;
  online: boolean;
  nostr: NostrView | null;
  email: string;
}) {
  const b = useBrain({ nostr: true, initial: { state: initial, online, nostr } });
  const s = b.state;

  return (
    <>
      <section className="block" aria-labelledby="brain-h">
        <div className="block-head">
          <h2 id="brain-h">The brain</h2>
          <BrainStatus state={s} online={b.online} />
        </div>
        <div className="panel">
          <div className="panel-body stack">
            <div className="toolbar">
              <button
                type="button"
                className={`btn ${s?.settings.paused ? "btn-primary" : "btn-danger"}`}
                disabled={!s}
                onClick={() =>
                  s &&
                  b.send(
                    { type: "settings", patch: { paused: !s.settings.paused } },
                    s.settings.paused ? "Resume the brain" : "Pause the brain",
                  )
                }
              >
                {s?.settings.paused ? "Resume everything" : "Pause everything"}
              </button>
              <span className="small muted">
                While paused, no tick and no research session starts. Your review decisions still
                apply.
              </span>
            </div>
            {s && (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Tick</th>
                    <th scope="col">What it does</th>
                    <th scope="col">On</th>
                  </tr>
                </thead>
                <tbody>
                  {(["hourly", "daily", "weekly"] as const).map((t) => (
                    <tr key={t}>
                      <th scope="row">{t}</th>
                      <td className="small">{TICK_HINT[t]}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Run the ${t} tick`}
                          checked={s.settings.ticks[t]}
                          onChange={(e) =>
                            b.send(
                              { type: "settings", patch: { ticks: { [t]: e.target.checked } } },
                              `Turn the ${t} tick ${e.target.checked ? "on" : "off"}`,
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="toolbar">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => b.send({ type: "ping" }, "Ping the brain")}
              >
                Ping the brain
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => b.send({ type: "ship" }, "Push and deploy now")}
              >
                Deploy now
              </button>
              {s && (
                <span className="small muted">
                  Devbox {s.host}, up since {s.started.slice(0, 16).replace("T", " ")} UTC
                </span>
              )}
            </div>
            <SentList sent={b.sent.filter((x) => !x.label.includes("Nostr"))} />
          </div>
        </div>
      </section>

      <NostrPanel
        state={s}
        view={b.nostr}
        send={b.send}
        sent={b.sent.filter((x) => x.label.includes("Nostr"))}
      />

      <section className="block" aria-labelledby="sess-h">
        <div className="block-head">
          <h2 id="sess-h">Your session</h2>
        </div>
        <div className="toolbar">
          <span className="small">Signed in as {email}.</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              if (!window.confirm("Sign out on every device, this one included?")) return;
              await fetch("/api/admin/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ all: true }),
              });
              window.location.href = "/admin/login";
            }}
          >
            Sign out everywhere
          </button>
        </div>
      </section>
    </>
  );
}
