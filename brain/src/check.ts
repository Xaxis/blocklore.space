// The deterministic half of verification (ARCHITECTURE.md, "Data flow of one claim", step 3): for
// each claim or candidate, its shape and style, every locator fetched and every quote found, every
// code and chain check run, and the published claims it most resembles. No model is involved.
import {
  bipFileCandidates,
  type Check,
  type Claim,
  type Issue,
  readerCommand,
  validateClaim,
} from "@blocklore/core";
import type { ChainSource } from "./chain.ts";
import { remoteHead } from "./env.ts";
import { get } from "./http.ts";
import { lineAnchor, resolveLocator } from "./resolve.ts";
import type { Candidate } from "./staging.ts";
import { findQuote, suspectedInjections } from "./text.ts";

export interface SourceResult {
  index: number;
  url?: string;
  read?: string;
  ok: boolean;
  quoteFound: boolean;
  closeness?: number;
  nearest?: string;
  foundAtLines?: number[];
  anchorNote?: string;
  removed?: { hiddenElements: number; comments: number; invisibleChars: number };
  injections: string[];
  error?: string;
  /** The readable text around the quote, for the verifier (at most 1,500 characters). */
  context?: string;
}

export interface CheckResult {
  index: number;
  type: Check["type"];
  ok: boolean;
  detail: string;
  command: string;
  backend: string;
}

export interface ClaimReport {
  id: string;
  ok: boolean;
  issues: Issue[];
  sources: SourceResult[];
  checks: CheckResult[];
  method: string;
}

/** A candidate dressed as a claim so the shared rules can run on it. */
export function provisional(c: Candidate | Claim): Claim {
  const at = { time: "2009-01-03T18:15:05Z", height: 0 };
  const { change: _c, note: _n, ...rest } = c as Candidate;
  return {
    ...(rest as Claim),
    first_seen: (c as Claim).first_seen ?? at,
    last_verified: (c as Claim).last_verified ?? {
      ...at,
      run: "provisional",
      method: "provisional",
    },
    run: (c as Claim).run ?? "provisional",
    revisions: (c as Claim).revisions ?? [{ rev: 1, at, run: "provisional", change: "created" }],
  };
}

async function checkSource(c: Claim, index: number): Promise<SourceResult> {
  const s = c.sources[index];
  if (!s) throw new Error("no such source");
  if (s.kind === "chain" && !s.url) return { index, ok: true, quoteFound: true, injections: [] };
  if (!s.url) return { index, ok: false, quoteFound: false, injections: [], error: "no url" };
  const r = await resolveLocator(s.url);
  if (!r.ok)
    return {
      index,
      url: s.url,
      read: r.read,
      ok: false,
      quoteFound: false,
      injections: [],
      error: r.error,
    };
  const injections = suspectedInjections(r.text);
  if (!s.quote) {
    const ok = s.kind === "chain";
    return { index, url: s.url, read: r.read, ok, quoteFound: ok, injections, removed: r.removed };
  }
  const m = findQuote(r.text, s.quote);
  const out: SourceResult = {
    index,
    url: s.url,
    read: r.read,
    ok: m.found,
    quoteFound: m.found,
    injections,
    removed: r.removed,
  };
  if (!m.found) {
    out.closeness = Math.round(m.closeness * 100) / 100;
    out.nearest = m.nearest;
    out.error = "quote not found at the locator";
    return out;
  }
  // Context for the verifier: the text around the quote.
  const flat = r.text.replace(/\s+/g, " ");
  const probe = s.quote.replace(/\s+/g, " ").slice(0, 40).toLowerCase();
  const at = flat.toLowerCase().indexOf(probe);
  out.context = at >= 0 ? flat.slice(Math.max(0, at - 600), at + 900) : flat.slice(0, 1500);
  if (r.lines) {
    const q = s.quote.trim().split("\n")[0]?.trim().toLowerCase() ?? "";
    out.foundAtLines = r.lines
      .flatMap((l, i) => (l.toLowerCase().includes(q) ? [i + 1] : []))
      .slice(0, 5);
    const anchor = lineAnchor(s.url);
    if (
      anchor &&
      out.foundAtLines.length > 0 &&
      !out.foundAtLines.some((n) => n >= anchor[0] - 3 && n <= anchor[1] + 3)
    )
      out.anchorNote = `quote is at line ${out.foundAtLines.join(", ")}, outside the anchor L${anchor[0]}-L${anchor[1]}`;
  }
  return out;
}

