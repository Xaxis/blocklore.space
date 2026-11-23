// The owner's gate policy in the admin (ADMIN.md, "Gate policy"): what the page shows and the
// commands that change brain/policy/topics.yaml (EDITORIAL.md, "The evaluator"; SECURITY.md, T3).
//
//   policy     the file: per topic, whether it is contested and whether it is safety advice, and
//              the contested terms that hold a claim on any topic. A topic it does not list counts
//              as contested, so every claim on it waits for the evaluator.
//   view       the daemon builds it from its own checkout (brain/src/policy.ts) and sends it on its
//              sync; the site keeps it in ctl:policy. Every topic on the agenda or published, its
//              flags as the file sets them (or none), how many claims on it wait now, the terms.
//   commands   set a topic's two flags (listing it when the file does not), add or remove a term.
//              The site checks each against the view the owner was shown, the daemon again against
//              its checkout (policyCommandProblem), and only the daemon's job writes the file.
//
// Pure: everything comes in as arguments.
import { z } from "zod";
import { slug } from "./schema.ts";
import { detectSecrets, SECRET_LABEL } from "./secrets.ts";
import { hasDash } from "./style.ts";

/** A topic's two flags as the file sets them. */
export const GateFlags = z.strictObject({ contested: z.boolean(), safety: z.boolean() });
export type GateFlags = z.infer<typeof GateFlags>;

/** brain/policy/topics.yaml as the publisher, the evaluator and review read it. */
export const GatePolicy = z.strictObject({
  topics: z.record(z.string(), GateFlags),
  contested_terms: z.array(z.string()),
});
export type GatePolicy = z.infer<typeof GatePolicy>;

export const TERM_MAX = 40;

/** Characters that end a line or are not text: a term is one line of words. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Why `term` cannot be a contested term, or null when it can: nothing that looks like a secret
 * (asked first, as of all text Blocklore takes in), 1 to 40 characters on one line, with a letter
 * or digit and no dash the style check refuses. The command's schema, the site and the page all
 * ask this.
 */
export function termProblem(term: string): string | null {
  const t = term.trim();
  const secrets = detectSecrets(t);
  if (secrets.length)
    return `That looks like ${secrets.map((s) => SECRET_LABEL[s.kind]).join(" and ")}. Blocklore never stores seeds, keys, addresses or contact details.`;
  if (!t) return "Write the term.";
  if (t.length > TERM_MAX) return `A term is at most ${TERM_MAX} characters.`;
  if (CONTROL.test(t)) return "A term is one line, with no control characters.";
  if (!/[\p{L}\p{N}]/u.test(t)) return "A term needs a letter or a digit.";
  if (hasDash(t)) return "Use a hyphen or a space: the style check refuses that dash.";
  return null;
}

export const ContestedTerm = z
  .string()
  .max(200)
  .superRefine((s, ctx) => {
    const why = termProblem(s);
    if (why) ctx.addIssue({ code: "custom", message: why });
  })
  .transform((s) => s.trim());

const topicSlug = slug.max(63);

/** The owner's two changes to the gate policy, each a signed command the daemon runs as a job. */
export const POLICY_COMMANDS = [
  /** Set a topic's flags; a topic the file does not list is added under `topics:`. */
  z.strictObject({
    type: z.literal("policy.topic"),
    slug: topicSlug,
    contested: z.boolean(),
    safety: z.boolean(),
  }),
  /** Add a term to `contested_terms`, or remove one. */
  z.strictObject({ type: z.literal("policy.term"), term: ContestedTerm, add: z.boolean() }),
] as const;

export type PolicyCommand = z.infer<(typeof POLICY_COMMANDS)[number]>;

export const POLICY_COMMAND_TYPES: ReadonlySet<string> = new Set(
  POLICY_COMMANDS.map((c) => c.shape.type.value),
);

export function isPolicyCommand(cmd: { type: string }): cmd is PolicyCommand {
  return POLICY_COMMAND_TYPES.has(cmd.type);
}

// ---------------------------------------------------------------------------------------------
// The view

