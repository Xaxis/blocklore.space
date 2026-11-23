import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The time machine's notice, under the page header: which moment the page shows, what has changed
 * since, and the way back to the page as it is now.
 */
export function AsOfNotice({
  title,
  now,
  children,
}: {
  /** "As of block 976,771, 20 Nov 2026" (lib/asof.ts, asOfTitle). */
  title: string;
  /** The page as it is now. */
  now: string;
  children: ReactNode;
}) {
  return (
    <div className="callout callout-info asof-notice" role="note">
      <p>
        <strong>{title}.</strong> {children} <Link href={now}>See it now</Link>
      </p>
    </div>
  );
}

/** "4 claims added, 1 revised and none withdrawn": a count in words, "none" for zero. */
export function sinceWords(parts: [number, string][]): string {
  const words = parts.map(([n, what]) => `${n === 0 ? "none" : n} ${what}`);
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
    : (words[0] ?? "");
}
