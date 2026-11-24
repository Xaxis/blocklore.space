// The owner's links between published claims and threats, changed from the admin (ADMIN.md, "Threat
// map"). Each command is one edit of one threat's file (knowledge/security/threats/<id>.yaml) as a
// YAML document, touching one of its two lists and nothing else; the job (brain/src/jobs.ts)
// formats it, checks it here (it parses as a threat, says what the owner asked and changes no
// other line), and only then writes and commits it. The view the admin shows comes from here too,
// built from this checkout.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  applyThreatCommand,
  hasDash,
  Threat,
  type ThreatAdminView,
  type ThreatCommand,
  threatAdminView,
  threatCommandMessage,
  threatCommandProblem,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, type YAMLSeq } from "yaml";
import { KNOWLEDGE } from "../env.ts";

const THREATS_DIR = () => path.join(KNOWLEDGE, "security", "threats");

/** A threat's file; the loader requires the file name to be its id. */
export function threatFile(id: string): string {
  return path.join(THREATS_DIR(), `${id}.yaml`);
}

/** When a threat file last changed on disk, so the daemon rebuilds the view only then. */
export function threatsStamp(): string {
  try {
    const dir = THREATS_DIR();
    return readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => statSync(path.join(dir, f)).mtimeMs)
      .reduce((a, b) => Math.max(a, b), statSync(dir).mtimeMs)
      .toString();
  } catch {
    return "none";
  }
}

/** The threat map, the published claims and code's suggestions as this checkout has them now. */
export function threatView(head: string): ThreatAdminView {
  const { store } = loadStore(KNOWLEDGE);
  const threats = store.security?.threats;
  if (!threats) throw new Error("the store has no security section");
  return threatAdminView({
    threats,
    claims: store.claims.filter((c) => c.status !== "withdrawn"),
    all: store.claims,
    head,
  });
}

/** The list the command names, as a node of the document. */
function list(doc: ReturnType<typeof parseDocument>, part: ThreatCommand["part"]): YAMLSeq {
  const node = doc.get(part, true);
  if (!isSeq(node)) throw new Error(`the threat's file has no ${part} list`);
  return node;
}

/**
 * The threat's text with one command applied, and the sentence its commit says. Throws, changing
 * nothing, when the command does not fit the map as `view` (this checkout, now) shows it. The list
 * stays a flow list `[a, b]`, as every threat file writes it.
 */
export function editThreat(
  text: string,
  cmd: ThreatCommand,
  view: ThreatAdminView,
): { text: string; message: string } {
  const problem = threatCommandProblem(cmd, view);
  if (problem) throw new Error(problem);
  const doc = parseDocument(text);
  if (doc.errors.length)
    throw new Error(`the threat's file does not parse: ${doc.errors[0]?.message}`);
  if (doc.get("id") !== cmd.threat) throw new Error(`the file is not the threat ${cmd.threat}`);
  const seq = list(doc, cmd.part);
  if (cmd.type === "threat.link") {
    seq.add(new Scalar(cmd.claim));
  } else {
    const i = seq.items.findIndex((n) => isScalar(n) && n.value === cmd.claim);
    if (i < 0) throw new Error(`${cmd.threat} does not list ${cmd.claim} under ${cmd.part}`);
    seq.items.splice(i, 1);
  }
  seq.flow = true;
  return {
    text: doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
    message: threatCommandMessage(cmd),
  };
}

/** `text`'s lines without the lines of the command's list (its key and its value). */
function withoutList(text: string, part: ThreatCommand["part"]): string[] {
  const lines = text.split("\n");
  const doc = parseDocument(text);
  const pair = isMap(doc.contents)
    ? doc.contents.items.find((p) => isScalar(p.key) && p.key.value === part)
    : undefined;
  const from = isScalar(pair?.key) ? pair.key.range?.[0] : undefined;
  const to = (pair?.value as { range?: [number, number, number] } | null)?.range?.[1];
  if (from === undefined || to === undefined) return lines;
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length - 1;
  return [...lines.slice(0, lineOf(from)), ...lines.slice(lineOf(to - 1) + 1)];
}

/**
 * The edited text as the job is about to write it: it must parse as a threat, be exactly the
 * threat before with the command applied, hold no dash the style check refuses, and differ from
 * the text before only in the lines of the list the command names.
 */
export function checkThreat(before: string, after: string, cmd: ThreatCommand): Threat {
  let raw: unknown;
  try {
    raw = parse(after);
  } catch (e) {
    throw new Error(`the edited threat does not parse: ${(e as Error).message}`);
  }
  const parsed = Threat.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `the edited threat does not match its schema: ${parsed.error.issues[0]?.message}`,
    );
  const want = applyThreatCommand(Threat.parse(parse(before)), cmd);
  if (JSON.stringify(parsed.data) !== JSON.stringify(want))
    throw new Error("the edited threat does not say what the owner asked, and only that");
  if (hasDash(after)) throw new Error("the edited threat holds a dash the style check refuses");
  if (
    JSON.stringify(withoutList(before, cmd.part)) !== JSON.stringify(withoutList(after, cmd.part))
  )
    throw new Error("the edit changes lines of the threat other than the list it is for");
  return parsed.data;
}
