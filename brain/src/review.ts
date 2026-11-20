// The owner's side of the human gate (EDITORIAL.md, "The human gate"). Only a person runs approve
// or reject; the brain and its roles never do (CLAUDE.md).
//
//   pnpm review                         list what waits, by topic
//   pnpm review show <id>               one claim in full, with its checks and verdict
//   pnpm review approve <id>... [--note "..."]
//   pnpm review approve --topic <slug> [--note "..."]
//   pnpm review reject <id> --reason "..."
import path from "node:path";
import type { Claim, Run, Store } from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { chainSource } from "./chain.ts";
import { ROOT } from "./env.ts";
import { commitStore, createClaim, publicTopics, reviewCounts, updateClaim } from "./publish.ts";
import {
  loadPolicy,
  nowStamp,
  type Pending,
  readPending,
  removePending,
  toYaml,
  writePending,
} from "./store.ts";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function list(pending: Pending[]) {
  if (pending.length === 0) {
    console.log("Nothing waits for review.");
    return;
  }
  const byTopic = new Map<string, Pending[]>();
  for (const p of pending) {
    const t = p.candidate.topics[0] as string;
    byTopic.set(t, [...(byTopic.get(t) ?? []), p]);
  }
  for (const [topic, items] of byTopic) {
    console.log(`\n${topic} (${items.length})`);
    for (const p of items) {
      console.log(`  ${p.candidate.id}${p.updates ? "  [update]" : ""}`);
      console.log(`    ${p.candidate.statement}`);
      console.log(`    held: ${p.reasons.join("; ")}`);
    }
  }
  console.log(
    `\n${pending.length} waiting. pnpm review show <id>, approve <id>..., approve --topic <slug>, reject <id> --reason "..."`,
  );
}

function show(p: Pending) {
  const c = p.candidate;
  console.log(`${c.id}  (${c.kind}, ${c.depth}, ${c.status}, ${c.confidence})`);
  console.log(`\n  ${c.statement}\n`);
  if (c.attributed_to?.length)
    console.log(
      `  attributed to: ${c.attributed_to.map((a) => `${a.name}${a.url ? ` <${a.url}>` : ""}`).join("; ")}`,
    );
  console.log(`  held because: ${p.reasons.join("; ")}`);
  console.log(`  run ${p.run}; checks: ${p.method}`);
  console.log(`  verifier: ${p.verdict.verdict}: ${p.verdict.reason}`);
  c.sources.forEach((s, i) => {
    console.log(`\n  [${i}] ${s.tier} ${s.kind}: ${s.title}`);
    if (s.url) console.log(`      ${s.url}`);
    console.log(`      ${s.locator}`);
    if (s.quote) console.log(`      "${s.quote}"`);
  });
  for (const k of c.checks ?? []) console.log(`\n  check: ${JSON.stringify(k)}`);
}

export async function review(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const pending = readPending();
  if (!sub || sub === "list") {
    list(pending);
    return 0;
  }
  if (sub === "show") {
    const p = pending.find((x) => x.candidate.id === rest[0]);
    if (!p) throw new Error(`nothing pending with id ${rest[0]}`);
    show(p);
    return 0;
  }
  if (sub !== "approve" && sub !== "reject") throw new Error(`unknown review command ${sub}`);

  const note = flag(rest, "--note");
  const reason = flag(rest, "--reason");
  const topic = flag(rest, "--topic");
  const ids = topic
    ? pending.filter((p) => p.candidate.topics[0] === topic).map((p) => p.candidate.id)
    : rest.filter(
        (a, i) =>
          !a.startsWith("--") && !["--note", "--reason", "--topic"].includes(rest[i - 1] ?? ""),
      );
  const chosen = ids.map((id) => {
    const p = pending.find((x) => x.candidate.id === id);
    if (!p) throw new Error(`nothing pending with id ${id}`);
    return p;
  });
  if (chosen.length === 0) throw new Error("name at least one id, or --topic <slug>");

  const chain = chainSource();
  const now = await nowStamp(chain);
  const policy = loadPolicy();
  const { store } = loadStore();
  const claims = new Map(store.claims.map((c) => [c.id, c]));
  const runId = `${now.time.slice(0, 10)}-review`;

  if (sub === "reject") {
    if (!reason) throw new Error('a rejection says why: --reason "..."');
    for (const p of chosen) removePending(p.candidate.id);
    const log: Run = {
      id: runId,
      kind: "review",
      started: now,
      finished: now,
      agent: "the owner",
      summary: `The owner rejected ${chosen.length} claim(s) held for review.`,
      read: [],
      published: [],
      revised: [],
      rejected: chosen.map((p) => ({
        statement: `(${p.candidate.topics[0]}: withheld, rejected at review)`,
        reason,
      })),
      gated: [],
      open: [],
      injections: [],
    };
    const newStore: Store = { ...store, review: reviewCounts(readPending()) };
    const file = path.join(
      ROOT,
      "knowledge",
      "runs",
      runId.slice(0, 4),
      `${runId}-${now.height}.yaml`,
    );
    return commitStore(
      {
        store: newStore,
        claims,
        writeClaims: [],
        extraFiles: [[file, toYaml(log)]],
        message: `Record the owner's rejection of ${chosen.length} held claim(s): ${reason}`,
      },
      now,
      { commit: true, push: false },
    );
  }

  const written: Claim[] = [];
  for (const p of chosen) {
    const rec = { reasons: p.reasons, by: "owner", at: now.time, ...(note ? { note } : {}) };
    const old = claims.get(p.candidate.id);
    const claim = old
      ? updateClaim(old, p.candidate, now, p.run, p.method, rec).claim
      : createClaim(p.candidate, now, p.run, p.method, rec);
    claims.set(claim.id, claim);
    written.push(claim);
  }
  for (const p of chosen) removePending(p.candidate.id);
  const newStore: Store = {
    ...store,
    claims: [...claims.values()],
    topics: publicTopics(store, claims, policy),
    review: reviewCounts(readPending()),
  };
  const topics = [...new Set(chosen.map((p) => p.candidate.topics[0]))].join(", ");
  const code = commitStore(
    {
      store: newStore,
      claims,
      writeClaims: written,
      extraFiles: [],
      message: `Publish ${written.length} claim(s) the owner reviewed and approved (${topics}).`,
    },
    now,
    { commit: true, push: false },
  );
  if (code !== 0) for (const p of chosen) writePending(p); // put them back
  return code;
}
