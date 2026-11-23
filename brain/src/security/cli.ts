// The security watch's commands, mounted in brain/cli.ts:
//
//   pnpm brain watch [--only <id>] [--commit] [--push]     read every watch that is due (or one)
//   pnpm brain lab [--version X.Y,X.Y] [--jobs N] [--tests a.py,b.py] [--no-publish] [--commit]
//                  [--push]       the newest release of each maintained major, or the ones named
//   pnpm brain embargo [list | show <id> | release <id> | dismiss <id>]
//   pnpm brain advisories [--nvd N | --nvd all] [--commit] [--push]   every advisory matched to
//                                         the threats, and the threat map's CVE ids against NVD
import path from "node:path";
import { ROOT } from "../env.ts";
import { commitAsOwner } from "../git.ts";
import { advisoriesCommand, NVD_PER_RUN } from "./advisorylog.ts";
import { type Decision, decide, listEmbargo, readItem } from "./embargo.ts";
// Each kind registers how a release works when its module loads.
import "./gate.ts";
import { LAB_FILE, lab } from "./lab.ts";
import { watch } from "./watches.ts";

/**
 * The owner's decision on an embargoed finding, from the admin (a daemon job) or by hand. A
 * released lab run is committed, so a ship puts it on the site; a released research candidate
 * only joins the review queue, where the evaluator still decides it.
 */
export async function settle(
  id: string,
  decision: Decision,
  at: string,
): Promise<{ note: string; committed: boolean }> {
  const item = readItem(id);
  if (!item) throw new Error(`no embargoed finding ${id}`);
  const note = await decide(id, decision, at);
  const committed =
    decision === "release" &&
    item.kind === "lab" &&
    commitAsOwner(
      [path.relative(ROOT, LAB_FILE())],
      "Publish a lab run the owner released from the embargo, so the site shows it as it stands.",
      false,
    );
  return { note, committed };
}

export function securityCommands(
  args: string[],
  has: (f: string) => boolean,
  opt: (f: string) => string | undefined,
): Record<string, () => Promise<number>> {
  return {
    watch: () =>
      watch({
        only: opt("--only"),
        force: has("--force") || !!opt("--only"),
        commit: has("--commit"),
        push: has("--push"),
      }),
    lab: () =>
      lab({
        versions: opt("--version")?.split(","),
        jobs: opt("--jobs") ? Number(opt("--jobs")) : undefined,
        tests: opt("--tests")?.split(","),
        publish: !has("--no-publish"),
        commit: has("--commit"),
        push: has("--push"),
      }),
    embargo: () => embargoCommand(args),
    advisories: () => {
      const n = opt("--nvd");
      return advisoriesCommand({
        nvd: n === "all" ? Number.POSITIVE_INFINITY : n === undefined ? NVD_PER_RUN : Number(n),
        commit: has("--commit"),
        push: has("--push"),
      });
    },
  };
}

async function embargoCommand(args: string[]): Promise<number> {
  const [sub = "list", id] = args;
  if (sub === "list") {
    const items = listEmbargo();
    if (!items.length) console.log("nothing is embargoed");
    for (const i of items)
      console.log(`${i.id}  ${i.at}  ${i.kind.padEnd(8)}  ${i.title}\n    ${i.reasons.join("; ")}`);
    return 0;
  }
  if (!id) throw new Error(`usage: brain embargo ${sub} <id>`);
  if (sub === "show") {
    const item = readItem(id);
    if (!item) throw new Error(`no embargoed finding ${id}`);
    console.log(JSON.stringify(item, null, 2));
    return 0;
  }
  if (sub === "release" || sub === "dismiss") {
    console.log((await settle(id, sub, new Date().toISOString())).note);
    return 0;
  }
  throw new Error("usage: brain embargo [list | show <id> | release <id> | dismiss <id>]");
}
