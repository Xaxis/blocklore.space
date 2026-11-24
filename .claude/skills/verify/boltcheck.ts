// Drives the BOLT index, each BOLT's page, its API answer and the MCP tool against a running site,
// prints what each shows, and fails on the first disagreement: /bolts must list every BOLT the API
// lists, each with its page; a page and GET /api/v1/bolts/<n> must hold the same title, claims, code
// and history; the bolts tool must answer exactly what the API does; every claim must cite the BOLT's
// file; the recorded SHA-256 must be that of the BOLT's text at the pinned commit, as GitHub serves
// it; BOLT #0 at that commit must list each title as the index gives it; a BOLT nothing cites must
// say so; an unknown or zero-padded number must be a 404 and a tool error. Then the links in: the
// bar, a claim's BOLT source, the sitemap.
//
//   node .claude/skills/verify/boltcheck.ts [base]
//     base defaults to http://localhost:3721
//
// Every request carries the check header, so the site's reach counts never count it.
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const CHECK = { "X-Blocklore-Check": "1" };

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`boltcheck FAILED: ${what}`);
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
const block = (page: string, id: string) => {
  const at = page.indexOf(`<section class="block" id="${id}"`);
  if (at < 0) return null;
  const end = page.indexOf('<section class="block"', at + 10);
  return page.slice(at, end < 0 ? undefined : end);
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

type Entry = { n: number; title: string; file: string; hash: string; url: string };
type Index = { commit: string; read: { height: number }; bolts: (Entry & { page: string; cited_by: string[] })[] };
type Answer = {
  url: string;
  commit: string;
  index: string;
  bolt: Entry & { cited_by: { id: string; status: string; marks: string[] }[] };
  changes: { n: number; field: string; before?: string; after?: string; commit: string }[];
  topics: { slug: string; title: string | null; depths: { depth: string; claims: string[] }[] }[];
  implementations: { title: string; url: string; claims: string[] }[];
};

const raw = async (commit: string, file: string) => {
  const r = await fetch(`https://raw.githubusercontent.com/lightning/bolts/${commit}/${file}`);
  check(r.ok, `GitHub serves ${file} at ${commit.slice(0, 10)}`);
  return r.text();
};

const client = new Client({ name: "blocklore-boltcheck", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: CHECK } }),
);
async function tool(args: Record<string, unknown>) {
  const r = await client.callTool({ name: "bolts", arguments: args });
  return { error: r.isError === true, data: r.structuredContent as Record<string, unknown>, r };
}

console.log("The index");
const indexAnswer = await get("/api/v1/bolts");
check(indexAnswer.res.status === 200, "/api/v1/bolts answers 200");
const idx = (JSON.parse(indexAnswer.text) as { index: Index }).index;
check(idx && idx.bolts.length > 0, `the API lists ${idx.bolts.length} BOLTs at ${idx.commit.slice(0, 10)}`);
const intro = await raw(idx.commit, "00-introduction.md");
const listing = await get("/bolts");
check(listing.res.status === 200, "/bolts answers 200");
const lh = html(listing.text);
check(count(lh, "<tr>") === idx.bolts.length + 1, `/bolts has a row per BOLT (${count(lh, "<tr>") - 1})`);
const whole = await tool({});
check(!whole.error, "bolts with no number answers");
const { edition: _we, url: _wu, ...wholeData } = whole.data;
check(
  JSON.stringify(wholeData) === JSON.stringify(idx),
  "bolts with no number returns the API's index",
);

