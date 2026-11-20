// One research run, start to finish (ARCHITECTURE.md, "Data flow of one claim"): the research
// role writes candidates, code checks them, the role repairs what failed (at most twice), a verifier
// with fresh context tries to falsify what is left, and the publisher merges what survives.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadStore } from "@blocklore/core/node";
import { parse } from "yaml";
import { z } from "zod";
import { prepareContext, runRole } from "./agent.ts";
import { type ChainSource, chainSource } from "./chain.ts";
import { type ClaimReport, checkClaim, formatReport } from "./check.ts";
import { REVIEW, ROOT, remoteHead } from "./env.ts";
import { publish } from "./publish.ts";
import { loadRun, runDir } from "./staging.ts";
import { claimYaml, nowStamp, readLayout, readPending, topicYaml } from "./store.ts";

const Agenda = z.object({
  topics: z.array(
    z.object({ slug: z.string(), title: z.string(), group: z.string(), scope: z.string() }),
  ),
});

export function agenda() {
  return Agenda.parse(parse(readFileSync(path.join(ROOT, "brain", "agenda", "seed.yaml"), "utf8")))
    .topics;
}

const HEAD_REPOS = [
  "bitcoin/bitcoin",
  "bitcoin/bips",
  "lightning/bolts",
  "bitcoinops/bitcoinops.github.io",
  "bitcoin-inquisition/bitcoin",
  "bitcoinknots/bitcoin",
];

async function heads(): Promise<string[]> {
  return HEAD_REPOS.map((repo) => {
    const h = remoteHead(repo);
    return `- ${repo} (${h.branch}): ${h.sha}`;
  });
}

/** Checks every candidate in a run, writes checks.json, and returns the reports. */
export async function checkRun(
  runId: string,
  chain: ChainSource,
  quiet = false,
): Promise<ClaimReport[]> {
  const run = loadRun(runId);
  const reports: ClaimReport[] = [];
  for (const f of run.candidates) {
    const name = path.basename(f.file, ".yaml");
    if (!f.value) {
      reports.push({
        id: name,
        ok: false,
        issues: f.errors.map((m) => ({ level: "error", where: "schema", message: m })),
        sources: [],
        checks: [],
        method: "schema",
      });
      continue;
    }
    const r = await checkClaim(f.value, chain);
    if (name !== f.value.id) {
      r.issues.unshift({
        level: "error",
        where: "file",
        message: `the file must be named ${f.value.id}.yaml`,
      });
      r.ok = false;
    }
    reports.push(r);
  }
  writeFileSync(path.join(run.dir, "checks.json"), `${JSON.stringify(reports, null, 2)}\n`);
  if (!quiet) for (const r of reports) if (!r.ok) console.log(formatReport(r));
  return reports;
}

function schemaReport(reports: ClaimReport[]): string {
  return reports
    .filter((r) => !r.ok)
    .map((r) =>
      r.method === "schema"
        ? `FAIL  ${r.id}  (the file does not match the candidate schema)\n${r.issues.map((i) => `  error: ${i.message}`).join("\n")}`
        : formatReport(r),
    )
    .join("\n\n");
}

export interface ResearchOptions {
  kind: "seed" | "daily" | "queue";
  task?: string;
  verify: boolean;
  publish: boolean;
}

