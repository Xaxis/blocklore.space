// One long command from the owner, in a process of its own (ADMIN.md). The daemon verified the
// command, wrote it to var/control/jobs/<id>.json, and starts `brain job <id>`: under the tick lock
// for everything that commits or ships, and without it for a research session (which takes the
// lock itself to publish). The last line starting "RESULT: " is what the owner reads.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AgendaTopic,
  AgendaTopic as AgendaTopicSchema,
  type Command,
} from "@blocklore/core/control";
import { parseDocument, YAMLSeq } from "yaml";
import { controlStore } from "./control.ts";
import { ROOT } from "./env.ts";
import { evaluateJob } from "./evaljob.ts";
import { commitAsOwner } from "./git.ts";
import { applyOrangecheck } from "./orangecheck.ts";
import { approve, reject } from "./review.ts";
import { revoke } from "./revoke.ts";
import { settle } from "./security/cli.ts";
import { session } from "./session.ts";
import { connect, disconnect } from "./subscription.ts";
import { ship, tick } from "./tick.ts";

/** Commands that run as a job; everything else the daemon applies at once. */
export const LONG: ReadonlySet<Command["type"]> = new Set([
  "review.approve",
  "review.reject",
  "research.start",
  "tick",
  "ship",
  "agenda.save",
  "agenda.remove",
  "claim.revoke",
  "evaluator.run",
  "embargo.decide",
  "orangecheck.authorize",
  "orangecheck.revoke",
  "subscription.connect",
  "subscription.disconnect",
]);

/** Jobs that commit or ship take the tick lock for their whole run; model work takes it to publish. */
export function needsLock(type: Command["type"]): boolean {
  return (
    LONG.has(type) &&
    type !== "research.start" &&
    type !== "evaluator.run" &&
    !type.startsWith("subscription.")
  );
}

const AGENDA = path.join(ROOT, "brain", "agenda", "seed.yaml");

/**
 * The agenda file with one topic added, changed or removed, comments and order kept. Returns the
 * new text and a sentence for the commit.
 */
export function editAgenda(
  text: string,
  change: { save: AgendaTopic } | { remove: string },
): { text: string; message: string } {
  const doc = parseDocument(text);
  const topics = doc.get("topics");
  if (!(topics instanceof YAMLSeq)) throw new Error("the agenda has no topics list");
  const index = (slug: string) =>
    topics.items.findIndex((n) => (n as { get?: (k: string) => unknown }).get?.("slug") === slug);
  if ("remove" in change) {
    const i = index(change.remove);
    if (i < 0) throw new Error(`${change.remove} is not on the agenda`);
    topics.items.splice(i, 1);
    return {
      text: doc.toString({ lineWidth: 100 }),
      message: `Take ${change.remove} off the research agenda, as the owner asked in the admin.`,
    };
  }
  const t = AgendaTopicSchema.parse(change.save);
  const node = doc.createNode({ slug: t.slug, title: t.title, group: t.group, scope: t.scope });
  const i = index(t.slug);
  if (i >= 0) topics.items[i] = node;
  else topics.items.push(node);
  return {
    text: doc.toString({ lineWidth: 100 }),
    message:
      i >= 0
        ? `Change the research agenda's scope for ${t.title}, as the owner asked in the admin.`
        : `Add ${t.title} to the research agenda, as the owner asked in the admin, so research can take it up.`,
  };
}

async function shipNote(): Promise<string> {
  try {
    return await ship();
  } catch (e) {
    return `ship failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function apply(cmd: Command): Promise<{ code: number; message: string }> {
  switch (cmd.type) {
    case "review.approve": {
      const code = await approve(cmd.items, cmd.note);
      if (code !== 0) return { code, message: "publishing failed; the claims still wait" };
      return {
        code,
        message: `published ${cmd.items.length} claim(s); ${await shipNote()}`,
      };
    }
    case "review.reject": {
      const code = await reject(cmd.items, cmd.reason);
      if (code !== 0)
        return { code, message: "recording the rejection failed; the claims still wait" };
      return { code, message: `rejected ${cmd.items.length} claim(s); ${await shipNote()}` };
    }
    case "claim.revoke": {
      const r = await revoke(cmd.id, cmd.hash, cmd.reason);
      if (r.code !== 0) return r;
      return { code: 0, message: `${r.message}; ${await shipNote()}` };
    }
    case "evaluator.run":
      return evaluateJob();
    case "research.start": {
      // session prints its own RESULT line; exit 3 means nothing to research (the daemon backs off)
      return { code: await session({ topic: cmd.topic, focus: cmd.focus }), message: "" };
    }
    case "tick": {
      const code = await tick(cmd.tick, true);
      return {
        code,
        message: `the ${cmd.tick} tick ${code === 0 ? "ran" : "had failing steps"} (var/loop)`,
      };
    }
    case "ship":
      return { code: 0, message: await ship() };
    case "agenda.save":
    case "agenda.remove": {
      const edit = editAgenda(
        readFileSync(AGENDA, "utf8"),
        cmd.type === "agenda.save" ? { save: cmd.topic } : { remove: cmd.slug },
      );
      writeFileSync(AGENDA, edit.text);
      const committed = commitAsOwner([path.relative(ROOT, AGENDA)], edit.message, true);
      return { code: 0, message: committed ? edit.message : "the agenda already said that" };
    }
    case "embargo.decide": {
      const r = await settle(cmd.id, cmd.decision, new Date().toISOString());
      return { code: 0, message: r.committed ? `${r.note}; ${await shipNote()}` : r.note };
    }
    case "orangecheck.authorize":
    case "orangecheck.revoke": {
      const r = applyOrangecheck(cmd);
      return r.code ? r : { code: 0, message: `${r.message}; ${await shipNote()}` };
    }
    case "subscription.connect":
      return connect(cmd.sealed);
    case "subscription.disconnect":
      return disconnect();
    default:
      return { code: 1, message: `${cmd.type} is not a job` };
  }
}

export async function job(id: string | undefined): Promise<number> {
  if (!id) throw new Error("usage: brain job <id>");
  const cmd = controlStore().readJobCommand(id);
  try {
    const r = await apply(cmd);
    if (r.message) console.log(`RESULT: ${r.message}`);
    return r.code;
  } catch (e) {
    console.log(`RESULT: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
