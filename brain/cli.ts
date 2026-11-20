// The brain's deterministic commands (CLAUDE.md, Commands). Run as `pnpm brain <command>`, which
// loads .env; model roles never run this file (SECURITY.md, T3).
//
//   pnpm brain check <run id | file.yaml | claim id>
//   pnpm brain research <topic> [--kind seed|daily|queue] [--task "..."] [--no-verify] [--no-publish]
//   pnpm brain publish <run id> [--no-commit] [--push]
//   pnpm brain ingest [--force] [--only <source>]
//   pnpm brain budget
import { existsSync, readFileSync } from "node:fs";
import { loadStore } from "@blocklore/core/node";
import { parse } from "yaml";
import { DAILY_BUDGET_USD, spentToday } from "./src/agent.ts";
import { chainSource } from "./src/chain.ts";
import { checkClaim, formatReport } from "./src/check.ts";
import { ingest } from "./src/ingest.ts";
import { publish } from "./src/publish.ts";
import { checkRun, research } from "./src/research.ts";
import { review } from "./src/review.ts";
import { Candidate } from "./src/staging.ts";

const [cmd, ...args] = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

async function check(target: string | undefined): Promise<number> {
  if (!target) throw new Error("usage: brain check <run id | file.yaml | claim id>");
  const chain = chainSource();
  if (/^\d{4}-\d{2}-\d{2}-/.test(target)) {
    const reports = await checkRun(target, chain);
    const failed = reports.filter((r) => !r.ok).length;
    console.log(`\n${reports.length - failed} passed, ${failed} failed (chain: ${chain.name})`);
    return failed ? 1 : 0;
  }
  const claim = existsSync(target)
    ? Candidate.parse(parse(readFileSync(target, "utf8")))
    : loadStore().store.claims.find((c) => c.id === target);
  if (!claim) throw new Error(`no claim ${target}`);
  const r = await checkClaim(claim, chain);
  console.log(formatReport(r));
  return r.ok ? 0 : 1;
}

const commands: Record<string, () => Promise<number>> = {
  check: () => check(args[0]),
  research: () =>
    research(args[0] ?? "", {
      kind: (opt("--kind") as "seed" | "daily" | "queue") ?? "seed",
      task: opt("--task"),
      verify: !has("--no-verify"),
      publish: !has("--no-publish"),
    }),
  publish: () => publish(args[0] ?? "", { commit: !has("--no-commit"), push: has("--push") }),
  review: () => review(args),
  ingest: () => ingest({ force: has("--force"), only: opt("--only") }),
  budget: async () => {
    console.log(
      `model roles spent ${spentToday().toFixed(2)} of ${DAILY_BUDGET_USD} USD today (UTC)`,
    );
    return 0;
  },
};

const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.error(`usage: pnpm brain <${Object.keys(commands).join(" | ")}> ...`);
  process.exit(2);
}
try {
  process.exitCode = await run();
} catch (e) {
  console.error(`brain ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
