// Drives "At head" against a running site and proves the brain's reading again from GitHub itself:
// every claim's at_head in the export must point at a source the claim cites at that index, pinned
// at the commit its URL names; each passage marked changed must be missing from the file at the
// head recorded, each marked gone must be a 404 there, and a sample marked current must still hold
// the quote, all read fresh from raw.githubusercontent.com. Then the surfaces: a moved claim's page
// carries the callout, the Moved on line and GitHub's comparison; a claim with nothing moved has
// neither; its page as of a past block shows no reading; GET /api/v1/claims/<id> and the get_claim
// tool answer the same at_head; /gaps lists every moved passage and counts them, and the gap map
// research plans from carries those no research run on their topic has had yet.
//
//   node .claude/skills/verify/atheadcheck.ts [base]
//     base defaults to http://localhost:3721
//
// Every request carries the check header, so the site's reach counts never count it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { findQuote, stripInvisible } from "../../../brain/src/text.ts";

const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const CHECK = { "X-Blocklore-Check": "1" };
const SAMPLE = 8;

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`atheadcheck FAILED: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: CHECK });
  return { res, text: (await res.text()).replaceAll("<!-- -->", "") };
}

interface AtHeadOf {
  source: number;
  repo: string;
  path: string;
  pinned: string;
  branch: string;
  head: string;
  state: "current" | "changed" | "gone";
  since: { time: string; height: number };
  read: { time: string; height: number };
}
interface Claim {
  id: string;
  status: string;
  first_seen: { time: string; height: number };
  sources: { url?: string; quote?: string }[];
  at_head: AtHeadOf[];
}

const raw = async (a: AtHeadOf) => {
  const r = await fetch(`https://raw.githubusercontent.com/${a.repo}/${a.head}/${a.path}`);
  return { status: r.status, text: r.ok ? stripInvisible(await r.text()) : "" };
};

console.log("The reading in the export");
const exp = await get("/exports/claims.jsonl");
check(exp.res.status === 200, "/exports/claims.jsonl answers 200");
const claims = exp.text
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Claim);
const all = claims.flatMap((c) => c.at_head.map((a) => ({ c, a })));
check(all.length > 0, `the export carries ${all.length} passages read at head`);
const heads = new Set(all.map(({ a }) => `${a.repo}@${a.head}`));
for (const { c, a } of all) {
  const url = c.sources[a.source]?.url ?? "";
  if (!url.startsWith(`https://github.com/${a.repo}/blob/${a.pinned}/`) || !/^[0-9a-f]{40}$/.test(a.head))
    check(false, `${c.id} source ${a.source + 1} is a pinned ${a.repo} link at ${a.pinned}`);
}
check(true, `each names a source its claim cites, pinned at the commit its URL names (${heads.size} heads)`);
check(
  claims.filter((c) => c.status === "withdrawn").every((c) => c.at_head.length === 0),
  "a withdrawn claim carries no reading",
);

console.log("\nThe reading again, from GitHub");
const moved = all.filter(({ a }) => a.state !== "current");
for (const { c, a } of moved) {
  const r = await raw(a);
  const quote = c.sources[a.source]?.quote ?? "";
  if (a.state === "gone") check(r.status === 404, `${c.id} source ${a.source + 1}: ${a.path} is gone at ${a.head.slice(0, 10)}`);
  else
    check(
      r.status === 200 && !findQuote(r.text, quote).found,
      `${c.id} source ${a.source + 1}: ${a.path} at ${a.head.slice(0, 10)} no longer has the passage`,
    );
}
const current = all.filter(({ a }) => a.state === "current");
const step = Math.max(1, Math.floor(current.length / SAMPLE));
for (const { c, a } of current.filter((_, i) => i % step === 0).slice(0, SAMPLE)) {
  const r = await raw(a);
  check(
    r.status === 200 && findQuote(r.text, c.sources[a.source]?.quote ?? "").found,
    `${c.id} source ${a.source + 1}: ${a.path} at ${a.head.slice(0, 10)} still has the passage`,
  );
}

