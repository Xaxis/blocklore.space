/** The commit this build came from; deploy.sh checks the live page carries it. */
export const BUILD = process.env.BLOCKLORE_BUILD ?? "dev";

/** The site id Overlook issued for blocklore.space (public; it only names the site in page counts). */
export const OVERLOOK_SITE: string | null = "ws_z37gmlxn6w";

export const SITE = {
  name: "Blocklore",
  url: "https://blocklore.space",
  promise: "The current, cited, verifiable state of Bitcoin knowledge.",
  promiseLong:
    "What is true, what is contested, what changed, and how to check it yourself. Every sentence is a claim with sources, quotes that code found at the link, and checks against the chain and the code that you can run yourself.",
  repo: "https://github.com/Xaxis/blocklore.space",
} as const;

/** `short` replaces `label` on phones, so the whole nav fits one row of the sticky masthead. */
export const NAV: readonly { href: string; label: string; short?: string }[] = [
  { href: "/topics", label: "Topics" },
  { href: "/pulse", label: "Pulse" },
  { href: "/proposals", label: "Proposals" },
  { href: "/changes", label: "Changes" },
  { href: "/log", label: "Research log", short: "Log" },
  { href: "/about", label: "About" },
];
