// The app's map: four modes in one shell, plus the button that connects a reader's own AI. The bar
// shows the modes; a mode with more than one page shows its pages as tabs at the top of the panel.
// Every URL still works on its own (and is what search engines and shared links see), but moving
// between them never leaves the app: the scene and the bar stay, only the panel changes.
//
//   Brain      what Blocklore is, and what its research brain is doing right now
//   Knowledge  what it knows: topics, claims, proposals
//   Security   every threat to Bitcoin, watched and tested
//   Proof      how anyone can check it: sealed editions, who signed them, the evaluator, each
//              month's progress, the method

export interface ViewPage {
  href: string;
  label: string;
  /** Other paths that belong to this page (its detail pages, or pages linked from it). */
  match?: string[];
}

export interface View {
  id: "brain" | "knowledge" | "security" | "proof" | "connect";
  label: string;
  href: string;
  pages: ViewPage[];
  /** Shown as the bar's call to action rather than among the modes. */
  cta?: boolean;
}

export const VIEWS: View[] = [
  {
    id: "brain",
    label: "Brain",
    href: "/",
    pages: [
      { href: "/", label: "Now" },
      { href: "/gaps", label: "Learning next" },
      { href: "/changes", label: "Changes", match: ["/changes/", "/digest", "/pulse"] },
      { href: "/log", label: "Research log", match: ["/log/"] },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    href: "/topics",
    pages: [
      { href: "/topics", label: "Topics", match: ["/topics/", "/claims/"] },
      { href: "/proposals", label: "Proposals", match: ["/proposals/", "/bips"] },
    ],
  },
  {
    id: "security",
    label: "Security",
    href: "/security",
    pages: [{ href: "/security", label: "Threat map", match: ["/security/"] }],
  },
  {
    id: "proof",
    label: "Proof",
    href: "/verify",
    pages: [
      { href: "/verify", label: "Sealed editions", match: ["/snapshots"] },
      { href: "/verify/keys", label: "Signatures", match: ["/orangecheck/"] },
      { href: "/verify/evaluator", label: "Evaluator" },
      { href: "/progress", label: "Progress", match: ["/progress/"] },
      { href: "/about", label: "How it works", match: ["/about/"] },
    ],
  },
  {
    id: "connect",
    label: "Connect your AI",
    href: "/connect",
    cta: true,
    pages: [
      { href: "/connect", label: "Your AI, over MCP" },
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