console.log("\nThe claim pages");
const movedClaims = [...new Set(moved.map(({ c }) => c.id))];
for (const id of movedClaims.slice(0, 3)) {
  const page = await get(`/claims/${id}`);
  const n = moved.filter(({ c }) => c.id === id).length;
  check(page.text.includes('class="callout callout-info block" role="note"'), `/claims/${id} has the callout`);
  check(
    (page.text.match(/>Moved on</g) ?? []).length === n,
    `/claims/${id} marks ${n} source${n === 1 ? "" : "s"} Moved on`,
  );
  const a = moved.find(({ c }) => c.id === id)?.a as AtHeadOf;
  check(
    page.text.includes(`https://github.com/${a.repo}/compare/${a.pinned}...${a.head}`),
    `/claims/${id} links GitHub's comparison of ${a.pinned.slice(0, 10)} with ${a.head.slice(0, 10)}`,
  );
}
const still = claims.find((c) => c.at_head.length > 0 && c.at_head.every((a) => a.state === "current"));
if (still) {
  const page = await get(`/claims/${still.id}`);
  check(
    !page.text.includes(">Moved on<") && (page.text.match(/class="source-at-head"/g) ?? []).length === still.at_head.length,
    `/claims/${still.id} says each of its ${still.at_head.length} passages is still at head, and nothing moved`,
  );
  const h = still.first_seen.height;
  const then = await get(`/claims/${still.id}/at/${h}`);
  check(
    then.res.status === 200 && !then.text.includes("source-at-head"),
    `/claims/${still.id} as of block ${h} shows no reading at head`,
  );
}

console.log("\nThe API and the MCP tool");
const id = movedClaims[0] ?? still?.id;
if (id) {
  const api = JSON.parse((await get(`/api/v1/claims/${id}`)).text) as { claim: Claim };
  const fromExport = claims.find((c) => c.id === id)?.at_head;
  check(JSON.stringify(api.claim.at_head) === JSON.stringify(fromExport), `GET /api/v1/claims/${id} answers the export's at_head`);
  const client = new Client({ name: "blocklore-atheadcheck", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: CHECK } }),
  );
  const r = await client.callTool({ name: "get_claim", arguments: { id } });
  const data = r.structuredContent as { claim: Claim };
  check(JSON.stringify(data.claim.at_head) === JSON.stringify(fromExport), `get_claim ${id} answers the same at_head`);
  await client.close();
}

console.log("\nThe gaps page");
const gaps = await get("/gaps");
const block = gaps.text.slice(gaps.text.indexOf('id="moved"'), gaps.text.indexOf('id="advisories"'));
check(block.length > 0, "/gaps has the Sources that moved on block");
check(
  moved.every(({ c }) => block.includes(`href="/claims/${c.id}#evidence"`)) &&
    (block.match(/class="row-item"/g) ?? []).length === moved.length,
  `/gaps lists the ${moved.length} moved passages`,
);
const api = JSON.parse((await get("/api/v1/gaps")).text) as {
  gaps: { topics: { slug: string; moved: { claim: string; source: number }[] }[] };
};
const key = (claim: string, source: number) => `${claim}#${source}`;
const fromGaps = api.gaps.topics.flatMap((t) => t.moved.map((m) => key(m.claim, m.source)));
const movedKeys = new Set(moved.map(({ c, a }) => key(c.id, a.source)));
const waiting = (block.match(/Waiting for research on its topic\./g) ?? []).length;
check(
  fromGaps.every((k) => movedKeys.has(k)) && fromGaps.length === waiting,
  `GET /api/v1/gaps carries the ${fromGaps.length} moved passages /gaps shows waiting for research, and no other`,
);
console.log("\natheadcheck: all checks passed");
