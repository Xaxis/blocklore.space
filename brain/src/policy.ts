// The owner's gate policy changed from the admin (ADMIN.md, "Gate policy"). Each command is one
// edit of brain/policy/topics.yaml as a YAML document, so the owner's comments, order and every
// line it does not touch stay as they were; the job (brain/src/jobs.ts) formats it, checks it here
// (it parses as the policy, says what the owner asked and changes nothing else), and only then
// writes and commits it. The view the admin shows comes from here too, built from this checkout.
import { statSync } from "node:fs";
import {
  applyPolicyCommand,
  flagsText,
  GatePolicy,
  type GatePolicyView,
  gatePolicyView,
  type PolicyCommand,
  policyCommandProblem,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { isMap, isScalar, isSeq, parse, parseDocument } from "yaml";
import { KNOWLEDGE } from "./env.ts";
import { AGENDA_FILE, agenda } from "./research.ts";
import { loadPolicy, POLICY_FILE } from "./store.ts";

/** When the policy and the agenda last changed on disk, so the daemon rebuilds the view only then. */
export function policyStamp(): string {
  return [POLICY_FILE, AGENDA_FILE]
    .map((f) => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return "none";
      }
    })
    .join("|");
}

/** The policy, the agenda and the published topics as this checkout has them now. */
export function policyView(head: string, waiting: ReadonlyMap<string, number>): GatePolicyView {
  const { store } = loadStore(KNOWLEDGE);
  return gatePolicyView({
    policy: loadPolicy(),
    agenda: agenda(),
    published: store.topics.map((t) => ({ slug: t.slug, title: t.title })),
    waiting,
    head,
  });
}

/** Why a new claim on a topic with these flags waits, for the commit's last words. */
function soText(f: { contested: boolean; safety: boolean }): string {
  if (f.contested)
    return `so every new claim on it waits for the evaluator's closer checks${f.safety ? " and needs two independent sources" : ""}`;
  if (f.safety)
    return "so a new claim on it waits for the evaluator and needs two independent sources";
  return "so a new claim on it waits for the evaluator only for a reason of its own";
}

/**
 * The policy's text with one command applied, and the sentence its commit says. Throws, changing
 * nothing, when the command does not fit the policy as `view` (this checkout, now) shows it.
 */
export function editPolicy(
  text: string,
  cmd: PolicyCommand,
  view: GatePolicyView,
): { text: string; message: string } {
  const problem = policyCommandProblem(cmd, view);
  if (problem) throw new Error(problem);
  const doc = parseDocument(text);
  if (doc.errors.length)
    throw new Error(`the gate policy does not parse: ${doc.errors[0]?.message}`);
  let message: string;
  if (cmd.type === "policy.topic") {
    const topics = doc.get("topics", true);
    if (!isMap(topics)) throw new Error("the gate policy has no topics section");
    const flags = { contested: cmd.contested, safety: cmd.safety };
    const node = topics.get(cmd.slug, true);
    if (isMap(node)) {
      // In place, so the entry keeps its style and its place.
      node.set("contested", cmd.contested);
      node.set("safety", cmd.safety);
      message = `Set ${cmd.slug} in the gate policy to ${flagsText(flags)}, as the owner asked in the admin, ${soText(flags)}.`;
    } else {
      if (node !== undefined)
        throw new Error(`the gate policy's entry for ${cmd.slug} is not a map`);
      topics.flow = false;
      topics.set(cmd.slug, doc.createNode(flags, { flow: true }));
      message = `List ${cmd.slug} in the gate policy as ${flagsText(flags)}, as the owner asked in the admin, ${soText(flags)}.`;
    }
  } else {
    const terms = doc.get("contested_terms", true);
    if (!isSeq(terms)) throw new Error("the gate policy has no contested_terms list");
    if (cmd.add) {
      terms.flow = false;
      terms.add(doc.createNode(cmd.term));
      message = `Add "${cmd.term}" to the gate policy's contested terms, as the owner asked in the admin, so a new claim that names it waits for the evaluator on any topic.`;
    } else {
      const i = terms.items.findIndex((n) => isScalar(n) && n.value === cmd.term);
      if (i < 0) throw new Error(`${cmd.term} is not a contested term`);
      terms.items.splice(i, 1);
      message = `Take "${cmd.term}" off the gate policy's contested terms, as the owner asked in the admin, so naming it no longer holds a new claim for the evaluator.`;
    }
  }
  return { text: doc.toString({ lineWidth: 100 }), message };
}

/** The lines of `text`, with an empty section's `{}` or `[]` dropped from its header. */
const linesOf = (text: string) =>
  text.split("\n").map((l) => l.replace(/^(topics|contested_terms):\s*(\{\}|\[\])\s*$/, "$1:"));

/** The whole lines of the entry the command names (a topic's key and flags, or a term), if any. */
function entryLines(text: string, cmd: PolicyCommand): [number, number] | null {
  const doc = parseDocument(text);
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length - 1;
  if (cmd.type === "policy.topic") {
    const topics = doc.get("topics", true);
    const pair = isMap(topics)
      ? topics.items.find((p) => isScalar(p.key) && p.key.value === cmd.slug)
      : undefined;
    const from = isScalar(pair?.key) ? pair.key.range?.[0] : undefined;
    const to = (pair?.value as { range?: [number, number, number] } | null)?.range?.[1];
    return from === undefined || to === undefined ? null : [lineOf(from), lineOf(to - 1)];
  }
  const terms = doc.get("contested_terms", true);
  const item = isSeq(terms)
    ? terms.items.find((n) => isScalar(n) && n.value === cmd.term)
    : undefined;
  const range = isScalar(item) ? item.range : undefined;
  return range ? [lineOf(range[0]), lineOf(range[1] - 1)] : null;
}

/** `text`'s lines without the command's entry. */
function without(text: string, cmd: PolicyCommand): string[] {
  const lines = linesOf(text);
  const span = entryLines(text, cmd);
  return span ? [...lines.slice(0, span[0]), ...lines.slice(span[1] + 1)] : lines;
}

/**
 * The edited text as the job is about to write it: it must parse as the policy, hold exactly what
 * the command asked of the policy before it, and differ from the text before only in the lines of
 * the entry the command names, so every comment, blank line and other entry stays as it was.
 */
export function checkPolicy(before: string, after: string, cmd: PolicyCommand): GatePolicy {
  let raw: unknown;
  try {
    raw = parse(after);
  } catch (e) {
    throw new Error(`the edited gate policy does not parse: ${(e as Error).message}`);
  }
  const parsed = GatePolicy.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `the edited gate policy does not match its schema: ${parsed.error.issues[0]?.message}`,
    );
  const want = applyPolicyCommand(GatePolicy.parse(parse(before)), cmd);
  if (JSON.stringify(parsed.data) !== JSON.stringify(want))
    throw new Error("the edited gate policy does not say what the owner asked, and only that");
  if (JSON.stringify(without(before, cmd)) !== JSON.stringify(without(after, cmd)))
    throw new Error("the edit changes lines of the gate policy other than the one it is for");
  return parsed.data;
}
