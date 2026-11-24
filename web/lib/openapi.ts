// The public API as OpenAPI 3.1, for code generators and AI tool frameworks that read one. API.md is
// the full text; this says what each endpoint takes. Plain data with no imports, so
// tools/openapi-check.ts can load it and fail lint when a route under web/app/api/v1 is missing here.
// Answers are described in words, not schemas: their shapes are API.md's.

type Param = {
  name: string;
  in: "path" | "query";
  required?: boolean;
  description: string;
  schema: Record<string, unknown>;
};

const AT: Param = {
  name: "at",
  in: "query",
  description:
    "A block height, or a UTC date YYYY-MM-DD: the record as Blocklore stated it then (Time machine in API.md).",
  schema: { type: "string", pattern: "^(\\d{1,7}|\\d{4}-\\d{2}-\\d{2})$" },
};

const path = (name: string, description: string, pattern?: string): Param => ({
  name,
  in: "path",
  required: true,
  description,
  schema: pattern ? { type: "string", pattern } : { type: "string" },
});

const ok = (description: string) => ({
  "200": { description, content: { "application/json": { schema: { type: "object" } } } },
});
const missing = { "404": { description: "No such record." } };
const tooLong = { "413": { description: "The body is limited to 2000 characters." } };
const busy = {
  "429": { description: "Too many from this address for now; try later." },
  "503": { description: "Not available right now." },
};

const body = (properties: Record<string, unknown>, required: string[]) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", properties, required, additionalProperties: false },
    },
  },
});

const get = (summary: string, answer: string, parameters: Param[] = [], notFound = false) => ({
  get: {
    summary,
    parameters,
    responses: { ...ok(answer), ...(notFound ? missing : {}) },
  },
});

/** Routes under web/app/api/v1 that are the devbox's own channel, not the public API. */
export const INTERNAL = [
  "/api/v1/queue/pull",
  "/api/v1/queue/status",
  "/api/v1/reports/pull",
  "/api/v1/reports/status",
];

