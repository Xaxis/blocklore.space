"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (state === "sent")
    return (
      <p className="callout callout-ok" role="status">
        <span>
          If that is the owner&apos;s address, a sign-in link is on its way. Open it on this device;
          it expires in 15 minutes.
        </span>
      </p>
    );
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        try {
          const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          setState(res.ok ? "sent" : "error");
        } catch {
          setState("error");
        }
      }}
    >
      <label className="field">
        <span>Email</span>
        <input
          className="input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
        {state === "sending" ? "Sending" : "Send the link"}
      </button>
      {state === "error" && (
        <p className="callout callout-bad" role="alert">
          The site did not answer. Try again in a moment.
        </p>
      )}
    </form>
  );
}
