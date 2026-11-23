// The mirror check's judgement (MIRROR.md): given what the origin and a mirror each served, is the
// mirror the same, behind, ahead or different? Pure: tools/mirror-check.ts fetches, this decides.
//
// "Behind" is a claim about history, not a softer word for different: a mirror is behind only when
// what it serves is exactly what the origin served at an earlier point (an older store, an older
// commit, a claim at an earlier revision). Anything else that does not match is "differs".
import { z } from "zod";
import { canonicalJson, claimHash, sha256Hex } from "./hash.ts";
import { claimAtRevision } from "./replay.ts";
import { Claim, type Stamp } from "./schema.ts";

export type Verdict = "ok" | "behind" | "ahead" | "differs";

export interface CheckLine {
  verdict: Verdict;
  check: string;
  detail: string;
}

/** What one site says about its own edition: `/api/v1` and `/api/v1/snapshots`. */
export interface EditionView {
  /** The store's own latest moment (core/src/node/moment.ts): the same commit compiles to the same. */
  generated: Stamp;
  build: string;
  claims: number;
  /** The newest sealed edition; null before the first. */
  sealed: { n: number; root: string; count: number } | null;
}

const EditionJson = z.object({
  edition: z.object({
    generated: z.object({ time: z.string().min(1), height: z.number().int().nonnegative() }),
    build: z.string().min(1),
    claims: z.number().int().nonnegative(),
  }),
});
const SnapshotsJson = z.object({
  snapshots: z.array(
    z.object({
      n: z.number().int().positive(),
      root: z.string().regex(/^[0-9a-f]{64}$/),
      count: z.number().int().nonnegative(),
    }),
  ),
});

/**
 * A site's edition from its `/api/v1` and `/api/v1/snapshots` answers, with the number of every
 * edition it has sealed; an error when either is not what the API documents.
 */
export function readEdition(
  api: unknown,
  snapshots: unknown,
): { edition: EditionView; editions: number[] } | { error: string } {
  const a = EditionJson.safeParse(api);
  if (!a.success) return { error: "/api/v1 names no edition" };
  const s = SnapshotsJson.safeParse(snapshots);
  if (!s.success) return { error: "/api/v1/snapshots is not a list of snapshots" };
  const editions = s.data.snapshots.map((x) => x.n).sort((x, y) => x - y);
  const newest = s.data.snapshots.find((x) => x.n === editions[editions.length - 1]);
  const { generated, build, claims } = a.data.edition;
  return {
    edition: {
      generated: { time: generated.time, height: generated.height },
      build,
      claims,
      sealed: newest ? { n: newest.n, root: newest.root, count: newest.count } : null,
    },
    editions,
  };
}

/**
 * How the mirror's build relates to the origin's in git history, when the clone running the check
 * holds both commits: the mirror's is an ancestor (older), a descendant (newer), on another line
 * (diverged), or not known here.
 */
export type BuildRelation = "ancestor" | "descendant" | "diverged" | "unknown";

/** Where the mirror stands against the origin, judged from the two editions. */
export type Position = "same" | "behind" | "ahead" | "differs";

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Orders two stamps by time, then height: -1 when `a` is earlier. */
export function compareStamp(a: Stamp, b: Stamp): number {
  return a.time !== b.time ? (a.time < b.time ? -1 : 1) : sign(a.height - b.height);
}

/**
 * The mirror's position. One commit always compiles to one store moment and one list of sealed
 * editions, so a shared build with any other edition is a difference. Between different builds,
 * git history decides when it is known and must agree with the editions; otherwise the editions'
 * order does, and two different builds of the same edition cannot be told apart.
 */
