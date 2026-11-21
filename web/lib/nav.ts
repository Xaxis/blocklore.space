// The app's map: six views in one shell. The bar shows the views; a view with more than one page
// shows its pages as tabs at the top of the panel. Every URL still works on its own (and is what
// search engines and shared links see), but moving between them never leaves the app: the scene
// and the bar stay, only the panel changes.

export interface ViewPage {
  href: string;
  label: string;
  /** Other paths that belong to this page (its detail pages). */
  match?: string[];
}

export interface View {
  id: "explore" | "changes" | "proposals" | "proof" | "method" | "connect";
  label: string;
  href: string;
  pages: ViewPage[];
}

export const VIEWS: View[] = [
  {
    id: "explore",
    label: "Explore",
    href: "/",
    pages: [
      { href: "/", label: "Topics", match: ["/topics", "/claims/"] },
      { href: "/gaps", label: "What it does not know" },
    ],
  },
  {
    id: "changes",
    label: "Changes",
    href: "/changes",
    pages: [
      { href: "/changes", label: "Store" },
      { href: "/changes/corrections", label: "Corrections" },
      { href: "/pulse", label: "Chain and upstream" },
      { href: "/digest", label: "Digests", match: ["/digest/"] },
      { href: "/log", label: "Research log", match: ["/log/"] },
    ],
  },
  {
    id: "proposals",
    label: "Proposals",
    href: "/proposals",
    pages: [
      { href: "/proposals", label: "Tracker" },
      { href: "/bips", label: "BIP index" },
    ],
  },
  {
    id: "proof",
    label: "Proof",
    href: "/verify",
    pages: [{ href: "/verify", label: "Snapshots" }],
  },
  {
    id: "method",
    label: "Method",
    href: "/about",
    pages: [
      { href: "/about", label: "How it works" },
      { href: "/about/editorial", label: "Editorial rules" },
      { href: "/about/sources", label: "Sources" },
      { href: "/about/claims", label: "Claim format" },
      { href: "/about/security", label: "Security" },
      { href: "/about/architecture", label: "Architecture" },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    href: "/connect",
    pages: [
      { href: "/connect", label: "Your model (MCP)" },
      { href: "/about/api", label: "API and data" },
    ],
  },
];

function pageMatches(p: ViewPage, path: string): boolean {
  return path === p.href || (p.match ?? []).some((m) => path.startsWith(m));
}

/** The view and page a path belongs to; the most specific page wins. */
export function locate(path: string): { view: View; page: ViewPage } | null {
  let best: { view: View; page: ViewPage; len: number } | null = null;
  for (const view of VIEWS)
    for (const page of view.pages)
      if (pageMatches(page, path)) {
        const len =
          path === page.href ? 1000 : Math.max(...(page.match ?? [""]).map((m) => m.length));
        if (!best || len > best.len) best = { view, page, len };
      }
  return best ? { view: best.view, page: best.page } : null;
}
