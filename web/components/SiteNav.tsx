"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locate, VIEWS } from "@/lib/nav";

/** The modes, in the bar. */
export function ViewNav() {
  const at = locate(usePathname());
  return (
    <nav className="views" aria-label="Modes">
      {VIEWS.filter((v) => !v.cta).map((v) => (
        <Link key={v.id} href={v.href} aria-current={at?.view.id === v.id ? "true" : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

/** The bar's one call to action: bring your own AI to Blocklore over MCP. */
export function ConnectButton() {
  const at = locate(usePathname());
  const v = VIEWS.find((x) => x.cta);
  if (!v) return null;
  return (
    <Link
      href={v.href}
      className="connect"
      aria-current={at?.view.id === v.id ? "true" : undefined}
      title="Let your own AI assistant read and cite Blocklore, over MCP"
    >
      <span className="connect-long">{v.label}</span>
      <span className="connect-short" aria-hidden="true">
        Connect
      </span>
    </Link>
  );
}

/** The current mode's pages, at the top of the panel, when it has more than one. */
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
