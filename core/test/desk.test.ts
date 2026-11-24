import assert from "node:assert/strict";
import { test } from "node:test";
import { DESK, DESK_THREATS, deskIssues, deskView } from "../src/desk.ts";
import { loadStore } from "../src/node/index.ts";
import { securityView, type Threat } from "../src/security.ts";

const threat = (id: string, over: Partial<Threat> = {}): Threat => ({
  id,
  title: `The threat ${id}`,
  layer: "people",
  status: "open",
  topic: "self-custody",
  claims: [],
  mitigations: [],
  history: [],
  watches: [],
  lab: [],
  terms: [],
  ...over,
});

test("every threat the desk names is on the real threat map, once, and no person-facing threat is left off", () => {
  const { store } = loadStore();
  const threats = store.security?.threats ?? [];
  assert.deepEqual(deskIssues(threats), []);
  assert.equal(new Set(DESK_THREATS).size, DESK_THREATS.length);
  // The people layer is about people by definition; the desk must show all of it.
  for (const t of threats.filter((x) => x.layer === "people"))
    assert.ok(DESK_THREATS.includes(t.id), `${t.id} is in the people layer but not on the desk`);
});

test("a desk threat missing from the map is reported, so renaming a threat cannot silently empty the desk", () => {
  const all = DESK_THREATS.map((id) => threat(id));
  assert.deepEqual(deskIssues(all), []);
  const [gone, ...rest] = all;
  assert.deepEqual(
    deskIssues(rest).map((i) => i.message),
    [`names ${gone?.id}, which is not on the threat map`],
  );
});

test("the desk shows each model's threats in its order, as the map has them, and counts what is explained", () => {
  const ids = DESK_THREATS;
  const threats = ids.map((id) =>
    id === "phishing"
      ? threat(id, { claims: ["self-custody.a"], mitigations: ["self-custody.b"] })
      : id === "physical-coercion"
        ? threat(id, { claims: ["self-custody.c"] })
        : threat(id),
  );
  const published = new Set(["self-custody.a", "self-custody.b", "self-custody.c"]);
  const view = deskView(securityView({ threats, watches: null, lab: null }, published));
  assert.deepEqual(
    view.models.map((m) => [m.id, m.threats.map((t) => t.id)]),
    DESK.map((m) => [m.id, [...m.threats]]),
  );
  assert.deepEqual(view.counts, { threats: ids.length, explained: 1, claims: 3 });
  const coercion = view.models
    .find((m) => m.id === "where-you-are")
    ?.threats.find((t) => t.id === "physical-coercion");
  assert.deepEqual(coercion?.missing, ["mitigations"]);
});
