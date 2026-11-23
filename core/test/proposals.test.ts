import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseProposals } from "../src/proposals.ts";

const scope = "A scope long enough to pass the schema's minimum length.";

test("the committed proposals all fit the agenda's schema", () => {
  const text = readFileSync(
    path.join(import.meta.dirname, "..", "..", "brain", "agenda", "proposed.yaml"),
    "utf8",
  );
  const raw = (text.match(/^ {2}- slug:/gm) ?? []).length;
  const parsed = parseProposals(text);
  assert.ok(raw > 0);
  assert.equal(parsed.length, raw, "every proposal in the file parses");
});

test("entries that do not fit are left out, and a slug counts once", () => {
  const text = `topics:
  - { slug: good, title: Good, group: protocol, scope: "${scope}" }
  - { slug: Bad Slug, title: Bad, group: protocol, scope: "${scope}" }
  - { slug: short, title: Short, group: protocol, scope: "too short" }
  - { slug: extra, title: Extra, group: protocol, scope: "${scope}", run: now }
  - { slug: good, title: Again, group: protocol, scope: "${scope}" }
`;
  assert.deepEqual(
    parseProposals(text).map((t) => [t.slug, t.title]),
    [["good", "Good"]],
  );
});

test("a file that is not a topic list gives no proposals", () => {
  assert.deepEqual(parseProposals("topics: [unclosed"), []);
  assert.deepEqual(parseProposals("just text"), []);
  assert.deepEqual(parseProposals(""), []);
  assert.deepEqual(parseProposals("topics: nope"), []);
});
