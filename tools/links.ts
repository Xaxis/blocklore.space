/**
 * Broken internal links on the running site: starts from the sitemap, follows every same-site link
 * in the server-rendered HTML (feeds, exports and other files are fetched but not parsed), and
 * reports each page that does not answer 200, with the pages that link to it. The admin is left out.
 * Links a client component builds only in the browser are not seen.
 *
 *   node tools/links.ts [BASE_URL]
 *
 * Exits 1 on any broken link. Never point it at blocklore.space: use a local build or
 * https://blocklore.vercel.app, and it sends X-Blocklore-Check so the reach counts skip it.
 */
const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const origin = new URL(base).origin;
const headers = { "X-Blocklore-Check": "1" };
const MAX = 5000;
const WORKERS = 6;

const status = new Map<string, number | string | null>();
const from = new Map<string, Set<string>>();
const queue: string[] = [];

function add(path: string, ref: string): void {
  if (path.startsWith("/_next/") || path.startsWith("/admin") || path.startsWith("/api/v1/admin"))
    return;
  const refs = from.get(path) ?? new Set<string>();
  refs.add(ref);
  from.set(path, refs);
  if (!status.has(path)) {
    status.set(path, null);
    queue.push(path);
  }
}

const sitemap = await (await fetch(`${base}/sitemap.xml`, { headers })).text();
for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g))
  add(new URL(m[1] as string).pathname, "sitemap");

let busy = 0;
const idle = () => new Promise((resolve) => setTimeout(resolve, 25));

async function work(): Promise<void> {
  // a worker waits while others are still fetching pages that may add links, and stops when none are
  while (queue.length || busy) {
    const path = queue.shift();
    if (path === undefined) {
      await idle();
      continue;
    }
    busy++;
    try {
      await visit(path);
    } finally {
      busy--;
    }
  }
}

async function visit(path: string): Promise<void> {
  if (status.size > MAX) throw new Error(`more than ${MAX} pages: is something generating links?`);
  let res: Response;
  try {
    res = await fetch(base + path, { headers, redirect: "manual" });
  } catch (e) {
    status.set(path, `no answer: ${(e as Error).message}`);
    return;
  }
  status.set(path, res.status);
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const to = new URL(location, base);
    if (to.origin === origin) add(to.pathname, path);
    return;
  }
  if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("text/html")) {
    await res.arrayBuffer().catch(() => undefined);
    return;
  }
  const html = await res.text();
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const href = (m[1] as string).replace(/&amp;/g, "&");
    if (!href.startsWith("//")) add(href, path);
  }
}

await Promise.all(Array.from({ length: WORKERS }, work));

const broken = [...status].filter(([, s]) => !(typeof s === "number" && s >= 200 && s < 400));
for (const [path, s] of broken) {
  const refs = [...(from.get(path) ?? [])];
  console.log(
    `${s} ${path}  linked from ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ` and ${refs.length - 5} more` : ""}`,
  );
}
console.log(
  broken.length
    ? `links: ${broken.length} broken of ${status.size} pages`
    : `links ok: ${status.size} pages, none broken`,
);
process.exit(broken.length ? 1 : 0);
