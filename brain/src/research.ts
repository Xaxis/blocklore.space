// One research run, start to finish (ARCHITECTURE.md, "Data flow of one claim"): the research
// role writes candidates, code checks them, the role repairs what failed (at most twice), a verifier
// with fresh context tries to falsify what is left, and the publisher merges what survives.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { heldBack } from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { parse } from "yaml";
import { z } from "zod";
import { prepareContext, runRole } from "./agent.ts";
import { type ChainSource, chainSource } from "./chain.ts";
import { type ClaimReport, checkClaim, formatReport } from "./check.ts";
import { type Current, controlStore, readSettings } from "./control.ts";
import { checkDebates, isDebateReport } from "./debates.ts";
import { KNOWLEDGE, REVIEW, ROOT, remoteHead } from "./env.ts";
import { evaluatorFiles } from "./evaluator.ts";
import { heldBackSection } from "./heldback.ts";
import { ownerNotes } from "./plan.ts";
import { publish } from "./publish.ts";
import { rejectedOnTopic, rejectedSection } from "./redraft.ts";
import { passesChecks, ruleIssues } from "./rulecheck.ts";
import { loadRun, runDir } from "./staging.ts";
import {
  claimYaml,
  loadPolicy,
  nowStamp,
  readLayout,
  readLayouts,
  readPending,
  topicYaml,
} from "./store.ts";

const Agenda = z.object({
  topics: z.array(
    z.object({ slug: z.string(), title: z.string(), group: z.string(), scope: z.string() }),
  ),
});

/** The research agenda, the owner's: changed from the admin's Agenda page (brain/src/jobs.ts). */
export const AGENDA_FILE = path.join(ROOT, "brain", "agenda", "seed.yaml");

