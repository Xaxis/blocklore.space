"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locate, VIEWS } from "@/lib/nav";

/** The views, in the bar. */
export function ViewNav() {
  const at = locate(usePathname());
  return (
    <nav className="views" aria-label="Views">
      {VIEWS.map((v) => (
        <Link key={v.id} href={v.href} aria-current={at?.view.id === v.id ? "true" : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

/** The current view's pages, at the top of the panel, when it has more than one. */
export function ViewTabs() {
  const at = locate(usePathname());
  if (!at || at.view.pages.length < 2) return null;
  return (
    <nav className="view-tabs" aria-label={`${at.view.label} pages`}>
      {at.view.pages.map((p) => (
        <Link key={p.href} href={p.href} aria-current={p === at.page ? "page" : undefined}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
