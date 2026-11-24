// Drives /mcp as real clients do and fails on the first wrong answer:
//   - the official MCP SDK client (initialize-era, as Claude Code and most hosts connect today)
//     lists the tools and calls each one against the live store;
//   - raw stateless requests (revision 2026-07-28) discover the server and call a tool with the
//     mirrored headers, and a header that disagrees with the body is refused;
//   - a seed phrase is refused without being repeated.
//
//   node .claude/skills/verify/mcpcheck.ts [base]     base defaults to http://localhost:3721
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const url = `${base}/mcp`;
const SEED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`mcpcheck FAILED: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

type Structured = Record<string, unknown> & { edition?: { generated?: { height?: number } } };

const client = new Client({ name: "blocklore-mcpcheck", version: "1.0.0" });
// The check header keeps these calls out of the site's reach counts (core/src/reach.ts).
const CHECK = { "X-Blocklore-Check": "1" };
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: CHECK } }),
);
const info = client.getServerVersion();
check(info?.name === "blocklore", `SDK client connected; server ${info?.name} build ${info?.version}`);
check(client.getInstructions()?.includes("cite each claim by its url"), "instructions arrive");

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
check(
  names.join(",") ===
    "search_claims,get_claim,list_topics,get_topic,list_changes,get_bip,list_bips,signaling,get_signatures,threats,watches,debates,safety_desk",
  `thirteen tools in order: ${names.join(", ")}`,
);
check(
  tools.every((t) => t.annotations?.readOnlyHint === true),
  "every tool is marked read-only",
);

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  return { error: r.isError === true, data: r.structuredContent as Structured, content: r.content };
}

const search = await call("search_claims", { query: "taproot activation height", limit: 3 });
const hits = search.data.results as { id: string; url: string }[];
check(!search.error && hits.length > 0, `search_claims finds ${hits.map((h) => h.id).join(", ")}`);
check(
  typeof search.data.edition?.generated?.height === "number",
  "answers name their edition height",
);

const claim = await call("get_claim", { id: hits[0]?.id });
const c = claim.data.claim as { id: string; url: string; sources: { quote?: string }[] };
check(
  c.url.endsWith(`/claims/${c.id}`) && c.sources.length > 0,
  `get_claim gives ${c.id} with ${c.sources.length} sources`,
);

const missing = await call("get_claim", { id: "taproot.no-such-claim" });
check(missing.error, "an unknown claim id is a tool error");

const topics = await call("list_topics", {});
check((topics.data.topics as unknown[]).length >= 8, "list_topics lists the published topics");

const topic = await call("get_topic", { slug: "taproot" });
const sections = (topic.data.topic as { sections: unknown[] }).sections;
check(sections.length > 0, `get_topic taproot has ${sections.length} sections`);

const changes = await call("list_changes", { since_height: 0, limit: 5 });
check((changes.data.events as unknown[]).length === 5, "list_changes honors limit");

const bip = await call("get_bip", { number: 341 });
const b = bip.data.bip as { n: number; title: string; cited_by: unknown[] };
check(
  b.n === 341 && b.cited_by.length > 0,
  `get_bip 341 "${b.title}", cited by ${b.cited_by.length}`,
);

const deployed = await call("list_bips", { status: "Deployed" });
check((deployed.data.bips as unknown[]).length >= 50, "list_bips filters by status");

const bitsNow = await call("signaling", {});
const fromApi = (await (await fetch(`${base}/api/v1/signaling`, { headers: CHECK })).json()) as {
  signaling: { tip: { height: number } } | null;
};
check(
  fromApi.signaling
    ? !bitsNow.error && JSON.stringify(bitsNow.data.signaling) === JSON.stringify(fromApi.signaling)
    : bitsNow.error,
  fromApi.signaling
    ? `signaling gives the API's version bits, as of block ${fromApi.signaling.tip.height}`
    : "signaling is a tool error before the brain has counted a period",
);

