/** The commit this build came from; deploy.sh checks the live page carries it. */
export const BUILD = process.env.BLOCKLORE_BUILD ?? "dev";

/** The site id Overlook issued for blocklore.space (public; it only names the site in page counts). */
export const OVERLOOK_SITE: string | null = "ws_z37gmlxn6w";

export const SITE = {
  name: "Blocklore",
  url: "https://blocklore.space",
  promise: "A library of Bitcoin facts that checks itself.",
  promiseLong:
    "A research brain reads Bitcoin's primary sources around the clock. Every fact it keeps shows its source and the exact quote, is checked again and again, and is sealed in a Bitcoin block, so anyone can prove what it said and when.",
  repo: "https://github.com/Xaxis/blocklore.space",
} as const;