export function mirrorPosition(o: EditionView, m: EditionView, relation: BuildRelation): Position {
  const store = compareStamp(m.generated, o.generated);
  const sealed = sign((m.sealed?.n ?? 0) - (o.sealed?.n ?? 0));
  if (m.build === o.build) return store === 0 && sealed === 0 ? "same" : "differs";
  const older = store <= 0 && sealed <= 0;
  const newer = store >= 0 && sealed >= 0;
  if (relation === "ancestor") return older ? "behind" : "differs";
  if (relation === "descendant") return newer ? "ahead" : "differs";
  if (relation === "diverged") return "differs";
  if (store === 0 && sealed === 0) return "differs";
  return older ? "behind" : newer ? "ahead" : "differs";
}

/** The verdict for content that does not match, from the mirror's position. */
const lag = (p: Position): Verdict => (p === "behind" || p === "ahead" ? p : "differs");

const short = (hex: string) => `${hex.slice(0, 12)}...`;
const block = (s: Stamp) => `block ${s.height.toLocaleString("en-US")} (${s.time})`;

function describeEdition(e: EditionView): string {
  const sealed = e.sealed
    ? `sealed edition ${e.sealed.n} (root ${short(e.sealed.root)})`
    : "no sealed edition";
  return `${e.claims} claims, store at ${block(e.generated)}, ${sealed}, build ${e.build}`;
}

export function editionLine(
  o: EditionView,
  m: EditionView,
  position: Position,
  relation: BuildRelation,
): CheckLine {
  const diffs: string[] = [];
  if (m.claims !== o.claims) diffs.push(`${m.claims} claims (origin ${o.claims})`);
  if (compareStamp(m.generated, o.generated) !== 0)
    diffs.push(`store at ${block(m.generated)} (origin ${block(o.generated)})`);
  if ((m.sealed?.n ?? 0) !== (o.sealed?.n ?? 0))
    diffs.push(`sealed edition ${m.sealed?.n ?? "none"} (origin ${o.sealed?.n ?? "none"})`);
  const sameEditionOtherRoot =
    m.sealed && o.sealed && m.sealed.n === o.sealed.n && m.sealed.root !== o.sealed.root;
  if (sameEditionOtherRoot)
    diffs.push(
      `sealed edition ${m.sealed?.n} has root ${short(m.sealed?.root ?? "")} (origin ${short(o.sealed?.root ?? "")})`,
    );
  if (m.build !== o.build) {
    const how =
      relation === "ancestor"
        ? ", an older commit"
        : relation === "descendant"
          ? ", a newer commit"
          : relation === "diverged"
            ? ", on another line of history"
            : m.build === "dev"
              ? ": the mirror names no commit (build it with BLOCKLORE_BUILD set, MIRROR.md)"
              : ", not known to this clone (git fetch, then check again)";
    diffs.push(`build ${m.build} (origin ${o.build}${how})`);
  }
  if (!diffs.length && position === "same")
    return { verdict: "ok", check: "edition", detail: describeEdition(m) };
  const verdict =
    sameEditionOtherRoot || (position === "same" && diffs.length) ? "differs" : lag(position);
  return { verdict, check: "edition", detail: diffs.join("; ") || describeEdition(m) };
}

/**
 * One line per sealed edition, from the SHA-256 of each snapshot file as each site served it (null
 * when it did not). A snapshot file is never rewritten, so two different files under one number
 * are a difference however far behind the mirror is.
 */
export function snapshotLines(
  origin: Map<number, string | null>,
  mirror: Map<number, string | null>,
  position: Position,
): CheckLine[] {
  const ns = [...new Set([...origin.keys(), ...mirror.keys()])].sort((a, b) => a - b);
  return ns.map((n) => {
    const check = `snapshots/${n}.json`;
    const o = origin.get(n) ?? null;
    const m = mirror.get(n) ?? null;
    if (o && m)
      return o === m
        ? { verdict: "ok", check, detail: `the same bytes (sha256 ${short(o)})` }
        : {
            verdict: "differs",
            check,
            detail: `different bytes: sha256 ${short(m)} (origin ${short(o)}); a sealed edition is never rewritten`,
          };
    if (o)
      return position === "behind"
        ? { verdict: "behind", check, detail: "sealed at the origin, not on the mirror yet" }
        : { verdict: "differs", check, detail: "the mirror does not serve it" };
    if (m)
      return position === "ahead"
        ? { verdict: "ahead", check, detail: "on the mirror, not sealed at the origin yet" }
        : { verdict: "differs", check, detail: "the mirror serves an edition the origin has not" };
    return { verdict: "differs", check, detail: "neither site serves it" };
  });
}

