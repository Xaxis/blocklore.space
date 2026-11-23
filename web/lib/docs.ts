import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/** The rule documents at the repository root, rendered as pages under /about. */
export const DOCS = {
  editorial: {
    file: "EDITORIAL.md",
    title: "Editorial rules",
    blurb: "Voice, neutrality, depth levels, the evaluator and corrections.",
  },
  claims: {
    file: "CLAIMS.md",
    title: "What a claim is",
    blurb: "The schema every sentence follows, its sources, checks and revisions.",
  },
  sources: {
    file: "SOURCES.md",
    title: "Sources",
    blurb: "The four tiers, every registered source and how it is fetched.",
  },
  security: {
    file: "SECURITY.md",
    title: "Security",
    blurb: "Threats, the role sandbox, readers' privacy and how to report a problem.",
  },
  architecture: {
    file: "ARCHITECTURE.md",
    title: "Architecture",
    blurb: "How the store, the brain and the site fit together.",
  },
  api: {
    file: "API.md",
    title: "API and data",
    blurb: "Read-only JSON, search, the full export and llms.txt, free and without a key.",
  },
} as const;
export type DocSlug = keyof typeof DOCS;

export function readDoc(slug: DocSlug): string {
  return readFileSync(path.join(process.cwd(), "..", DOCS[slug].file), "utf8");
}