for (const e of idx.bolts) {
  console.log(`\nBOLT ${e.n}, ${e.title}`);
  // The index's own words, and the text's hash, from GitHub at the pinned commit.
  const line = e.n === 0 ? `# BOLT #0: ${e.title}` : `[BOLT #${e.n}](${e.file}): ${e.title}`;
  check(intro.includes(line), `BOLT #0 at the commit says "${line}"`);
  const body = e.n === 0 ? intro : await raw(idx.commit, e.file);
  const sum = createHash("sha256").update(body).digest("hex");
  check(sum === e.hash, `the recorded SHA-256 is the text's (${e.hash.slice(0, 12)})`);
  check(lh.includes(`href="/bolts/${e.n}"`), `/bolts links /bolts/${e.n}`);

  const page = await get(`/bolts/${e.n}`);
  check(page.res.status === 200, `/bolts/${e.n} answers 200`);
  const h = html(page.text);
  const api = await get(`/api/v1/bolts/${e.n}`);
  check(api.res.status === 200, `/api/v1/bolts/${e.n} answers 200`);
  const a = JSON.parse(api.text) as Answer & { edition: unknown };
  const h1 = text(/<h1>([\s\S]*?)<\/h1>/.exec(h)?.[1] ?? "");
  check(h1 === `BOLT ${e.n}, ${e.title}`, `the page's title is the index's: "${h1}"`);
  check(h.includes(`href="${a.bolt.url}"`), "the page links the BOLT's text at the commit");
  check(a.bolt.url === e.url && a.bolt.hash === e.hash, "the answer's entry is the index's");

  const claims = block(h, "claims") ?? "";
  const onPage = count(claims, '<div class="claim" ');
  const grouped = a.topics.flatMap((t) => t.depths.flatMap((d) => d.claims));
  check(
    onPage === a.bolt.cited_by.length && grouped.length === onPage && onPage === e.cited_by.length,
    `${onPage} claims on the page, ${a.bolt.cited_by.length} in the answer, ${e.cited_by.length} in the index`,
  );
  for (const c of a.bolt.cited_by) {
    const full = JSON.parse((await get(`/api/v1/claims/${c.id}`)).text) as {
      claim: { sources: { url?: string }[] };
    };
    const cites = full.claim.sources.some((s) =>
      new RegExp(`^https://github\\.com/lightning/bolts/(blob|tree)/[^/]+/${e.file.replace(".", "\\.")}`).test(s.url ?? ""),
    );
    if (!cites || !claims.includes(`id="${c.id}"`)) check(false, `${c.id} cites ${e.file} and is on the page`);
  }
  check(true, `every one of the ${a.bolt.cited_by.length} claims cites ${e.file} and is on the page`);
  check(
    a.bolt.cited_by.filter((c) => c.status === "contested").every((c) => c.marks.length > 0),
    "contested claims carry marks",
  );
  if (!a.bolt.cited_by.length)
    check(
      claims.includes("Blocklore has no claims citing this BOLT yet.") && claims.includes('href="/gaps#suggest-block"'),
      'no claim cites it: the page says so and links /gaps',
    );
  const ids = new Set(a.bolt.cited_by.map((c) => c.id));
  check(
    a.implementations.every((i) => i.claims.length > 0 && i.claims.every((id) => ids.has(id))),
    `${a.implementations.length} lines of code, each from claims citing it`,
  );
  const code = block(h, "code");
  check((code === null ? 0 : count(code, "<li")) === a.implementations.length, "the page shows the same code");
  const history = block(h, "history") ?? "";
  check(
    a.changes.length
      ? count(history, "<li>") === a.changes.length
      : history.includes("Blocklore has seen no change to this BOLT"),
    `${a.changes.length} recorded changes on the page and in the answer`,
  );
  const blocks = [...h.matchAll(/<section class="block" id="([^"]+)"/g)].map((m) => m[1]);
  check(
    blocks.every((b) => ["claims", "code", "history"].includes(b as string)),
    `the page's parts: ${blocks.join(", ")}`,
  );
  const t = await tool({ number: e.n });
  const { edition: _e, ...fromApi } = a;
  const { edition: _m, license: _l, ...fromTool } = t.data;
  check(
    !t.error && JSON.stringify(fromTool) === JSON.stringify(fromApi),
    `bolts ${e.n} returns the API's data (${a.bolt.cited_by.length} claims, ${a.implementations.length} code, ${a.changes.length} changes)`,
  );
}

console.log("\nNumbers the index does not list");
for (const p of ["/bolts/6", "/bolts/02", "/bolts/abc"])
  check((await get(p)).res.status === 404, `${p} answers 404`);
const six = await get("/api/v1/bolts/6");
check(six.res.status === 404 && "error" in JSON.parse(six.text), `/api/v1/bolts/6 answers 404: ${six.text.trim()}`);
const t6 = await tool({ number: 6 });
check(t6.error, `bolts 6 is a tool error: ${(t6.r.content as { text: string }[])[0]?.text ?? ""}`);

console.log("\nLinks in");
const home = await get("/topics");
check(html(home.text).includes('href="/bolts"'), "the bar links /bolts");
const cited = idx.bolts.find((b) => b.cited_by.length > 0);
if (cited) {
  const r = await get(`/claims/${cited.cited_by[0]}`);
  check(
    r.text.includes(`href="/bolts/${cited.n}"`),
    `the claim page /claims/${cited.cited_by[0]} links its BOLT source to /bolts/${cited.n}`,
  );
}
const sitemap = await get("/sitemap.xml");
check(count(sitemap.text, "/bolts/") === idx.bolts.length, `the sitemap lists a page per BOLT (${count(sitemap.text, "/bolts/")})`);
await client.close();
console.log("\nboltcheck: all checks passed");