const sigs = await call("get_signatures", {});
const eds = sigs.data.editions as { n: number; signature: { ok: boolean } | null }[];
check(
  !sigs.error && typeof sigs.data.means === "string" && eds.length > 0,
  `get_signatures covers ${eds.length} editions, ${eds.filter((e) => e.signature?.ok).length} signed`,
);
const noSuch = await call("get_signatures", { snapshot: 999999 });
check(noSuch.error, "an unknown snapshot is a tool error");
const map = await call("threats", {});
const listed = map.data.threats as { id: string; status: string }[];
check(!map.error && listed.length >= 30, `threats lists ${listed.length} threats`);
const open = await call("threats", { status: "open" });
check(
  (open.data.threats as { status: string }[]).every((x) => x.status === "open"),
  "threats filters by live status",
);
const warp = await call("threats", { id: "time-warp" });
const w = warp.data.threat as { url: string; claims: { url: string }[]; mitigations: unknown[] };
check(
  w.url.endsWith("/security/time-warp") && w.claims.length > 0 && w.mitigations.length > 0,
  `threats time-warp gives ${w.claims.length} claims and ${w.mitigations.length} mitigations`,
);
check((await call("threats", { id: "no-such-threat" })).error, "an unknown threat is a tool error");
// Advisories filed under threats (BACKLOG 36) and the record's CVE ids against NVD (38).
const known = map.data.advisories as { advisories: number; matched: number; to_map: unknown[] };
check(
  known.advisories > 0 && known.matched + known.to_map.length === known.advisories,
  `threats counts ${known.advisories} advisories: ${known.matched} filed, ${known.to_map.length} to map`,
);
const dos = (await call("threats", { id: "peer-dos" })).data.threat as {
  advisories: { title: string; filed_by: { rule: string; matched: string[]; by_words: boolean } }[];
  nvd: { id: string; state: string; finding: string | null }[];
};
check(
  dos.advisories.length > 0 &&
    dos.advisories.every((a) => a.filed_by.matched.length > 0) &&
    dos.advisories.some((a) => a.filed_by.rule === "record"),
  `threats peer-dos gives ${dos.advisories.length} advisories, each with its rule (${[...new Set(dos.advisories.map((a) => a.filed_by.rule))].join(", ")}) and what matched`,
);
check(
  dos.nvd.length > 0 && dos.nvd.every((c) => /^CVE-/.test(c.id) && c.state),
  `threats peer-dos checks ${dos.nvd.length} CVE ids against NVD (${dos.nvd.map((c) => `${c.id} ${c.state}${c.finding ? ` ${c.finding}` : ""}`).join(", ")})`,
);
// The Safety Desk (BACKLOG 23): each threat model with its threats, as /safety shows them.
const desk = await call("safety_desk", {});
const models = desk.data.models as {
  id: string;
  threats: { id: string; url: string; being_researched: string[] }[];
}[];
check(
  !desk.error &&
    models.map((m) => m.id).join(",") === "what-you-hold,who-knows,where-you-are,scams" &&
    models.every(
      (m) => m.threats.length > 0 && m.threats.every((t) => t.url.endsWith(`/security/${t.id}`)),
    ),
  `safety_desk gives ${models.length} threat models with ${models.reduce((n, m) => n + m.threats.length, 0)} threats`,
);
const scams = (await call("safety_desk", { model: "scams" })).data.models as { id: string }[];
check(scams.length === 1 && scams[0]?.id === "scams", "safety_desk gives one threat model when asked");
const readings = await call("watches", {});
check(!readings.error && Array.isArray(readings.data.watches), "watches answers with readings");
// The lab per release (BACKLOG 40): Bitcoin Core's maintained majors newest first, then LND's
// newest, each run named with its project, in watches and on a threat.
const lab = readings.data.lab as { project: string; version: string; passed: number; run: number }[];
const core = lab.filter((r) => r.project === "bitcoin-core");
const lnd = lab.filter((r) => r.project === "lnd");
check(
  Array.isArray(lab) &&
    core.length > 0 &&
    core.length + lnd.length === lab.length &&
    lab.findIndex((r) => r.project === "lnd") !== 0 &&
    core.every((r, i) => i === 0 || Number(r.version.split(".")[0]) < Number(core[i - 1]?.version.split(".")[0])),
  `watches carries the lab on ${lab.map((r) => `${r.project} ${r.version} (${r.passed} of ${r.run})`).join(", ")}`,
);
type ThreatLab = {
  lab: { name: string; project: string; releases: { version: string; ok: boolean | null }[] }[];
};
const versions = (runs: { version: string }[]) => runs.map((r) => r.version).join();
const origin = (await call("threats", { id: "transaction-origin" })).data.threat as ThreatLab;
check(
  origin.lab.length > 0 &&
    origin.lab.every((t) => t.project === "bitcoin-core" && versions(t.releases) === versions(core)),
  `threats transaction-origin gives each of its ${origin.lab.length} lab tests on Bitcoin Core's ${core.length} releases`,
);
// An LND package is tested on LND's release only, and says it is LND's.
const oldState = (await call("threats", { id: "old-state" })).data.threat as ThreatLab;
check(
  oldState.lab.length > 0 &&
    oldState.lab.every(
      (t) => t.name.startsWith("lnd/") && t.project === "lnd" && versions(t.releases) === versions(lnd),
    ),
  `threats old-state gives its ${oldState.lab.length} LND packages on LND's ${lnd.length} release${lnd.length === 1 ? "" : "s"} (${oldState.lab.map((t) => `${t.name} ${t.releases.map((r) => r.ok).join()}`).join(", ")})`,
);

