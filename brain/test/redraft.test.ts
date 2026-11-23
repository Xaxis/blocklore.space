import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectedOnTopic, rejectedSection } from "../src/redraft.ts";

type Stage = { stage: "recheck" | "rules" | "verifier-a"; ok: boolean | null; detail: string };

const d = (
  id: string,
  at: string,
  outcome: "publish" | "reject" | "hold",
  stages: Stage[],
  extra: { topic?: string; canary?: unknown } = {},
) => ({
  id,
  topic: extra.topic ?? "taproot",
  statement: `Statement of ${id}.`,
  at: `2026-11-${at}T10:00:00Z`,
  canary: (extra.canary ?? null) as never,
  outcome,
  stages: stages as never,
});

const ok: Stage = { stage: "recheck", ok: true, detail: "found again" };
const byRule = (detail: string): Stage[] => [ok, { stage: "rules", ok: false, detail }];
const PERSON = "person attributed: Murch: not attributed with a link to where they said or did it";

test("a draft the rules rejected is listed with each rule it broke", () => {
  const got = rejectedOnTopic(
    [
      d(
        "taproot.utxo-share",
        "20",
        "reject",
        byRule(
          `${PERSON}; independent sources: safety advice needs two independent sources supporting it; it has 1 (github.com/bitcoin)`,
        ),
      ),
    ],
    "taproot",
    new Set(),
  );
  assert.deepEqual(got, [
    {
      id: "taproot.utxo-share",
      statement: "Statement of taproot.utxo-share.",
      at: "2026-11-20T10:00:00Z",
      rules: [
        {
          rule: "person attributed",
          detail: "Murch: not attributed with a link to where they said or did it",
        },
        {
          rule: "independent sources",
          detail:
            "safety advice needs two independent sources supporting it; it has 1 (github.com/bitcoin)",
        },
      ],
    },
  ]);
});

test("verifier rejections, canaries, holds, other topics and taken ids are left out", () => {
  const got = rejectedOnTopic(
    [
      // A verifier's words are a model's: never passed on.
      d("taproot.by-verifier", "20", "reject", [
        ok,
        { stage: "rules", ok: true, detail: "held: every rule" },
        { stage: "verifier-a", ok: false, detail: "reject: the quote says otherwise" },
      ]),
      d("taproot.canary", "20", "reject", byRule(PERSON), {
        canary: { kind: "number", source: "x" },
      }),
      d("taproot.held", "20", "hold", [ok, { stage: "rules", ok: null, detail: PERSON }]),
      d("lightning.elsewhere", "20", "reject", byRule(PERSON), { topic: "lightning" }),
      d("taproot.published-since", "20", "reject", byRule(PERSON)),
      d("taproot.waiting-again", "20", "reject", byRule(PERSON)),
    ],
    "taproot",
    new Set(["taproot.published-since", "taproot.waiting-again"]),
  );
  assert.deepEqual(got, []);
});

test("the latest decision on an id counts: a later publish clears an earlier rejection", () => {
  const got = rejectedOnTopic(
    [
      d("taproot.fixed", "19", "reject", byRule(PERSON)),
      d("taproot.fixed", "21", "publish", [ok, { stage: "rules", ok: true, detail: "held" }]),
      d("taproot.broke-later", "19", "publish", [ok]),
      d("taproot.broke-later", "22", "reject", byRule(PERSON)),
    ],
    "taproot",
    new Set(),
  );
  assert.deepEqual(
    got.map((r) => r.id),
    ["taproot.broke-later"],
  );
});

test("newest first, at most eight, and long statements are cut in the section", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    d(`taproot.c${String(i).padStart(2, "0")}`, String(10 + i), "reject", byRule(PERSON)),
  );
  const got = rejectedOnTopic(many, "taproot", new Set());
  assert.equal(got.length, 8);
  assert.equal(got[0]?.id, "taproot.c11");
  assert.equal(got[7]?.id, "taproot.c04");

  const long = { ...got[0], statement: "x".repeat(400) } as (typeof got)[number];
  const lines = rejectedSection([long]);
  assert.equal(lines[0], "## Drafts on this topic the evaluator rejected by rule");
  const item = lines.find((l) => l.startsWith("- `taproot.c11`"));
  assert.ok(item?.endsWith("..."));
  assert.ok((item?.length ?? 0) < 330);
  assert.ok(
    lines.includes(
      "  - person attributed: Murch: not attributed with a link to where they said or did it",
    ),
  );
  assert.deepEqual(rejectedSection([]), []);
});
