// Compares a mirror of Blocklore with the origin (MIRROR.md) and says whether it serves the same
// store: the edition, every sealed snapshot byte for byte, a sample of claims by hash (each
// rehashed from its own content), the JSON Lines export, /llms.txt and the MCP server's answer
// to initialize. One line per check: ok, behind (exactly what the origin served earlier), ahead
// (a mirror that follows main before the origin deploys) or differs. core/src/mirror.ts decides;
// this file only fetches.
//
//   pnpm mirror:check <mirror URL> [--origin URL] [--sample N] [--seed N]
//
// Exit 0 when every line is ok, 1 on any difference, 2 when the mirror is only behind or only
// ahead, 3 when the origin could not be read. Every request says it is a check
// (X-Blocklore-Check: 1), so neither site counts it as use. Only GET, and one POST of initialize.
import { execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import path from "node:path";
import {
  type BuildRelation,
  type CheckLine,
  claimsLine,
  compareClaim,
  compareExports,
  editionLine,
  exportClaims,
  exportLine,
  formatLine,
  type McpAnswer,
  mcpLine,
  mirrorPosition,
  mirrorVerdict,
  type Position,
  readEdition,
  readMcp,
  type Served,
  type ServedClaim,
  sampleIds,
  servedClaim,
  snapshotLines,
  textLine,
} from "@blocklore/core/mirror";
import { REACH_SKIP_HEADER } from "@blocklore/core/reach";

const ROOT = path.resolve(import.meta.dirname, "..");
const USAGE = "usage: pnpm mirror:check <mirror URL> [--origin URL] [--sample N] [--seed N]";

function args() {
  const a = process.argv.slice(2);
  const flag = (name: string) => {
    const i = a.indexOf(name);
    if (i < 0) return undefined;
    const v = a[i + 1];
    a.splice(i, 2);
    if (v === undefined) throw new Error(`${name} needs a value`);
    return v;
  };
  const origin = flag("--origin") ?? "https://blocklore.space";
  const sample = Number(flag("--sample") ?? 24);
  const seed = Number(flag("--seed") ?? randomInt(1, 2 ** 31));
  const [mirror, ...rest] = a;
  if (!mirror || rest.length || !Number.isInteger(sample) || !Number.isInteger(seed))
    throw new Error(USAGE);
  const base = (u: string) => {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${u}: not http`);
    return url.origin;
  };
  return { mirror: base(mirror), origin: base(origin), sample, seed };
}

let opts: ReturnType<typeof args>;
try {
  opts = args();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(3);
}

const HEADERS = { [REACH_SKIP_HEADER]: "1" };
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** One request; null for a 404, an Error for anything else that is not a 200. */
async function fetchOne(base: string, p: string, init: RequestInit = {}): Promise<Served | null> {
  const res = await fetch(`${base}${p}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string>) },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { sha256: sha256(bytes), text: new TextDecoder().decode(bytes) };
}

const why = (e: unknown) =>
  e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);

/** The origin must answer; when it does not, nothing can be compared. */
async function origin(p: string, init?: RequestInit): Promise<Served | null> {
  try {
    return await fetchOne(opts.origin, p, init);
  } catch (e) {
    console.error(`error   the origin ${opts.origin} did not answer ${p}: ${why(e)}`);
    process.exit(3);
  }
}

/** The mirror may fail; that is a difference, recorded by the caller. */
async function mirror(p: string, init?: RequestInit): Promise<Served | null | Error> {
  try {
    return await fetchOne(opts.mirror, p, init);
  } catch (e) {
    return new Error(why(e));
  }
}

const json = (s: Served | null | Error) =>
  s && !(s instanceof Error) ? (JSON.parse(s.text) as unknown) : null;
const missing = (p: string, s: null | Error) => (s ? s.message : `${p}: 404`);

/** Whether git knows `a` as an ancestor of `b`, in the clone this runs from. */
function relation(mirrorBuild: string, originBuild: string): BuildRelation {
  const commit = (b: string) => {
    if (!/^[0-9a-f]{7,40}$/.test(b)) return null;
    try {
      return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${b}^{commit}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  const m = commit(mirrorBuild);
  const o = commit(originBuild);
  if (!m || !o) return "unknown";
  const ancestor = (a: string, b: string) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: ROOT, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  return ancestor(m, o) ? "ancestor" : ancestor(o, m) ? "descendant" : "diverged";
}

/** Runs `f` over `items`, `n` at a time, in order. */
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i] as T);
      }
    }),
  );
  return out;
}

console.log(`mirror  ${opts.mirror}`);
console.log(`origin  ${opts.origin}`);
const lines: CheckLine[] = [];
const say = (l: CheckLine) => {
  lines.push(l);
  console.log(formatLine(l));
};

