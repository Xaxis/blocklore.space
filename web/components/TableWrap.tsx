import type { ReactNode } from "react";

/**
 * A table that may scroll sideways on a narrow screen: a named region a keyboard can reach and
 * scroll (WCAG 2.1.1), the way a pointer can.
 */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard
    <section className="table-wrap" aria-label={`Table: ${label}`} tabIndex={0}>
      {children}
    </section>
  );
}
