// The rules a claim must meet beyond its shape (schema.ts). CLAIMS.md, "Rules the checker
// enforces", and EDITORIAL.md, "Style rules a linter enforces".
import type { Claim, Source, SourceKind, Tier } from "./schema.ts";
import { styleIssues, undatedTimeWords, wordCount } from "./style.ts";

export interface Issue {
  level: "error" | "warning";
  where: string;
  message: string;
}

export const DEFAULT_TIER: Record<SourceKind, Tier> = {
  bip: "T1",
  bolt: "T1",
  code: "T1",
  commit: "T1",
  pr: "T1",
  issue: "T1",
  "release-notes": "T1",
  "mailing-list": "T1",
  delving: "T1",
  chain: "T1",
  optech: "T2",
  stackexchange: "T2",
  transcript: "T2",
  paper: "T2",
  docs: "T2",
  media: "T3",
  social: "T4",
};

const GIT_BLOB = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/([0-9a-f]{40})\//;
const GIT_COMMIT = /^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/([0-9a-f]{40})$/;
const GIT_PR = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+/;

function sourceIssues(s: Source, i: number): Issue[] {
  const out: Issue[] = [];
  const where = `sources[${i}]`;
  const err = (message: string) => out.push({ level: "error", where, message });
  const warn = (message: string) => out.push({ level: "warning", where, message });

  if (s.kind !== "chain") {
    if (!s.url) err("needs a url");
    if (!s.quote) err("needs a quote found at the url");
  }
  if (s.quote && wordCount(s.quote) > 50) err("quote is longer than 50 words");
  for (const p of styleIssues(s.title).filter((m) => m.includes("dash"))) err(`title ${p}`);
  for (const p of styleIssues(s.locator).filter((m) => m.includes("dash"))) err(`locator ${p}`);
  if (s.url) {
    if ((s.kind === "bip" || s.kind === "bolt" || s.kind === "code") && !GIT_BLOB.test(s.url))
      err(`a ${s.kind} source is cited at a commit: github.com/<org>/<repo>/blob/<40-hex>/<path>`);
    if (s.kind === "commit" && !GIT_COMMIT.test(s.url))
      err("a commit source is github.com/<org>/<repo>/commit/<40-hex>");
    if ((s.kind === "pr" || s.kind === "issue") && !GIT_PR.test(s.url))
      err("a pr or issue source is github.com/<org>/<repo>/pull/<n> or /issues/<n>");
    if (s.kind === "mailing-list" && /groups\.google\.com/.test(s.url))
      warn("cite the archive by message id (gnusha.org/pi/bitcoindev/<id>/), not Google Groups");
  }
  if (DEFAULT_TIER[s.kind] !== s.tier)
    warn(`a ${s.kind} source is usually ${DEFAULT_TIER[s.kind]}, not ${s.tier}`);
  return out;
}

/** Every problem with one claim, errors first. */
export function validateClaim(c: Claim): Issue[] {
  const out: Issue[] = [];
  const err = (where: string, message: string) => out.push({ level: "error", where, message });
  const warn = (where: string, message: string) => out.push({ level: "warning", where, message });

  const [primary] = c.topics;
  if (!c.id.startsWith(`${primary}.`)) err("id", `must start with its primary topic "${primary}."`);

  const words = wordCount(c.statement);
  if (words < 12 || words > 80) err("statement", `is ${words} words; write 12 to 80`);
  for (const p of styleIssues(c.statement)) err("statement", p);
  for (const w of undatedTimeWords(c.statement))
    warn("statement", `"${w}" needs a block height or date (EDITORIAL.md)`);

  c.sources.forEach((s, i) => {
    out.push(...sourceIssues(s, i));
  });
  if (!c.sources.some((s) => s.supports === "direct"))
    err("sources", "needs at least one source that supports the statement directly");
  if (
    c.sources.some((s) => s.kind === "chain") &&
    !c.checks?.some((k) => k.type.startsWith("chain."))
  )
    err("checks", "a chain source needs a chain.* check");

  if ((c.kind === "stance" || c.kind === "argument") && !c.attributed_to?.length)
    err("attributed_to", `a ${c.kind} names who holds it`);
  if (c.status === "superseded" && !c.superseded_by)
    err("superseded_by", "a superseded claim names its replacement");
  if (c.status !== "superseded" && c.status !== "withdrawn" && c.superseded_by)
    err("status", "a claim with superseded_by has status superseded");
  // Only the owner withdraws a claim, and only with a revision that says when and why.
  const withdrawals = c.revisions.filter((r) => r.change === "withdrawn");
  if (c.status === "withdrawn" && withdrawals.length === 0)
    err("status", "a withdrawn claim has a withdrawn revision saying when and why");
  if (withdrawals.length > 0 && c.status !== "withdrawn")
    err("status", "a claim once withdrawn stays withdrawn; a new claim takes a new id");

  c.revisions.forEach((r, i) => {
    if (r.rev !== i + 1) err(`revisions[${i}]`, `rev is ${r.rev}, expected ${i + 1}`);
    if (i === 0 && r.change !== "created") err("revisions[0]", 'the first change is "created"');
    if (i > 0 && r.change === "created")
      err(`revisions[${i}]`, 'only the first change is "created"');
    if (i > 0 && !r.note) err(`revisions[${i}]`, "a change after creation says why (note)");
    const prev = c.revisions[i - 1];
    if (prev && (r.at.time < prev.at.time || r.at.height < prev.at.height))
      err(`revisions[${i}]`, "is earlier than the revision before it");
    if (r.note)
      for (const p of styleIssues(r.note).filter((m) => m.includes("dash")))
        err(`revisions[${i}].note`, p);
  });
  const first = c.revisions[0];
  if (first && (first.at.time !== c.first_seen.time || first.at.height !== c.first_seen.height))
    err("first_seen", "equals the first revision's time and height");
  const last = c.revisions[c.revisions.length - 1];
  if (last && c.last_verified.time < last.at.time)
    err("last_verified", "is earlier than the latest revision");

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** True when every source is media or social, which the site labels. */
export function onlyWeakSources(c: Pick<Claim, "sources">): boolean {
  return c.sources.every((s) => s.tier === "T3" || s.tier === "T4");
}