// 1. The editions, and where the mirror stands.
const oEd = readEdition(json(await origin("/api/v1")), json(await origin("/api/v1/snapshots")));
if ("error" in oEd) {
  console.error(`error   the origin: ${oEd.error}`);
  process.exit(3);
}
const mApi = await mirror("/api/v1");
const mSnaps = await mirror("/api/v1/snapshots");
const mEd =
  mApi && !(mApi instanceof Error) && mSnaps && !(mSnaps instanceof Error)
    ? readEdition(json(mApi), json(mSnaps))
    : {
        error: `did not answer (${missing("/api/v1", mApi instanceof Error ? mApi : (mSnaps as Error | null))})`,
      };
let position: Position = "differs";
if ("error" in mEd)
  say({ verdict: "differs", check: "edition", detail: `the mirror ${mEd.error}` });
else {
  const rel =
    mEd.edition.build === oEd.edition.build
      ? "unknown"
      : relation(mEd.edition.build, oEd.edition.build);
  position = mirrorPosition(oEd.edition, mEd.edition, rel);
  say(editionLine(oEd.edition, mEd.edition, position, rel));
}

// 2. Every sealed snapshot, byte for byte.
const editions = [...new Set([...oEd.editions, ...("error" in mEd ? [] : mEd.editions)])];
const oSnap = new Map<number, string | null>();
const mSnap = new Map<number, string | null>();
for (const n of editions) {
  const p = `/snapshots/${n}.json`;
  oSnap.set(n, (await origin(p))?.sha256 ?? null);
  const m = await mirror(p);
  mSnap.set(n, m && !(m instanceof Error) ? m.sha256 : null);
}
for (const l of snapshotLines(oSnap, mSnap, position)) say(l);

// 3. The export: every claim, rehashed from its content on both sides.
const oExport = await origin("/exports/claims.jsonl");
if (!oExport) {
  console.error("error   the origin serves no /exports/claims.jsonl");
  process.exit(3);
}
const mExport = await mirror("/exports/claims.jsonl");
let flagged: string[] = [];
if (!mExport || mExport instanceof Error)
  say({
    verdict: "differs",
    check: "exports/claims.jsonl",
    detail: `the mirror did not serve it (${missing("/exports/claims.jsonl", mExport)})`,
  });
else {
  say(exportLine(oExport, mExport, position));
  flagged = compareExports(exportClaims(oExport.text), exportClaims(mExport.text), position)
    .filter((r) => r.verdict !== "ok")
    .map((r) => r.id)
    .slice(0, 10);
}

// 4. A sample of claims from the API, one by one, plus any the export showed do not match.
const ids = [
  ...new Set([
    ...sampleIds([...exportClaims(oExport.text).keys()], opts.sample, opts.seed),
    ...flagged,
  ]),
].sort();
const claimOf = (s: Served | null): ServedClaim | null => {
  if (!s) return null;
  const body = JSON.parse(s.text) as { claim?: unknown };
  return servedClaim(body.claim);
};
const results = await pool(ids, 4, async (id) => {
  const p = `/api/v1/claims/${encodeURIComponent(id)}`;
  const o = claimOf(await origin(p));
  const m = await mirror(p);
  if (m instanceof Error) return { id, verdict: "differs" as const, why: m.message };
  return compareClaim(id, o, claimOf(m), position);
});
say(
  claimsLine(
    "api/v1/claims",
    `claims (seed ${opts.seed}${flagged.length ? `, with ${flagged.length} the export flagged` : ""})`,
    results,
  ),
);

// 5. /llms.txt, byte for byte.
const oLlms = await origin("/llms.txt");
const mLlms = await mirror("/llms.txt");
if (!oLlms) {
  console.error("error   the origin serves no /llms.txt");
  process.exit(3);
}
say(
  mLlms && !(mLlms instanceof Error)
    ? textLine("llms.txt", oLlms, mLlms, position)
    : {
        verdict: "differs",
        check: "llms.txt",
        detail: `the mirror did not serve it (${missing("/llms.txt", mLlms)})`,
      },
);

// 6. The MCP server answers initialize as the same build.
const INIT = {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "blocklore-mirror-check", version: "1" },
    },
  }),
};
const mcpOf = (s: Served | null | Error): McpAnswer => {
  if (!s || s instanceof Error) return { error: `no answer (${missing("/mcp", s)})` };
  try {
    return readMcp(JSON.parse(s.text));
  } catch {
    return { error: "not JSON" };
  }
};
say(mcpLine(mcpOf(await origin("/mcp", INIT)), mcpOf(await mirror("/mcp", INIT)), position));

const v = mirrorVerdict(lines);
const words = {
  ok: "serves the same store as",
  behind: "is behind",
  ahead: "is ahead of",
  differs: "differs from",
};
console.log(
  `${v.verdict.padEnd(7)} ${opts.mirror} ${words[v.verdict]} ${opts.origin} (${lines.length} checks)`,
);
process.exit(v.exit);