export function openapi(server: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Blocklore API",
      version: "v1",
      summary: "A library of Bitcoin facts that checks itself.",
      description:
        "Read-only and keyless, except three POSTs that take a reader's search, question or report. Every answer carries the edition it was compiled from. The store is CC BY 4.0: credit Blocklore and link each claim's URL. The full reference is API.md (/about/api).",
      license: { name: "CC BY 4.0 (the store); MIT (the code)", identifier: "CC-BY-4.0" },
    },
    servers: [{ url: server }],
    externalDocs: { url: `${server}/about/api` },
    paths: {
      "/api/v1": get("The endpoints, the edition and the license note", "The API's own index."),
      "/api/v1/openapi.json": get("This description", "OpenAPI 3.1."),
      "/api/v1/claims": get(
        "Every published claim in brief",
        "id, url, statement, kind, topics, depth, status, confidence, last verified, counts of sources and checks.",
      ),
      "/api/v1/claims/{id}": get(
        "One claim's whole record",
        "Sources with locators and quotes, checks, every revision with what it said before. A withdrawn claim comes back with status withdrawn.",
        [path("id", "A claim id, <topic>.<slug>.", "^[a-z0-9-]+\\.[a-z0-9-]+$"), AT],
        true,
      ),
      "/api/v1/claims/{id}/reports": {
        ...get(
          "Reader reports on one claim and their outcomes",
          "Each report's kind, dates, count and what the brain found; never a reader's note.",
          [path("id", "A claim id.")],
          true,
        ),
        post: {
          summary: "Report a problem with a claim",
          parameters: [path("id", "A claim id.")],
          requestBody: body(
            {
              kind: {
                type: "string",
                enum: ["wrong", "outdated", "unsupported", "broken-link", "unclear"],
              },
              note: { type: "string", maxLength: 500 },
            },
            ["kind"],
          ),
          responses: {
            ...ok("{added, report}: added is false when the same kind was already reported."),
            "400": {
              description: "Not a valid report, or the note looks like it holds a secret.",
            },
            ...missing,
            ...tooLong,
            ...busy,
          },
        },
      },
      "/api/v1/topics": get(
        "Every published topic",
        "Title, group, lede, claim count, how many claims wait for closer checks.",
      ),
      "/api/v1/topics/{slug}": get(
        "One topic",
        "Its sections in order, each claim in brief, and the concept to code ladder of its sources.",
        [path("slug", "A topic slug.", "^[a-z0-9-]+$"), AT],
        true,
      ),
      "/api/v1/changes": get(
        "Change events, newest first",
        "Each claim published, corrected, refined or withdrawn, with its time and block height.",
        [
          {
            name: "since",
            in: "query",
            description: "Only events stamped after this block height.",
            schema: { type: "integer", minimum: 0 },
          },
          {
            name: "topic",
            in: "query",
            description: "Only events filed under this topic (404 for a slug that is not one).",
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            description: "1 to 500, default 100.",
            schema: { type: "integer", minimum: 1, maximum: 500 },
          },
        ],
        true,
      ),
      "/api/v1/search": {
        get: {
          summary: "How to search",
          responses: {
            "405": { description: "Search is a POST; the answer says how to send it." },
          },
        },
        post: {
          summary: "Claims ranked by BM25 for a query",
          description: "The text goes in the body so it never lands in a URL. GET answers 405.",
          requestBody: body(
            {
              q: { type: "string", maxLength: 2000 },
              limit: { type: "integer", minimum: 1, maximum: 50 },
            },
            ["q"],
          ),
          responses: {
            ...ok("Claims in brief, each with its score."),
            "400": { description: "No query, or one that looks like it holds a secret." },
            ...tooLong,
          },
        },
      },
      "/api/v1/queue": {
        ...get(
          "Reader questions the brain or the owner triaged",
          "Items being researched or answered (with the claims that answer them), and how many wait.",
        ),
        post: {
          summary: "Suggest a question for research",
          requestBody: body({ q: { type: "string", maxLength: 300 } }, ["q"]),
          responses: {
            ...ok("{queued, item}: queued is false when the question was already there."),
            "400": {
              description: "Not a question, or one that looks like it holds a secret.",
            },
            ...tooLong,
            ...busy,
          },
        },
      },
      "/api/v1/reports": get(
        "Every reader report and its outcome",
        "Newest first, with the claim's statement and counts by outcome. Never a reader's note.",
      ),
      "/api/v1/bips": get(
        "The BIP index at a commit",
        "Each BIP's link at that commit, the claims citing it, and every change seen since the first reading.",
      ),
      "/api/v1/bips/{n}": get(
        "One BIP as its page shows it",
        "The entry at the index's commit, its recorded changes, the claims citing it, the code they cite, and Bitcoin Core's own entry for it in doc/bips.md.",
        [path("n", "A BIP number.", "^\\d{1,4}$")],
        true,
      ),
      "/api/v1/bolts": get(
        "The Lightning specification's index at a commit",
        "Each BOLT as BOLT #0 lists it, its link and the SHA-256 of its text at that commit, the claims citing it, and every change seen since the first reading.",
      ),
      "/api/v1/bolts/{n}": get(
        "One BOLT as its page shows it",
        "The entry at the index's commit, the claims citing it by topic and depth, the code they cite, and each change seen to its title or text.",
        [path("n", "A BOLT number, without a leading zero.", "^\\d{1,2}$")],
        true,
      ),
      "/api/v1/signaling": get(
        "Version bits this difficulty period and the last",
        "Counts and shares per deployment bit, BIP 320's general purpose bits apart, read from two explorers that must agree. Never a forecast.",
      ),
      "/api/v1/debates": get(
        "Every published debate map in brief",
        "Question, topics, positions with their claim counts; then the maps the owner withdrew, with when and why.",
      ),
      "/api/v1/debates/{slug}": get(
        "One debate map",
        "Positions with their attributed, dated claims; the evidence and definitions the sides share; how the claims bear on each other. A map the owner withdrew answers with status withdrawn and its withdrawal.",
        [path("slug", "A debate slug.", "^[a-z0-9-]+$")],
        true,
      ),
      "/api/v1/snapshots": get(
        "Every sealed edition, newest first",
        "Block, commit, Merkle root, previous root, count, and what its OpenTimestamps proof says.",
      ),
      "/api/v1/gaps": get(
        "What Blocklore does not cover yet",
        "Per topic: thin depths, questions from the test set it cannot answer, claims to correct.",
      ),
      "/api/v1/brain": get(
        "The research brain, live",
        "What it is doing now, what comes next, what it did in the last day, and whether that copy is fresh.",
      ),
    },
  };
}
