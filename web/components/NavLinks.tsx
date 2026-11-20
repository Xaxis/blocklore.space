"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/site";

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={path === n.href || path.startsWith(`${n.href}/`) ? "page" : undefined}
        >
          {n.short ? (
            <>
              <span className="long">{n.label}</span>
              <span className="short">{n.short}</span>
            </>
          ) : (
            n.label
          )}
        </Link>
      ))}
    </nav>
  );
}
