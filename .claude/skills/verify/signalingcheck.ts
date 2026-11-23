// Drives the version bits (BACKLOG 16) on a running site, prints what each surface shows, and fails
// on the first disagreement: GET /api/v1/signaling adds up and is served like the other answers
// (any origin, cached five minutes); /proposals' "Version bits this period" holds the API's
// numbers (heights, blocks so far of 2016, the block it is as of, a row per deployment bit any
// block set or "No block set a deployment bit", the BIP 320 count, the last period when known)
// and links BIP 9, BIP 320 and chainparams at the pinned commit; BIP 9's and BIP 320's pages show
// the same block, a BIP no chainparams deployment names shows none, and each BIP answer says so;
// /api/v1 and /llms.txt list it; the MCP tool signaling answers exactly the API's data; and no
// surface words a number as a forecast.
//
//   node .claude/skills/verify/signalingcheck.ts [base]     base defaults to http://localhost:3721
//
// Every request carries the check header, so the site's reach counts never count it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const CHECK = { "X-Blocklore-Check": "1" };

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`signalingcheck FAILED: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: CHECK });
  return { res, text: await res.text() };
}
const html = (t: string) => t.replaceAll("<!-- -->", "");
const words = (t: string) =>
  t
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
/** One block of a page by its id, up to the next block. */
const block = (page: string, id: string) => {
  const at = page.indexOf(`<section class="block" id="${id}"`);
  if (at < 0) return null;
  const end = page.indexOf('<section class="block"', at + 10);
  return page.slice(at, end < 0 ? undefined : end);
};
const n = (x: number) => x.toLocaleString("en-US");
const share = (c: number, of: number) => Math.round((1000 * c) / of) / 10;

type Tally = {
  start: number;
  end: number;
  through: number;
  blocks: number;
  prefixed: number;
  bits: number[];
  general: number;
  unprefixed: number;
};
type Answer = {
  url: string;
  period: number;
  tip: { height: number; hash: string; time: string };
  current: Tally;
  previous: Tally | null;
  rows: { bit: number; current: { blocks: number; share: number }; deployment: unknown }[];
  chainparams: { release: string; commit: string; deployments: { name: string; bit: number }[] };
};

console.log("GET /api/v1/signaling");
const api = await get("/api/v1/signaling");
check(api.res.status === 200, "answers 200");
check(api.res.headers.get("access-control-allow-origin") === "*", "allows any origin (CORS)");
check(
  /public, max-age=300/.test(api.res.headers.get("cache-control") ?? ""),
  `cached like the other answers: ${api.res.headers.get("cache-control")}`,
);
const body = JSON.parse(api.text) as { edition: { build: string }; signaling: Answer | null };
const s = body.signaling;
if (!s) {
  const page = html((await get("/proposals")).text);
  check(
    (block(page, "version-bits") ?? "").includes("The brain has not counted a period"),
    "no tally yet: /proposals says the brain has not counted a period",
  );
  console.log("\nsignalingcheck: passed (no tally in this build)");
  process.exit(0);
}
const c = s.current;
console.log(
  `    period ${c.start} to ${c.end}: ${c.blocks} of ${s.period} to block ${s.tip.height} (${s.tip.time}); prefixed ${c.prefixed}, bits ${c.bits.join(" ")}, BIP 320 ${c.general}, unprefixed ${c.unprefixed}; last period ${s.previous ? `${s.previous.start}, ${s.previous.blocks}` : "none"}`,
);
check(
  c.through === s.tip.height && c.blocks === c.through - c.start + 1 && c.start % 2016 === 0,
  "the tally runs from the period's first block to the tip",
);
check(c.prefixed + c.unprefixed === c.blocks, "prefixed and unprefixed add up to the blocks");
check(
  s.rows.map((r) => r.bit).join() ===
    c.bits
      .map((x, i) => [x + (s.previous?.bits[i] ?? 0), i])
      .filter(([x]) => (x ?? 0) > 0)
      .map(([, i]) => i)
      .join(),
  `a row per deployment bit any block set: [${s.rows.map((r) => r.bit).join(", ")}]`,
);
check(
  s.rows.every(
    (r) => r.current.share === share(r.current.blocks, c.blocks) && r.current.blocks === c.bits[r.bit],
  ),
  "each row's count and share match the tally",
);
check(
  s.rows.every(
    (r) =>
      (r.deployment === null) ===
      !s.chainparams.deployments.some((d) => d.bit === r.bit),
  ),
  "a row names a deployment only where chainparams defines one",
);
check(!/threshold|activat|lock.?in|forecast|project/i.test(api.text), "no forecast in the answer");

console.log("\n/proposals");
const page = html((await get("/proposals")).text);
const vb = block(page, "version-bits");
check(vb, "has the Version bits this period block");
const t = words(vb ?? "");
console.log(`    ${t.slice(0, 400)}`);
check(t.includes("Version bits this period"), "its heading");
check(t.includes(`As of block ${n(s.tip.height)}`), `as of block ${n(s.tip.height)}`);
check(
  t.includes(`Heights ${n(c.start)} to ${n(c.end)}, ${n(c.blocks)} of ${n(s.period)} blocks so far`),
  "the period's heights and blocks so far of 2016",
);
check(
  t.includes(`Counted ${n(c.blocks)} of ${n(s.period)}`),
  `the counted row: ${n(c.blocks)} of ${n(s.period)}`,
);
check(
  t.includes(`top bits 001 ${n(c.prefixed)} ${share(c.prefixed, c.blocks)}%`),
  "BIP 9's prefix count and share",
);
check(
  t.includes(`not a signal ${n(c.general)} ${share(c.general, c.blocks)}%`),
  "BIP 320's count and share, labelled not a signal",
);
check(
  t.includes(`reads as 0 ${n(c.unprefixed)} ${share(c.unprefixed, c.blocks)}%`),
  "versions without the prefix",
);
if (s.rows.length)
  for (const r of s.rows)
    check(
      t.includes(`Bit ${r.bit} ${n(r.current.blocks)} ${r.current.share}%`),
      `bit ${r.bit}: ${r.current.blocks} blocks, ${r.current.share}%`,
    );
else check(t.includes("No block set a deployment bit"), "No block set a deployment bit");
check(
  s.previous ? t.includes(`Last period from ${n(s.previous.start)}`) : !t.includes("Last period"),
  s.previous ? "the last period beside it" : "no last period column before one is followed",
);
check(
  (vb ?? "").includes('href="/proposals/9"') && (vb ?? "").includes('href="/proposals/320"'),
  "links BIP 9 and BIP 320",
);
check(
  (vb ?? "").includes(`/blob/${s.chainparams.commit}/src/kernel/chainparams.cpp`),
  `links chainparams.cpp at ${s.chainparams.release} (${s.chainparams.commit.slice(0, 10)})`,
);
check((vb ?? "").includes('href="/api/v1/signaling"'), "links the JSON");
check(!/threshold|will activate|lock.?in|forecast|projected|on track/i.test(t), "no forecast");

console.log("\nBIP pages");
for (const [num, shows] of [
  [9, true],
  [320, true],
  [341, false],
  [119, false],
] as const) {
  const p = html((await get(`/proposals/${num}`)).text);
  const b = block(p, "version-bits");
  const a = JSON.parse((await get(`/api/v1/bips/${num}`)).text) as {
    signaling: { scheme: boolean; deployments: unknown[] } | null;
  };
  check(
    shows
      ? b !== null && words(b).includes(`As of block ${n(s.tip.height)}`) && a.signaling?.scheme === true
      : b === null && a.signaling === null,
    `/proposals/${num} ${shows ? "shows the tally, and its answer points to it" : "shows none, and its answer says null"}`,
  );
}

console.log("\nIndexes");
const index = JSON.parse((await get("/api/v1")).text) as { endpoints: Record<string, string> };
check(index.endpoints.signaling?.endsWith("/api/v1/signaling"), "/api/v1 lists signaling");
check((await get("/llms.txt")).text.includes("/api/v1/signaling"), "/llms.txt lists it");

console.log("\nMCP");
const client = new Client({ name: "blocklore-signalingcheck", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: CHECK } }),
);
const r = await client.callTool({ name: "signaling", arguments: {} });
const data = r.structuredContent as { signaling: unknown };
check(r.isError !== true, "the signaling tool answers");
check(
  JSON.stringify(data.signaling) === JSON.stringify(s),
  `it returns the API's data (block ${s.tip.height}, ${s.rows.length} rows)`,
);
await client.close();
console.log("\nsignalingcheck: all checks passed");