async function bipPreamble(bip: number, ref = "master"): Promise<Record<string, string> | null> {
  for (const f of bipFileCandidates(bip)) {
    const r = await get(`https://raw.githubusercontent.com/bitcoin/bips/${ref}/${f}`, {
      maxAge: 6 * 3600,
    });
    if (r.status !== 200) continue;
    const head = r.body.split("\n").slice(0, 40);
    const fields: Record<string, string> = {};
    let last = "";
    for (const line of head) {
      const m = /^\s*([A-Z][A-Za-z-]*):\s*(.*)$/.exec(line);
      if (m) {
        last = m[1] as string;
        fields[last] = (m[2] as string).trim();
      } else if (last && /^\s{4,}\S/.test(line)) {
        fields[last] = `${fields[last]}, ${line.trim()}`;
      } else if (/^(<\/pre>|```)/.test(line.trim()) && Object.keys(fields).length > 0) break;
    }
    if (fields.Author && !fields.Authors) fields.Authors = fields.Author;
    return fields;
  }
  return null;
}

const branches = new Map<string, string>();
function defaultBranch(repo: string): string {
  const known = branches.get(repo);
  if (known) return known;
  const b = remoteHead(repo).branch;
  branches.set(repo, b);
  return b;
}

export async function runCheck(
  chk: Check,
  index: number,
  chain: ChainSource,
): Promise<CheckResult> {
  const base = { index, type: chk.type, command: readerCommand(chk) };
  try {
    switch (chk.type) {
      case "chain.block-hash": {
        const h = await chain.blockHash(chk.height);
        return {
          ...base,
          ok: h === chk.expect,
          detail: `block ${chk.height} hash is ${h}`,
          backend: chain.name,
        };
      }
      case "chain.subsidy": {
        const s = await chain.subsidy(chk.height);
        return {
          ...base,
          ok: s.sats === chk.expect_sats,
          detail: `subsidy ${s.sats} sats (${s.method})`,
          backend: chain.name,
        };
      }
      case "chain.header": {
        const h = await chain.header(chk.height);
        const got = h[chk.field];
        const want = chk.expect;
        const ok =
          typeof want === "number"
            ? Number(got) === want
            : String(got).toLowerCase() === String(want).toLowerCase();
        return {
          ...base,
          ok,
          detail: `block ${chk.height} ${chk.field} is ${got}`,
          backend: chain.name,
        };
      }
      case "code.contains": {
        const at = async (ref: string) => {
          const r = await get(`https://raw.githubusercontent.com/${chk.repo}/${ref}/${chk.path}`, {
            maxAge: ref.length === 40 ? 365 * 86400 : 6 * 3600,
          });
          return r.status === 200 ? r.body.includes(chk.text) : null;
        };
        const pinned = await at(chk.ref);
        if (pinned === null)
          return {
            ...base,
            ok: false,
            detail: `${chk.path} not found at ${chk.ref}`,
            backend: "raw.githubusercontent.com",
          };
        if (!pinned)
          return {
            ...base,
            ok: false,
            detail: `text not in ${chk.path} at ${chk.ref.slice(0, 10)}`,
            backend: "raw.githubusercontent.com",
          };
        if (chk.live) {
          const branch = defaultBranch(chk.repo);
          const live = await at(branch);
          if (!live)
            return {
              ...base,
              ok: false,
              detail: `found at ${chk.ref.slice(0, 10)} but no longer on ${branch}`,
              backend: "raw.githubusercontent.com",
            };
          return {
            ...base,
            ok: true,
            detail: `found at ${chk.ref.slice(0, 10)} and on ${branch}`,
            backend: "raw.githubusercontent.com",
          };
        }
        return {
          ...base,
          ok: true,
          detail: `found in ${chk.path} at ${chk.ref.slice(0, 10)}`,
          backend: "raw.githubusercontent.com",
        };
      }
      case "bip.field": {
        const f = await bipPreamble(chk.bip);
        if (!f)
          return {
            ...base,
            ok: false,
            detail: `BIP ${chk.bip} not found`,
            backend: "raw.githubusercontent.com",
          };
        const got = f[chk.field] ?? "";
        const ok = got.toLowerCase().startsWith(chk.expect.toLowerCase());
        return {
          ...base,
          ok,
          detail: `BIP ${chk.bip} ${chk.field}: ${got || "(absent)"}`,
          backend: "bitcoin/bips default branch",
        };
      }
    }
  } catch (e) {
    return { ...base, ok: false, detail: String(e).slice(0, 300), backend: chain.name };
  }
}

export async function checkClaim(
  input: Candidate | Claim,
  chain: ChainSource,
): Promise<ClaimReport> {
  const c = provisional(input);
  const issues = validateClaim(c).filter(
    (i) => !["first_seen", "last_verified"].includes(i.where) && !i.where.startsWith("revisions"),
  );
  const sources = await Promise.all(c.sources.map((_, i) => checkSource(c, i)));
  const checks = await Promise.all((c.checks ?? []).map((k, i) => runCheck(k, i, chain)));
  const quoted = sources.filter((s) => s.quoteFound).length;
  const passed = checks.filter((k) => k.ok).length;
  const parts = [`quotes ${quoted}/${sources.length}`];
  const code = checks.filter((k) => k.type.startsWith("code") || k.type.startsWith("bip"));
  const chainChecks = checks.filter((k) => k.type.startsWith("chain"));
  if (code.length) parts.push(`code ${code.filter((k) => k.ok).length}/${code.length}`);
  if (chainChecks.length)
    parts.push(
      `chain ${chainChecks.filter((k) => k.ok).length}/${chainChecks.length} (${chain.name.startsWith("esplora") ? "esplora pair agreed" : chain.name})`,
    );
  return {
    id: c.id,
    ok:
      issues.every((i) => i.level !== "error") &&
      sources.every((s) => s.ok) &&
      passed === checks.length,
    issues,
    sources,
    checks,
    method: parts.join(", "),
  };
}

/** A plain-text report a person or a model can act on. */
export function formatReport(r: ClaimReport): string {
  const lines = [`${r.ok ? "PASS" : "FAIL"}  ${r.id}  (${r.method})`];
  for (const i of r.issues) lines.push(`  ${i.level}: ${i.where}: ${i.message}`);
  for (const s of r.sources) {
    if (s.ok && !s.anchorNote && s.injections.length === 0) continue;
    const head = `  source ${s.index}: ${s.url ?? "(no url)"}`;
    if (!s.ok)
      lines.push(
        `${head}: ${s.error}${s.closeness !== undefined ? ` (closest ${Math.round(s.closeness * 100)}%: "${s.nearest ?? ""}")` : ""}`,
      );
    if (s.anchorNote) lines.push(`${head}: ${s.anchorNote}`);
    for (const x of s.injections)
      lines.push(`${head}: suspected prompt injection: "${x.slice(0, 160)}"`);
  }
  for (const k of r.checks) if (!k.ok) lines.push(`  check ${k.index} ${k.type}: ${k.detail}`);
  return lines.join("\n");
}