/**
 * A claim as a site served it. `hash` is the hash the site names (of the claim as stored, which
 * a reader cannot always recompute: `related` is served without links to claims not published).
 * So the content is compared as served: `content` digests the claim's own fields but
 * `last_verified`, and `says` also leaves out `related`, the links that change when another claim
 * publishes.
 */
export type ServedClaim =
  | {
      id: string;
      claim: Claim;
      hash: string | null;
      content: string;
      says: string;
      record: unknown;
    }
  | { id: string; error: string };

const CLAIM_KEYS = Object.keys(Claim.shape);

/** What a claim states and cites, as served: its own fields but `last_verified` and `related`. */
function says(c: Claim): string {
  const { last_verified: _l, related: _r, ...rest } = c;
  return sha256Hex(canonicalJson(rest));
}

/** Reads one claim record from the API or the export: the claim's own fields, parsed and digested. */
export function servedClaim(raw: unknown): ServedClaim {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id : "(no id)";
  const own = Object.fromEntries(CLAIM_KEYS.filter((k) => k in rec).map((k) => [k, rec[k]]));
  const p = Claim.safeParse(own);
  if (!p.success)
    return { id, error: `not a valid claim (${p.error.issues[0]?.path.join(".") || "record"})` };
  return {
    id,
    claim: p.data,
    hash: typeof rec.hash === "string" ? rec.hash : null,
    content: claimHash(p.data),
    says: says(p.data),
    record: raw,
  };
}

export interface ClaimResult {
  id: string;
  verdict: Verdict;
  why: string;
}

/**
 * One claim on both sites: the same when it names the same hash and serves the same content. A
 * mirror's claim is behind only when it says exactly what the origin's said at an earlier revision
 * (core/src/replay.ts rebuilds that from the revision log), and ahead only the other way round; a
 * claim that is missing, or whose links alone moved, follows the mirror's position.
 */
export function compareClaim(
  id: string,
  o: ServedClaim | null,
  m: ServedClaim | null,
  position: Position,
): ClaimResult {
  const r = (verdict: Verdict, why: string): ClaimResult => ({ id, verdict, why });
  if (m && "error" in m) return r("differs", `the mirror's record is ${m.error}`);
  if (o && "error" in o) return r("differs", `the origin's record is ${o.error}`);
  if (!o && !m) return r("ok", "on neither site");
  if (!m)
    return position === "behind"
      ? r("behind", "not on the mirror yet")
      : r("differs", "missing on the mirror");
  if (!o)
    return position === "ahead"
      ? r("ahead", "not at the origin yet")
      : r("differs", "on the mirror only");
  if (o.hash === m.hash && o.content === m.content) return r("ok", `hash ${short(m.hash ?? "")}`);
  const or = o.claim.revisions.length;
  const mr = m.claim.revisions.length;
  if (mr < or && says(claimAtRevision(o.claim, mr)) === m.says)
    return position === "behind"
      ? r("behind", `at revision ${mr} of the origin's ${or}`)
      : r("differs", `at revision ${mr} of the origin's ${or}, though the editions agree`);
  if (mr > or && says(claimAtRevision(m.claim, or)) === o.says)
    return position === "ahead"
      ? r("ahead", `at revision ${mr}, the origin at ${or}`)
      : r("differs", `at revision ${mr}, the origin at ${or}, though the editions agree`);
  if (mr === or && o.says === m.says)
    return r(
      lag(position),
      o.content === m.content
        ? `names hash ${short(m.hash ?? "none")} (origin ${short(o.hash ?? "none")}) for the same content`
        : "the same statement and sources, other related claims",
    );
  return r(
    "differs",
    `content ${short(m.content)} (origin ${short(o.content)}) at revision ${mr}${mr === or ? "" : ` (origin ${or})`}`,
  );
}

