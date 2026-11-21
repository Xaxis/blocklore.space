"use client";

import { useState } from "react";

/** A command a reader can run themselves, with a copy button. Without script it is plain text. */
export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      {label && <span className="cmd-label">{label}</span>}
      <code>{command}</code>
      <button
        type="button"
        aria-label={`Copy: ${command}`}
        onClick={() => {
          navigator.clipboard.writeText(command).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
