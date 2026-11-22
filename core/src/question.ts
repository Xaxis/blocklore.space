// A reader's question, as the suggestion queue takes it: trimmed, bounded, and refused when it
// holds a secret, before anything else reads it. The site runs no model for readers; readers who
// want answers bring their own model over MCP (/connect).
import { detectSecrets, SECRET_LABEL } from "./secrets.ts";

export const QUESTION_MAX = 300;

export type ReadQuestion = { question: string } | { error: string; secret?: true };

/** A reader's question, trimmed and checked; secrets are refused before anything else sees it. */
export function readQuestion(input: unknown): ReadQuestion {
  if (typeof input !== "string") return { error: "Send the question as a string in q." };
  const question = input.replace(/\s+/g, " ").trim();
  if (!question) return { error: "Ask a question about Bitcoin." };
  const secrets = detectSecrets(question);
  if (secrets.length)
    return {
      secret: true,
      error: `That looks like ${secrets.map((s) => SECRET_LABEL[s.kind]).join(" and ")}. Blocklore never accepts seeds, keys or addresses, and it did not keep or send your question. If it is real, treat it as exposed.`,
    };
  if (question.length > QUESTION_MAX)
    return { error: `Questions are limited to ${QUESTION_MAX} characters.` };
  return { question };
}