/** The verdict for many results: any difference, else behind or ahead (both at once is a difference). */
export function worst(verdicts: Verdict[]): Verdict {
  const set = new Set(verdicts);
  if (set.has("differs") || (set.has("behind") && set.has("ahead"))) return "differs";
  return set.has("behind") ? "behind" : set.has("ahead") ? "ahead" : "ok";
}

function listed(results: ClaimResult[], verdict: Verdict): string {
  const hit = results.filter((x) => x.verdict === verdict);
  const shown = hit
    .slice(0, 3)
    .map((x) => `${x.id} (${x.why})`)
    .join(", ");
  return `${hit.length} ${verdict}: ${shown}${hit.length > 3 ? `, and ${hit.length - 3} more` : ""}`;
}

/** One line for a set of claims compared one by one. */
export function claimsLine(check: string, what: string, results: ClaimResult[]): CheckLine {
  const verdict = worst(results.map((x) => x.verdict));
  if (verdict === "ok")
    return {
      verdict,
      check,
      detail: `${results.length} ${what}, each with the same hash and content on both`,
    };
  const parts = (["differs", "behind", "ahead"] as const)
    .filter((v) => results.some((x) => x.verdict === v))
    .map((v) => listed(results, v));
  return { verdict, check, detail: `${results.length} ${what}; ${parts.join("; ")}` };
}

/** A body as a site served it: the SHA-256 of its bytes and the text. */
export interface Served {
  sha256: string;
  text: string;
}

/** Each claim in an export, by id (blank lines skipped; an unreadable line is an error claim). */
export function exportClaims(text: string): Map<string, ServedClaim> {
  const out = new Map<string, ServedClaim>();
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      out.set(`(line ${i + 1})`, { id: `(line ${i + 1})`, error: "not JSON" });
      return;
    }
    const c = servedClaim(raw);
    out.set(c.id, c);
  });
  return out;
}

/** Every claim of two exports compared, in id order. */
export function compareExports(
  oc: Map<string, ServedClaim>,
  mc: Map<string, ServedClaim>,
  position: Position,
): ClaimResult[] {
  return [...new Set([...oc.keys(), ...mc.keys()])]
    .sort()
    .map((id) => compareClaim(id, oc.get(id) ?? null, mc.get(id) ?? null, position));
}

/** The first top-level field where two records differ, for a claim whose hash matches. */
function differingField(a: unknown, b: unknown): string | null {
  const ra = (a ?? {}) as Record<string, unknown>;
  const rb = (b ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
  return keys.find((k) => canonicalJson(ra[k] ?? null) !== canonicalJson(rb[k] ?? null)) ?? null;
}

/**
 * The export, `/exports/claims.jsonl`: the same bytes, or which claims differ and how. Every claim
 * is compared, so one changed byte in any claim names that claim.
 */
export function exportLine(o: Served, m: Served, position: Position): CheckLine {
  const check = "exports/claims.jsonl";
  const oc = exportClaims(o.text);
  const mc = exportClaims(m.text);
  const results = compareExports(oc, mc, position);
  if (o.sha256 === m.sha256)
    return {
      verdict: "ok",
      check,
      detail: `the same bytes (${results.length} claims, sha256 ${short(o.sha256)})`,
    };
  const line = claimsLine(check, "claims", results);
  if (line.verdict !== "ok") return line;
  // Every claim hashes alike, yet the bytes differ: a field outside the hash (last_verified, a
  // recheck, where it is shown), or the order.
  const field = [...mc.entries()].flatMap(([id, c]) => {
    const other = oc.get(id);
    if (!other || "error" in other || "error" in c) return [];
    const f = differingField(other.record, c.record);
    return f ? [`${id}.${f}`] : [];
  })[0];
  return {
    verdict: lag(position),
    check,
    detail: `every claim has the same hash, but the bytes differ (sha256 ${short(m.sha256)}, origin ${short(o.sha256)})${field ? `, first at ${field}` : ", in order or spacing"}`,
  };
}

/** Where two texts first differ: the line number and both lines, cut short. */
export function firstDifference(a: string, b: string): { line: number; a: string; b: string } {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++)
    if (al[i] !== bl[i])
      return { line: i + 1, a: (al[i] ?? "").slice(0, 80), b: (bl[i] ?? "").slice(0, 80) };
  return { line: 0, a: "", b: "" };
}