export async function research(slug: string, opts: ResearchOptions): Promise<number> {
  const entry = agenda().find((t) => t.slug === slug);
  if (!entry && !opts.task) throw new Error(`no agenda entry for ${slug}; pass --task`);
  const chain = chainSource();
  const now = await nowStamp(chain);
  let runId = `${now.time.slice(0, 10)}-${opts.kind}-${slug}`;
  for (let n = 2; existsSync(runDir(runId)); n++)
    runId = `${now.time.slice(0, 10)}-${opts.kind}-${slug}-${n}`;
  const dir = runDir(runId);
  for (const d of ["claims", "topics", "verdicts", "context/existing"])
    mkdirSync(path.join(dir, d), { recursive: true });
  prepareContext(dir);

  const { store } = loadStore();
  const existing = store.claims.filter((c) => c.topics.includes(slug));
  for (const c of existing)
    writeFileSync(path.join(dir, "context", "existing", `${c.id}.yaml`), claimYaml(c));
  const layout = readLayout(slug) ?? store.topics.find((t) => t.slug === slug) ?? null;
  if (layout) writeFileSync(path.join(dir, "context", "layout.yaml"), topicYaml(layout));
  const pendingIds = existsSync(path.join(REVIEW, "claims"))
    ? readPending()
        .filter((p) => p.candidate.topics.includes(slug))
        .map((p) => p.candidate.id)
    : [];

  const task = [
    `# Task: ${opts.kind} research on "${entry?.title ?? slug}"`,
    "",
    `Run ${runId}, started ${now.time} at block ${now.height.toLocaleString("en-US")}.`,
    "",
    `Topic slug: \`${slug}\`. Group: \`${entry?.group ?? "foundations"}\`. Claim ids start with \`${slug}.\`.`,
    "",
    "## Scope",
    "",
    opts.task ?? entry?.scope ?? "",
    "",
    "## What already exists",
    "",
    existing.length
      ? `${existing.length} published claims on this topic are in context/existing/. Build on them; do not duplicate them.`
      : "Nothing is published on this topic yet.",
    pendingIds.length
      ? `These ids are already waiting for human review; do not reuse them: ${pendingIds.join(", ")}.`
      : "",
    layout
      ? "The current layout is context/layout.yaml; write the full updated layout to topics/."
      : `Write the layout to topics/${slug}.yaml.`,
    "",
    "## Current commits (cite git sources at these, or at the commit where a text first appeared)",
    "",
    ...(await heads()),
    "",
    `Today is ${now.time.slice(0, 10)}. Use \`accessed: ${now.time.slice(0, 10)}\` on every source you read today. When a claim can change, anchor it: "as of block ${now.height.toLocaleString("en-US")}" or a date.`,
  ].join("\n");
  writeFileSync(path.join(dir, "context", "task.md"), `${task}\n`);
  writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        started: now,
        agent: "Claude Code headless, research role (Opus), verifier role (Opus)",
        task: opts.task ?? entry?.scope ?? "",
      },
      null,
      2,
    ),
  );

  console.log(`[${runId}] research role starting`);
  const r1 = await runRole(
    "research",
    dir,
    "Read context/task.md and do the research it describes, following your instructions exactly. Write candidates to claims/, the layout to topics/, and your notes to run.yaml.",
  );
  console.log(
    `[${runId}] research: ${r1.subtype}, ${r1.turns} turns, ${r1.costUsd.toFixed(2)} USD, ${r1.denials} denials. ${r1.result.slice(0, 300)}`,
  );

  let reports = await checkRun(runId, chain, true);
  for (let round = 1; round <= 2; round++) {
    const failed = reports.filter((r) => !r.ok);
    console.log(`[${runId}] checks: ${reports.length - failed.length} pass, ${failed.length} fail`);
    if (failed.length === 0) break;
    writeFileSync(path.join(dir, "context", "check-report.txt"), `${schemaReport(reports)}\n`);
    const fix = await runRole(
      "research",
      dir,
      "Your candidates in claims/ were checked by code and some failed. Read context/check-report.txt and fix every failure: re-fetch each source whose quote was not found and copy an exact passage, correct commits, checks and wording, or delete a claim you cannot support (and add it to run.yaml under skipped). Keep the layout in topics/ in step with the claims that remain.",
      { maxTurns: 80, maxBudgetUsd: 4 },
    );
    console.log(
      `[${runId}] repair ${round}: ${fix.subtype}, ${fix.turns} turns, ${fix.costUsd.toFixed(2)} USD`,
    );
    reports = await checkRun(runId, chain, true);
  }
  const passing = reports.filter((r) => r.ok).length;
  console.log(`[${runId}] after repairs: ${passing} pass, ${reports.length - passing} fail`);
  if (!opts.verify || passing === 0) return passing === 0 ? 1 : 0;

  const v = await runRole(
    "verifier",
    dir,
    "Verify every candidate in claims/ as your instructions describe, using checks.json for what code already confirmed. Write one verdict per candidate to verdicts/<id>.yaml.",
  );
  console.log(
    `[${runId}] verifier: ${v.subtype}, ${v.turns} turns, ${v.costUsd.toFixed(2)} USD. ${v.result.slice(0, 300)}`,
  );
  const verdicts = loadRun(runId).verdicts;
  const tally = { accept: 0, revise: 0, reject: 0, invalid: 0 };
  for (const f of verdicts) tally[f.value?.verdict ?? "invalid"]++;
  console.log(`[${runId}] verdicts: ${JSON.stringify(tally)}`);
  if (!opts.publish) return 0;
  return publish(runId, { commit: true, push: false }, chain);
}