export const PolicyTopicView = z.object({
  slug: topicSlug,
  title: z.string().max(200),
  agenda: z.boolean(),
  published: z.boolean(),
  /** The file's flags; null when it does not list the topic, which counts as contested. */
  listed: GateFlags.nullable(),
  /** Claims whose first topic this is, waiting for the evaluator now. */
  waiting: z.number().int().min(0),
});
export type PolicyTopicView = z.infer<typeof PolicyTopicView>;

export const GatePolicyView = z.object({
  /** The daemon's checkout the view was built from. */
  head: z.string().max(64),
  /** The agenda's topics in its order, then published topics it lacks, then the file's others. */
  topics: z.array(PolicyTopicView).max(500),
  /** The contested terms in the file's order. */
  terms: z.array(z.string().max(1000)).max(1000),
  /** Every claim waiting for the evaluator now. */
  waiting: z.number().int().min(0),
});
export type GatePolicyView = z.infer<typeof GatePolicyView>;

export function gatePolicyView(input: {
  policy: GatePolicy;
  agenda: readonly { slug: string; title: string }[];
  published: readonly { slug: string; title: string }[];
  /** Waiting claims by their first topic. */
  waiting: ReadonlyMap<string, number>;
  head: string;
}): GatePolicyView {
  const onAgenda = new Set(input.agenda.map((t) => t.slug));
  const published = new Map(input.published.map((t) => [t.slug, t.title]));
  const titles = new Map([...published, ...input.agenda.map((t) => [t.slug, t.title] as const)]);
  const order = [
    ...new Set([
      ...input.agenda.map((t) => t.slug),
      ...input.published.map((t) => t.slug),
      ...Object.keys(input.policy.topics),
    ]),
  ].filter((s) => topicSlug.safeParse(s).success);
  return {
    head: input.head,
    topics: order.map((s) => ({
      slug: s,
      title: titles.get(s) ?? s,
      agenda: onAgenda.has(s),
      published: published.has(s),
      listed: input.policy.topics[s] ?? null,
      waiting: input.waiting.get(s) ?? 0,
    })),
    terms: [...input.policy.contested_terms],
    waiting: [...input.waiting.values()].reduce((a, b) => a + b, 0),
  };
}

/** The flags in words, as the page and the commit say them. */
export function flagsText(f: GateFlags): string {
  if (f.contested && f.safety) return "contested and safety advice";
  if (f.contested) return "contested";
  if (f.safety) return "safety advice";
  return "neither contested nor safety advice";
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Why a command does not fit the policy as this view shows it, or null when it does. The site asks
 * it of the view the owner was shown, the daemon of its checkout just before it edits the file.
 */
export function policyCommandProblem(cmd: PolicyCommand, view: GatePolicyView): string | null {
  switch (cmd.type) {
    case "policy.topic": {
      const t = view.topics.find((x) => x.slug === cmd.slug);
      if (!t || !(t.agenda || t.published))
        return `${cmd.slug} is neither on the agenda nor published.`;
      if (t.listed && t.listed.contested === cmd.contested && t.listed.safety === cmd.safety)
        return `The gate policy already sets ${cmd.slug} as ${flagsText(t.listed)}.`;
      return null;
    }
    case "policy.term": {
      const has = view.terms.find((x) => same(x, cmd.term));
      if (cmd.add)
        return has === undefined
          ? null
          : `${has === cmd.term ? cmd.term : `${cmd.term} (as ${has})`} is already a contested term; terms match whatever their case.`;
      return view.terms.includes(cmd.term) ? null : `${cmd.term} is not a contested term.`;
    }
  }
}

/** The policy with one command applied, as plain data: what the edited file must parse to. */
export function applyPolicyCommand(policy: GatePolicy, cmd: PolicyCommand): GatePolicy {
  if (cmd.type === "policy.topic")
    return {
      ...policy,
      topics: {
        ...policy.topics,
        [cmd.slug]: { contested: cmd.contested, safety: cmd.safety },
      },
    };
  const at = policy.contested_terms.indexOf(cmd.term);
  return {
    ...policy,
    contested_terms: cmd.add
      ? [...policy.contested_terms, cmd.term]
      : policy.contested_terms.filter((_, i) => i !== at),
  };
}