/** A text the sites should serve byte for byte, such as `/llms.txt`. */
export function textLine(check: string, o: Served, m: Served, position: Position): CheckLine {
  if (o.sha256 === m.sha256)
    return { verdict: "ok", check, detail: `the same bytes (sha256 ${short(o.sha256)})` };
  const d = firstDifference(o.text, m.text);
  return {
    verdict: lag(position),
    check,
    detail: `different bytes from line ${d.line}: ${JSON.stringify(d.b)} (origin ${JSON.stringify(d.a)})`,
  };
}

/** What `/mcp` answered to initialize: the JSON-RPC result, or why there was none. */
export type McpAnswer = { result: Record<string, unknown> } | { error: string };

/** A JSON-RPC answer to initialize, read at the edge. */
export function readMcp(body: unknown): McpAnswer {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.result && typeof b.result === "object")
    return { result: b.result as Record<string, unknown> };
  const e = b.error as { message?: unknown } | undefined;
  return { error: typeof e?.message === "string" ? `error: ${e.message}` : "no result" };
}

export function mcpLine(o: McpAnswer, m: McpAnswer, position: Position): CheckLine {
  const check = "mcp initialize";
  if ("error" in m) return { verdict: "differs", check, detail: `the mirror: ${m.error}` };
  if ("error" in o) return { verdict: "differs", check, detail: `the origin: ${o.error}` };
  const info = (r: Record<string, unknown>) => (r.serverInfo ?? {}) as Record<string, unknown>;
  const mi = info(m.result);
  const oi = info(o.result);
  const named = `${mi.name} ${mi.version}, protocol ${m.result.protocolVersion}`;
  if (canonicalJson(o.result) === canonicalJson(m.result))
    return { verdict: "ok", check, detail: `answers as ${named}` };
  const fields = [...new Set([...Object.keys(o.result), ...Object.keys(m.result)])]
    .sort()
    .filter((k) => canonicalJson(o.result[k] ?? null) !== canonicalJson(m.result[k] ?? null));
  const detail = `answers as ${named} (origin ${oi.name} ${oi.version}); ${fields.join(", ")} differ`;
  const versionOnly = mi.name === oi.name && mi.version !== oi.version;
  return { verdict: versionOnly ? lag(position) : "differs", check, detail };
}

/**
 * The run's verdict and exit code: 0 when every line is ok, 1 on any difference, 2 when the mirror
 * is only behind (or only ahead, as a mirror that follows main can be before the origin deploys).
 */
export function mirrorVerdict(lines: CheckLine[]): { verdict: Verdict; exit: number } {
  const verdict = worst(lines.map((l) => l.verdict));
  return { verdict, exit: verdict === "ok" ? 0 : verdict === "differs" ? 1 : 2 };
}

/** A line as the check prints it. */
export function formatLine(l: CheckLine): string {
  return `${l.verdict.padEnd(7)} ${l.check}: ${l.detail}`;
}

/** `n` distinct ids, the same for the same seed (a 32-bit xorshift), in id order. */
export function sampleIds(ids: string[], n: number, seed: number): string[] {
  const pool = [...new Set(ids)].sort();
  let x = seed >>> 0 || 1;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
  }
  return pool.slice(0, Math.max(0, n)).sort();
}
