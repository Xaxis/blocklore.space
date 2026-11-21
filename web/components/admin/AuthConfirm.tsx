"use client";

import { useEffect, useState } from "react";

/**
 * The link's token sits in the fragment (#t=...), which never reaches a server log. Signing in is
 * a button, a POST, so a mail scanner that opens links cannot use the link up.
 */
export function AuthConfirm() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    const m = /^#t=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
    // A second run (React's dev double effect) finds the hash already cleared: keep the token.
    setToken((prev) => m?.[1] ?? prev ?? "");
    if (m) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  if (token === null) return null;
  if (!token)
    return (
      <p className="callout callout-warn">
        <span>
          This page needs the link from the mail. <a href="/admin/login">Ask for a new one</a>.
        </span>
      </p>
    );
  return (
    <div className="stack">
      <p className="muted">Sign in on this device as the owner.</p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const res = await fetch("/api/admin/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ t: token }),
          }).catch(() => null);
          if (res?.ok) {
            window.location.href = "/admin";
            return;
          }
          const body = (await res?.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "The site did not answer.");
          setState("error");
        }}
      >
        {state === "busy" ? "Signing in" : "Sign in"}
      </button>
      {state === "error" && (
        <p className="callout callout-bad" role="alert">
          <span>
            {error} <a href="/admin/login">Ask for a new link</a>.
          </span>
        </p>
      )}
    </div>
  );
}