export function agenda() {
  return Agenda.parse(parse(readFileSync(AGENDA_FILE, "utf8"))).topics;
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

/**
 * Checks every candidate in a run, writes checks.json, and returns the reports. A candidate the gate
 * will mark also gets the evaluator's code rules it breaks (brain/src/rulecheck.ts), so the repair
 * rounds can fix them; they fail the report but never stop it going on (`passesChecks`). Each
 * debate map in the run's debates/ gets a report too, with the debate rules it breaks
 * (brain/src/debates.ts); `isDebateReport` tells them apart.
 */
export async function checkRun(
  runId: string,
  chain: ChainSource,
  quiet = false,
): Promise<ClaimReport[]> {
  const run = loadRun(runId);
  const policy = loadPolicy();
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
    const rules = ruleIssues(f.value, policy);
    if (rules.length) {
      r.issues.push(...rules);
      r.ok = false;
    }
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
  if (run.debates.length) {
    const pending = existsSync(path.join(REVIEW, "claims")) ? readPending() : [];
    reports.push(...checkDebates(run, loadStore(KNOWLEDGE).store, pending, readLayouts(), policy));
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
  /** The owner's focus for this one session (research.start from the admin). */
  focus?: string;
  verify: boolean;
  publish: boolean;
}

export async function research(slug: string, opts: ResearchOptions): Promise<number> {
  return (await researchRun(slug, opts)).code;
}

/**
 * One research session. It starts the live feed over and keeps var/control/current.json up to date
 * (run id, phase, pid), so the daemon can show it, stop it before it publishes, and publish its
 * run under the lock afterwards.
 */
export async function researchRun(
  slug: string,
  opts: ResearchOptions,
): Promise<{ code: number; runId: string; passing: number }> {
  const entry = agenda().find((t) => t.slug === slug);
  if (!entry && !opts.task) throw new Error(`no agenda entry for ${slug}; pass --task`);
  const settings = readSettings();
  const chain = chainSource();
  const now = await nowStamp(chain);
  let runId = `${now.time.slice(0, 10)}-${opts.kind}-${slug}`;
  for (let n = 2; existsSync(runDir(runId)); n++)
    runId = `${now.time.slice(0, 10)}-${opts.kind}-${slug}-${n}`;
  const control = controlStore();
  control.resetLive();
  const current: Current = {
    run: runId,
    topic: slug,
    started: new Date().toISOString(),
    phase: "research",
    pid: process.pid,
  };
  control.saveCurrent(current);
  const phase = (p: Current["phase"] | null, text: string) => {
    if (p) control.saveCurrent({ ...current, phase: p });
    control.addLive({
      at: new Date().toISOString(),
      run: runId,
      role: "pipeline",
      kind: "phase",
      text,
    });
    console.log(`[${runId}] ${text}`);
  };
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

  const decisions = evaluatorFiles().decisions();
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
    ...(() => {
      const notes = ownerNotes(settings.lessons, settings.focus, opts.focus);
      return notes.length ? [...notes, ""] : [];
    })(),
    ...heldBackSection(heldBack(decisions)),
    ...rejectedSection(
      rejectedOnTopic(decisions, slug, new Set([...existing.map((c) => c.id), ...pendingIds])),
    ),
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
        agent: `Claude Code headless, research role and verifier role (${settings.research.model})`,
        task: opts.task ?? entry?.scope ?? "",
      },
      null,
      2,
    ),
  );

  try {
    phase("research", `research session on ${slug} starting (${settings.research.model})`);
    const r1 = await runRole(
      "research",
      dir,
      "Read context/task.md and do the research it describes, following your instructions exactly. Write candidates to claims/, the layout to topics/, and your notes to run.yaml.",
    );
    phase(null, `research: ${r1.subtype}, ${r1.turns} turns, ${r1.denials} denials`);
    console.log(`[${runId}] ${r1.result.slice(0, 300)}`);

    let reports = await checkRun(runId, chain, true);
    for (let round = 1; round <= 2; round++) {
      const failed = reports.filter((r) => !r.ok);
      phase(null, `checks: ${reports.length - failed.length} pass, ${failed.length} fail`);
      if (failed.length === 0) break;
      writeFileSync(path.join(dir, "context", "check-report.txt"), `${schemaReport(reports)}\n`);
      phase("repair", `repair ${round}: the research role fixes what code rejected`);
      const fix = await runRole(
        "research",
        dir,
        "Your candidates in claims/ were checked by code and some failed. Read context/check-report.txt and fix every failure: re-fetch each source whose quote was not found and copy an exact passage, correct commits, checks and wording, or delete a claim you cannot support (and add it to run.yaml under skipped). Keep the layout in topics/ in step with the claims that remain, and each debate in debates/ in step with them: fix what its report says, or delete the debate.",
        { maxTurns: Math.min(80, settings.usage.sessionTurns) },
      );
      phase(null, `repair ${round}: ${fix.subtype}, ${fix.turns} turns`);
      reports = await checkRun(runId, chain, true);
    }
    // A draft that breaks only the evaluator's rules still goes on: the evaluator decides it. A
    // debate is not a claim: it is counted apart, and the publisher decides it against the claims.
    const claimReports = reports.filter((r) => !isDebateReport(r));
    const passing = claimReports.filter(passesChecks).length;
    const ruled = claimReports.filter((r) => !r.ok && passesChecks(r)).length;
    const debatesFailing = reports.filter((r) => isDebateReport(r) && !r.ok).length;
    phase(
      null,
      `after repairs: ${passing} pass, ${claimReports.length - passing} fail${ruled ? `; ${ruled} of those passing still break an evaluator rule` : ""}${debatesFailing ? `; ${debatesFailing} debate map(s) still break a debate rule` : ""}`,
    );
    if (!opts.verify || passing === 0) {
      phase(
        passing === 0 ? "failed" : "done",
        passing === 0 ? "nothing passed the checks" : "done, unverified",
      );
      return { code: passing === 0 ? 1 : 0, runId, passing };
    }

    phase("verify", "verifier starting: a fresh model tries to falsify each candidate");
    const v = await runRole(
      "verifier",
      dir,
      "Verify every candidate in claims/ as your instructions describe, using checks.json for what code already confirmed. Write one verdict per candidate to verdicts/<id>.yaml.",
    );
    phase(null, `verifier: ${v.subtype}, ${v.turns} turns`);
    console.log(`[${runId}] ${v.result.slice(0, 300)}`);
    const verdicts = loadRun(runId).verdicts;
    const tally = { accept: 0, revise: 0, reject: 0, invalid: 0 };
    for (const f of verdicts) tally[f.value?.verdict ?? "invalid"]++;
    phase(
      null,
      `verdicts: ${tally.accept} accept, ${tally.revise} revise, ${tally.reject} reject, ${tally.invalid} invalid`,
    );
    if (!opts.publish) {
      phase("done", "verified; publishing comes next, under the lock");
      return { code: 0, runId, passing };
    }
    phase("publishing", "publishing what survived; the gate holds what needs the owner");
    const code = await publish(runId, { commit: true, push: false }, chain);
    phase(code === 0 ? "done" : "failed", code === 0 ? "published" : `publish exited ${code}`);
    return { code, runId, passing };
  } catch (e) {
    phase("failed", `failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}
