"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/evaluator", label: "Evaluator", count: "review" as const },
  { href: "/admin/security", label: "Security embargo" },
  { href: "/admin/advisories", label: "Advisories and NVD" },
  { href: "/admin/research", label: "Research" },
  { href: "/admin/runs", label: "Runs and usage" },
  { href: "/admin/loop", label: "Weekly review" },
  { group: "Direct the brain" },
  { href: "/admin/agenda", label: "Agenda" },
  { href: "/admin/policy", label: "Gate policy" },
  { href: "/admin/debates", label: "Debate maps" },
  { href: "/admin/threats", label: "Threat map" },
  { href: "/admin/lessons", label: "Lessons and focus" },
  { href: "/admin/questions", label: "Reader suggestions" },
  { href: "/admin/reports", label: "Reader reports" },
  { group: "System" },
  { href: "/admin/signing", label: "Signing" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav({ review }: { review: number }) {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      {ITEMS.map((it) =>
        "group" in it ? (
          <span key={it.group} className="nav-group">
            {it.group}
          </span>
        ) : (
          <Link
            key={it.href}
            href={it.href}
            aria-current={
              (it.href === "/admin" ? path === "/admin" : path.startsWith(it.href ?? ""))
                ? "page"
                : undefined
            }
          >
            {it.label}
            {it.count === "review" && review > 0 && <span className="badge">{review}</span>}
          </Link>
        ),
      )}
      <span className="nav-group">Session</span>
      <Link href="/">View the site</Link>
      <button
        type="button"
        className="nav-button"
        onClick={async () => {
          await fetch("/api/admin/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          window.location.href = "/admin/login";
        }}
      >
        Sign out
      </button>
    </nav>
  );
}
