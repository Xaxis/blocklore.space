// Drives a BIP's page, its API answer and the MCP tool against a running site, prints what each
// shows, and fails on the first disagreement: the page and GET /api/v1/bips/<n> must hold the same
// entry, claims, code and history, get_bip must answer exactly what the API does, every claim must
// cite the BIP, every line of code must come from such a claim, a BIP nothing cites must say so
// with the link to suggest a question, the version bits must show exactly where the answer's
// signaling says, and an unknown number must be a 404 and a tool error. Then
// the links in: /proposals, /bips, a claim's BIP source, the redirect from /bips/<n>, the sitemap.
//
//   node .claude/skills/verify/bipcheck.ts [base] [n...]
//     base defaults to http://localhost:3721; the numbers to 341 141 119 333
//
// Every request carries the check header, so the site's reach counts never count it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [arg, ...nums] = process.argv.slice(2);
const base = (arg ?? "http://localhost:3721").replace(/\/$/, "");
const NUMBERS = nums.length ? nums.map(Number) : [341, 141, 119, 333];
const UNKNOWN = 9999;
const CHECK = { "X-Blocklore-Check": "1" };

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`bipcheck FAILED: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

async function get(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...CHECK, ...init.headers } });
  return { res, text: await res.text() };
}
const html = (t: string) => t.replaceAll("<!-- -->", "");
const text = (t: string) =>
  t
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
/** One block of a page by its id, up to the next block. */
const block = (page: string, id: string) => {
  const at = page.indexOf(`<section class="block" id="${id}"`);
  if (at < 0) return null;
  const end = page.indexOf('<section class="block"', at + 10);
  return page.slice(at, end < 0 ? undefined : end);
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

type Brief = {
  id: string;
  url: string;
  statement: string;
  status: string;
  kind: string;
  marks: string[];
};
type BipAnswer = {
  url: string;
  commit: string;
  read: { time: string; height: number };
  index: string;
  bip: {
    n: number;
    title: string;
    layer?: string;
    type: string;
    status: string;
    url: string | null;
    cited_by: Brief[];
  };
  changes: { field: string; before?: string; after?: string; commit: string }[];
  topics: { slug: string; title: string | null; depths: { depth: string; claims: string[] }[] }[];
  implementations: { title: string; url: string; kind: string; claims: string[] }[];
  signaling: { scheme: boolean; deployments: { bit: number }[] } | null;
};

const client = new Client({ name: "blocklore-bipcheck", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: CHECK } }),
);
async function tool(number: number) {
  const r = await client.callTool({ name: "get_bip", arguments: { number } });
  return { error: r.isError === true, data: r.structuredContent as Record<string, unknown>, r };
}

for (const n of NUMBERS) {
  console.log(`\nBIP ${n}`);
  const page = await get(`/proposals/${n}`);
  check(page.res.status === 200, `/proposals/${n} answers 200`);
  const h = html(page.text);
  const api = await get(`/api/v1/bips/${n}`);
  check(api.res.status === 200, `/api/v1/bips/${n} answers 200`);
  const a = JSON.parse(api.text) as BipAnswer & { edition: unknown };

  const h1 = text(/<h1>([\s\S]*?)<\/h1>/.exec(h)?.[1] ?? "");
  const header = /<header class="page-header">([\s\S]*?)<\/header>/.exec(h)?.[1] ?? "";
  const status = text(/<div class="meta"><span class="badge[^"]*">([^<]+)<\/span>/.exec(header)?.[1] ?? "");
  console.log(`    page: "${h1}" | status ${status} | ${text(/<div class="meta">([\s\S]*?)<\/div>/.exec(header)?.[1] ?? "")}`);
  console.log(
    `    api:  "${a.bip.title}" | ${a.bip.layer ?? "no layer"}, ${a.bip.type}, ${a.bip.status} | index ${a.commit.slice(0, 10)} read at block ${a.read.height} | text ${a.bip.url ?? "none"}`,
  );
  check(h1 === `BIP ${n}, ${a.bip.title}`, `the page's title is the index's: "${h1}"`);
  check(status === a.bip.status, `the page's status chip is the index's: ${status}`);
  check(
    a.bip.url === null || header.includes(`href="${a.bip.url}"`),
    "the page links the BIP's text at the index's commit",
  );
  check(a.url.endsWith(`/proposals/${n}`), `the API names the page: ${a.url}`);

  // Claims: the same ones, in the same groups, each citing this BIP.
  const claims = block(h, "claims") ?? "";
  const onPage = count(claims, '<div class="claim" ');
  const grouped = a.topics.flatMap((t) => t.depths.flatMap((d) => d.claims));
  check(
    onPage === a.bip.cited_by.length && grouped.length === onPage,
    `${onPage} claims on the page, ${a.bip.cited_by.length} in the API, ${grouped.length} in its groups`,
  );
  for (const t of a.topics) {
    console.log(
      `    ${t.title ?? t.slug}: ${t.depths.map((d) => `${d.depth} ${d.claims.length}`).join(", ")}`,
    );
    check(claims.includes(`id="topic-${t.slug}"`), `the page groups topic ${t.slug}`);
  }
  for (const c of a.bip.cited_by) {
    const full = JSON.parse((await get(`/api/v1/claims/${c.id}`)).text) as {
      claim: { sources: { url?: string }[] };
    };
    const cites = full.claim.sources.some((s) =>
      new RegExp(`/bip-${String(n).padStart(4, "0")}\\.(mediawiki|md)`).test(s.url ?? ""),
    );
    if (!cites) check(false, `${c.id} cites BIP ${n}`);
    check(claims.includes(`id="${c.id}"`), `${c.id} is on the page`);
    if (c.marks.length) console.log(`    marked ${c.id}: ${c.marks.join(", ")}`);
  }
  check(true, `every one of the ${a.bip.cited_by.length} claims cites BIP ${n}'s text`);
  const contested = a.bip.cited_by.filter((c) => c.status === "contested" || c.marks.length);
  check(
    contested.every((c) => c.marks.length > 0),
    `contested claims, stances and arguments carry marks (${contested.length})`,
  );
  if (!a.bip.cited_by.length) {
    check(
      claims.includes("Blocklore has no claims citing this BIP yet.") &&
        claims.includes('href="/gaps#suggest-block"'),
      'no claim cites it: the page says "Blocklore has no claims citing this BIP yet." and links /gaps',
    );
  }

  // Code: only from claims citing it, and the same lines on the page.
  const code = block(h, "code");
  const ids = new Set(a.bip.cited_by.map((c) => c.id));
  for (const i of a.implementations) {
    console.log(`    code: ${i.title} (${i.kind}) cited by ${i.claims.join(", ")}`);
    check(i.claims.length > 0 && i.claims.every((id) => ids.has(id)), `${i.title} comes from claims citing BIP ${n}`);
  }
  check(
    (code === null ? 0 : count(code, "<li")) === a.implementations.length,
    `${a.implementations.length} lines of code on the page and in the API`,
  );

  // History: the index's recorded changes to this entry.
  const history = block(h, "history") ?? "";
  for (const c of a.changes)
    console.log(`    change: ${c.field} ${c.before ?? ""} to ${c.after ?? ""} at ${c.commit.slice(0, 10)}`);
  check(
    a.changes.length
      ? count(history, "<li>") === a.changes.length
      : history.includes("Blocklore has seen no change to this entry"),
    `${a.changes.length} recorded changes on the page and in the API`,
  );
  const blocks = [...h.matchAll(/<section class="block" id="([^"]+)"/g)].map((m) => m[1]);
  const bits = a.signaling
    ? a.signaling.scheme
      ? "in full, as for BIP 9 and 320"
      : `for bits ${a.signaling.deployments.map((d) => d.bit).join(", ")}`
    : "none, as its answer's signaling is null";
  check(
    blocks.every((b) => ["claims", "code", "history", "version-bits"].includes(b as string)) &&
      blocks.includes("version-bits") === (a.signaling !== null),
    `the page's parts: ${blocks.join(", ")} (version bits ${bits})`,
  );

  // MCP: get_bip answers exactly what the API does.
  const t = await tool(n);
  check(!t.error, `get_bip ${n} answers`);
  const { edition: _e, ...fromApi } = a;
  const { edition: _m, ...fromTool } = t.data;
  check(
    JSON.stringify(fromTool) === JSON.stringify(fromApi),
    `get_bip ${n} returns the API's data (${a.bip.cited_by.length} claims, ${a.implementations.length} code, ${a.changes.length} changes)`,
  );
}

