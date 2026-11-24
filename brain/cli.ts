// The brain's deterministic commands (CLAUDE.md, Commands). Run as `pnpm brain <command>`, which
// loads .env; model roles never run this file (SECURITY.md, T3).
//
//   pnpm brain check <run id | file.yaml | claim id>
//   pnpm brain research <topic> [--kind seed|daily|queue] [--task "..."] [--no-verify] [--no-publish]
//   pnpm brain publish <run id> [--no-commit] [--push]
//   pnpm brain ingest [--force] [--only <source>]
//   pnpm brain bips [--no-commit] [--push]      the BIP index, Bitcoin Core's doc/bips.md and its
//                                               newest release's mainnet deployments
//   pnpm brain snapshot [--upgrade] [--no-commit] [--push]
//   pnpm brain bench [--limit N] [--only kind,kind] [--ids g001,g002] [--publish [--commit]]
//   pnpm brain gaps                       the gap map as research sees it, and the next run
//   pnpm brain review-loop [--week YYYY-MM-DD] [--write]   the weekly review of the loop (BACKLOG 31)
//   pnpm brain queue <pull [--all] | list | accept <id> | research <id> <topic> | answer <id> --claims a,b | decline <id>>
//   pnpm brain recheck [--limit 30] [--no-commit] [--push]
//   pnpm brain reports <pull [--all] | list | run [--limit N] [--no-commit] [--push]>   reader reports
//   pnpm brain tick <hourly | daily | weekly | research> [--force]
//   pnpm brain usage                      model sessions today on the owner's Claude subscription
//   pnpm brain daemon [--cycles N]        the admin's devbox side (ADMIN.md); systemd runs it
//   pnpm brain session [--topic <slug>] [--focus "..."]   one research session, publish under the lock
//   pnpm brain ship                       push, and deploy when the live site is behind
//   pnpm brain admin-link                 a one-time sign-in link to the admin
//   pnpm brain job <id>                   one queued admin command (the daemon starts these)
//   pnpm brain evaluate [run | apply <batch>]   the evaluator: its state, one batch now, apply one
//   pnpm brain watch | lab | embargo | advisories   the security watch (brain/src/security/cli.ts)
//   pnpm brain signaling                  the version bits blocks set this period, read from both
//                                         explorers and printed; writes nothing (brain/src/signaling.ts)
//   pnpm brain orangecheck <keygen | status | backfill | publish>   the publisher key (ORANGECHECK.md)
//   pnpm brain nostr <status | preview>   the Nostr channel: its key, its switch, the next notes
import { existsSync, readFileSync } from "node:fs";
import { loadStore } from "@blocklore/core/node";
import { parse } from "yaml";
import { adminLink } from "./src/adminlink.ts";
import { usageLedger } from "./src/agent.ts";
import { bench } from "./src/bench.ts";
import { refreshBips, refreshCoreBips } from "./src/bips.ts";
import { chainSource } from "./src/chain.ts";
import { refreshChainparams } from "./src/chainparams.ts";
import { checkClaim, formatReport } from "./src/check.ts";
import { daemon } from "./src/daemon.ts";
import { evaluateCli } from "./src/evaljob.ts";
import { ingest } from "./src/ingest.ts";
import { job } from "./src/jobs.ts";
import { reviewLoop } from "./src/loopreview.ts";
import { nostr } from "./src/nostr.ts";
import { orangecheck } from "./src/orangecheck.ts";
import { gaps } from "./src/plan.ts";
import { publish } from "./src/publish.ts";
import { queue } from "./src/queue.ts";
import { recheck } from "./src/recheck.ts";
import { reports } from "./src/reports.ts";
import { checkRun, research } from "./src/research.ts";
import { review } from "./src/review.ts";
import { securityCommands } from "./src/security/cli.ts";
import { blocksBetween, newestRelease, readFollowed, tip } from "./src/security/watches.ts";
import { session } from "./src/session.ts";
import { signalingCommand } from "./src/signaling.ts";
import { snapshot } from "./src/snapshot.ts";
import { Candidate } from "./src/staging.ts";
import { ship, tick } from "./src/tick.ts";

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
  ...securityCommands(args, has, opt),
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
  evaluate: () => evaluateCli(args),
  ingest: () => ingest({ force: has("--force"), only: opt("--only") }),
  signaling: () =>
    signalingCommand({
      tip,
      blocks: blocksBetween,
      followed: readFollowed(),
      newest: newestRelease,
    }),
  bips: async () => {
    const o = { commit: !has("--no-commit"), push: has("--push") };
    const index = await refreshBips(o);
    const core = await refreshCoreBips(o);
    return (await refreshChainparams(o)) || core || index;
  },
  snapshot: () =>
    snapshot({ commit: !has("--no-commit"), push: has("--push"), upgrade: has("--upgrade") }),
  queue: () => queue(args),
  reports: () => reports(args),
  tick: () => tick(args[0], has("--force")),
  // Exits outright when it returns (it reloads on new code by returning), so no open handle keeps
  // the old process alive and systemd starts the new one.
  daemon: async () =>
    process.exit(await daemon({ cycles: opt("--cycles") ? Number(opt("--cycles")) : undefined })),
  session: () => session({ topic: opt("--topic") ?? null, focus: opt("--focus") }),
  ship: async () => {
    console.log(await ship());
    return 0;
  },
  "admin-link": () => adminLink(),
  job: () => job(args[0]),
  orangecheck: () => orangecheck(args),
  nostr: () => nostr(args),
  recheck: () =>
    recheck({
      limit: Number(opt("--limit") ?? 30),
      commit: !has("--no-commit"),
      push: has("--push"),
    }),
  gaps: () => gaps(),
  "review-loop": () => reviewLoop({ week: opt("--week"), write: has("--write") }),
  bench: () =>
    bench({
      limit: opt("--limit") ? Number(opt("--limit")) : undefined,
      only: opt("--only")?.split(","),
      ids: opt("--ids")?.split(","),
      publish: has("--publish"),
      commit: has("--commit"),
    }),
  usage: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines = usageLedger().filter((l) => l.day === today);
    const minutes = lines.reduce((n, l) => n + (l.minutes ?? 0), 0);
    console.log(
      `${lines.length} model session(s) on the Claude subscription today (UTC), ${minutes} minutes`,
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