// Debate maps (BACKLOG 24): the list, each listed map in full, and an unknown slug as an error.
// The list may be empty: a map publishes only once every claim in it has passed the evaluator.
const maps = await call("debates", {});
const briefs = maps.data.debates as { slug: string; claims: number }[];
check(!maps.error && Array.isArray(briefs), `debates lists ${briefs.length} maps`);
for (const b of briefs) {
  const one = (await call("debates", { slug: b.slug })).data.debate as {
    positions: { claims: { id: string; holders: unknown[] }[] }[];
    shared: { empirical: unknown[]; definitional: unknown[] };
  };
  const values = one.positions.flatMap((p) => p.claims);
  check(
    one.positions.length >= 2 &&
      one.positions.every((p) => p.claims.length > 0) &&
      values.every((v) => v.holders.length > 0) &&
      values.length + one.shared.empirical.length + one.shared.definitional.length === b.claims,
    `debates ${b.slug} gives ${one.positions.length} positions, each with attributed claims`,
  );
}
check((await call("debates", { slug: "no-such-map" })).error, "an unknown debate map is a tool error");

const seed = await call("search_claims", { query: SEED });
const seedText = JSON.stringify(seed.content);
check(
  seed.error && seedText.includes("seed phrase") && !seedText.includes("abandon"),
  "a seed phrase is refused and not repeated",
);
await client.close();

// The stateless revision: version and identity on every request, mirrored into headers.
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "blocklore-mcpcheck", version: "1.0.0" },
};
async function modern(method: string, params: Record<string, unknown>, name?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...CHECK,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
  });
  return {
    status: res.status,
    session: res.headers.get("mcp-session-id"),
    body: (await res.json()) as { result?: Record<string, unknown>; error?: { code: number } },
  };
}

const d = await modern("server/discover", {});
check(
  d.status === 200 && (d.body.result?.supportedVersions as string[]).includes("2026-07-28"),
  "server/discover lists 2026-07-28",
);
const t = await modern(
  "tools/call",
  { name: "get_bip", arguments: { number: 341 } },
  "get_bip",
);
check(
  t.status === 200 && t.body.result?.resultType === "complete" && t.session === null,
  "a stateless tools/call completes with no session",
);
const mismatch = await modern(
  "tools/call",
  { name: "get_bip", arguments: { number: 341 } },
  "get_claim",
);
check(
  mismatch.status === 400 && mismatch.body.error?.code === -32020,
  "an Mcp-Name that disagrees with the body is refused",
);
const get = await fetch(url, { headers: CHECK });
check(get.status === 405, "GET answers 405");
console.log(`mcpcheck passed against ${url}`);
