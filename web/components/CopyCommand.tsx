"use client";

import { useState } from "react";

/** A command a reader can run themselves, with a copy button. Without script it is plain text. */
export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code title={label}>{command}</code>
      <button
        type="button"
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
