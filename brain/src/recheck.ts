// Re-verification: the stalest published claims are checked again against their sources and the
// chain, the same checks a claim passed to publish. A pass refreshes `last_verified` (not a
// revision: the claim did not change, and claimHash leaves it out). A failure changes nothing in
// the claim and is recorded in knowledge/rechecks.json, public, until a later recheck passes or a
// correction lands. Deterministic code only; no model reads anything here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Claim, Rechecks, Run, type Stamp, undash } from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { chainSource } from "./chain.ts";
import { type ClaimReport, checkClaim } from "./check.ts";
import { KNOWLEDGE, ROOT } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { capCacheAge } from "./http.ts";
import { claimPath, claimYaml, nowStamp, toYaml } from "./store.ts";

export const RECHECKS = path.join(KNOWLEDGE, "rechecks.json");

export function readRechecks(file = RECHECKS): Rechecks {
  return existsSync(file) ? Rechecks.parse(JSON.parse(readFileSync(file, "utf8"))) : {};
}

/** The claims a recheck reaches first: least recently verified, then by id, so runs rotate. */
export function stalest(claims: Claim[], limit: number): Claim[] {
  return [...claims]
    .sort(
      (a, b) =>
        a.last_verified.height - b.last_verified.height ||
        a.last_verified.time.localeCompare(b.last_verified.time) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** What failed, one line each, for the public record. */
export function problems(r: ClaimReport): string[] {
  return [
    ...r.issues.filter((i) => i.level === "error").map((i) => `${i.where}: ${i.message}`),
    ...r.sources
      .filter((s) => !s.ok)
      .map(
        (s) => `source ${s.index + 1}: ${s.error ?? (s.quoteFound ? "failed" : "quote not found")}`,
      ),
    ...r.checks.filter((k) => !k.ok).map((k) => `check ${k.index + 1} (${k.type}): ${k.detail}`),
  ];
}

/** Applies one recheck result: the claim to write on a pass, the record to keep on a failure. */
export function applyRecheck(
  c: Claim,
  r: ClaimReport,
  now: Stamp,
  run: string,
  rechecks: Rechecks,
): Claim | null {
  if (r.ok) {
    delete rechecks[c.id];
    return { ...c, last_verified: { ...now, run, method: `recheck, ${r.method}` } };
  }
  rechecks[c.id] = { at: now, problems: problems(r).map((p) => undash(p).slice(0, 600)) };
  return null;
}

export async function recheck(opts: {
  limit: number;
  commit: boolean;
  push: boolean;
}): Promise<number> {
  // Sources read within the hour count (claims share sources); anything older is fetched again.
  capCacheAge(3600);
  const chain = chainSource();
  const started = await nowStamp(chain);
  let run = `${started.time.slice(0, 10)}-reverify`;
  const runFile = (id: string) => path.join(KNOWLEDGE, "runs", id.slice(0, 4), `${id}.yaml`);
  for (let n = 2; existsSync(runFile(run)); n++) run = `${started.time.slice(0, 10)}-reverify-${n}`;
  const { store } = loadStore();
  const due = stalest(store.claims, opts.limit);
  const rechecks = readRechecks();
  const written: string[] = [];
  const failed: string[] = [];
  const read = new Map<string, string>();
  const injections: { url: string; excerpt: string }[] = [];
  // Three at a time: polite to the sources, and the HTTP layer keeps one robots.txt per origin.
  for (let i = 0; i < due.length; i += 3) {
    const batch = due.slice(i, i + 3);
    const reports = await Promise.all(batch.map((c) => checkClaim(c, chain)));
    batch.forEach((c, n) => {
      const r = reports[n];
      if (!r) return;
      for (const s of r.sources) {
        if (s.url && !read.has(s.url)) read.set(s.url, `recheck of ${c.id}`);
        for (const x of s.injections)
          if (s.url) injections.push({ url: s.url, excerpt: x.slice(0, 300) });
      }
      const next = applyRecheck(c, r, started, run, rechecks);
      if (next) {
        const file = claimPath(next);
        writeFileSync(file, claimYaml(next));
        written.push(path.relative(ROOT, file));
      } else {
        failed.push(c.id);
        console.log(`FAIL  ${c.id}\n  ${rechecks[c.id]?.problems.join("\n  ")}`);
      }
    });
  }
  const sorted = Object.fromEntries(
    Object.entries(rechecks).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(RECHECKS, `${JSON.stringify(sorted, null, 1)}\n`);
  const finished = await nowStamp(chain);
  const open = Object.keys(sorted);
  const log: Run = {
    id: run,
    kind: "reverify",
    started,
    finished,
    agent: "Deterministic recheck (no model): the same checks a claim passed to publish",
    summary: failed.length
      ? `Checked the ${due.length} least recently verified claims again against their sources and the chain. ${due.length - failed.length} still hold as cited. ${failed.length} did not (${failed.join(", ")}); each is listed on its page until a later recheck passes or a correction lands.`
      : `Checked the ${due.length} least recently verified claims again against their sources and the chain. All still hold as cited.`,
    read: [...read].map(([url, why]) => ({ url, why })),
    published: [],
    revised: [],
    rejected: [],
    gated: [],
    open: open.map((id) => `${id}: ${sorted[id]?.problems.join("; ")}`.slice(0, 600)),
    injections,
  };
  const logPath = runFile(run);
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, toYaml(Run.parse(log)));
  console.log(
    `recheck ${run} at block ${started.height}: ${due.length - failed.length} of ${due.length} passed; ${open.length} claims have an open failed recheck`,
  );
  if (opts.commit) {
    const committed = commitAsOwner(
      [...written, path.relative(ROOT, RECHECKS), path.relative(ROOT, logPath)],
      failed.length
        ? `Recheck ${due.length} claims at block ${started.height}: ${failed.length} no longer hold as cited, shown on their pages until fixed.`
        : `Recheck ${due.length} claims at block ${started.height}: all still hold as cited.`,
      opts.push,
    );
    if (committed) console.log(`committed${opts.push ? " and pushed" : ""}`);
  }
  return failed.length ? 1 : 0;
}