console.log(`\nBIP ${UNKNOWN} (not in the index)`);
const missing = await get(`/proposals/${UNKNOWN}`);
check(missing.res.status === 404, `/proposals/${UNKNOWN} answers 404`);
const missingApi = await get(`/api/v1/bips/${UNKNOWN}`);
check(
  missingApi.res.status === 404 && "error" in JSON.parse(missingApi.text),
  `/api/v1/bips/${UNKNOWN} answers 404: ${missingApi.text.trim()}`,
);
const padded = await get("/proposals/0341");
check(padded.res.status === 404, "/proposals/0341 answers 404: one address per BIP");
const t = await tool(UNKNOWN);
const said = (t.r.content as { type: string; text: string }[])[0]?.text ?? "";
check(t.error, `get_bip ${UNKNOWN} is a tool error: ${said}`);

console.log("\nLinks in");
const redirect = await get(`/bips/${NUMBERS[0]}`, { redirect: "manual" });
check(
  redirect.res.status === 308 &&
    new URL(redirect.res.headers.get("location") ?? "", base).pathname === `/proposals/${NUMBERS[0]}`,
  `/bips/${NUMBERS[0]} redirects (308) to /proposals/${NUMBERS[0]}`,
);
for (const p of ["/proposals", "/bips"]) {
  const r = await get(p);
  check(r.text.includes(`href="/proposals/${NUMBERS[0]}"`), `${p} links /proposals/${NUMBERS[0]}`);
}
const first = (JSON.parse((await get(`/api/v1/bips/${NUMBERS[0]}`)).text) as BipAnswer).bip
  .cited_by[0];
if (first) {
  const r = await get(`/claims/${first.id}`);
  check(
    r.text.includes(`href="/proposals/${NUMBERS[0]}"`),
    `the claim page /claims/${first.id} links its BIP source to /proposals/${NUMBERS[0]}`,
  );
}
const sitemap = await get("/sitemap.xml");
const listed = count(sitemap.text, "/proposals/");
const all = (JSON.parse((await get("/api/v1/bips")).text) as { index: { bips: unknown[] } }).index
  .bips.length;
check(listed === all, `the sitemap lists a page for each of the ${all} BIPs (${listed})`);
await client.close();
console.log("\nbipcheck: all checks passed");
