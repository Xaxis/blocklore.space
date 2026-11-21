// The owner's side of the human gate (EDITORIAL.md, "The human gate"). Only a person runs approve
// or reject: the owner from the admin (a signed command the daemon applies, ADMIN.md) or from this
// CLI. The brain and its roles never do on their own (CLAUDE.md).
//
//   pnpm review                         list what waits, by topic
//   pnpm review show <id>               one claim in full, with its checks and verdict
//   pnpm review approve <id>... [--note "..."]
//   pnpm review approve --topic <slug> [--note "..."]
//   pnpm review reject <id> --reason "..."
import path from "node:path";
import type { Claim, Run, Store } from "@blocklore/core";
import { candidateHash } from "@blocklore/core/control";
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
  console.log(`  content hash: ${candidateHash(p.candidate)}`);
  c.sources.forEach((s, i) => {
    console.log(`\n  [${i}] ${s.tier} ${s.kind}: ${s.title}`);
    if (s.url) console.log(`      ${s.url}`);
    console.log(`      ${s.locator}`);
    if (s.quote) console.log(`      "${s.quote}"`);
  });
  for (const k of c.checks ?? []) console.log(`\n  check: ${JSON.stringify(k)}`);
}

/**
 * Which pending claims an owner's decision covers, each exactly as the owner saw it: every id must
 * still wait, and when a hash is given it must be the hash of the pending candidate now. An error
 * names what moved, and nothing is touched.
 */
export function choose(
  pending: Pending[],
  items: Array<{ id: string; hash?: string }>,
): { ok: true; chosen: Pending[] } | { ok: false; error: string } {
  if (items.length === 0) return { ok: false, error: "name at least one claim" };
  const byId = new Map(pending.map((p) => [p.candidate.id, p]));
  const missing = items.filter((i) => !byId.has(i.id)).map((i) => i.id);
  if (missing.length)
    return {
      ok: false,
      error: `no longer waiting for review: ${missing.join(", ")} (approved, rejected or replaced since you looked)`,
    };
  const changed = items
    .filter((i) => i.hash && candidateHash((byId.get(i.id) as Pending).candidate) !== i.hash)
    .map((i) => i.id);
  if (changed.length)
    return {
      ok: false,
      error: `changed since you looked: ${changed.join(", ")}. Reload and decide again; nothing was approved or rejected.`,
    };
  return { ok: true, chosen: items.map((i) => byId.get(i.id) as Pending) };
}

/** Publishes held claims, as the owner. Returns the exit code; throws when an item moved. */
export async function approve(
  items: Array<{ id: string; hash?: string }>,
  note?: string,
): Promise<number> {
  const c = choose(readPending(), items);
  if (!c.ok) throw new Error(c.error);
  const chosen = c.chosen;
  const chain = chainSource();
  const now = await nowStamp(chain);
  const policy = loadPolicy();
  const { store } = loadStore();
  const claims = new Map(store.claims.map((x) => [x.id, x]));

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

/** Records the owner's rejection of held claims. Returns the exit code; throws when an item moved. */
export async function reject(
  items: Array<{ id: string; hash?: string }>,
  reason: string,
): Promise<number> {
  if (!reason.trim()) throw new Error('a rejection says why: --reason "..."');
  const c = choose(readPending(), items);
  if (!c.ok) throw new Error(c.error);
  const chosen = c.chosen;
  const chain = chainSource();
  const now = await nowStamp(chain);
  const { store } = loadStore();
  const claims = new Map(store.claims.map((x) => [x.id, x]));
  const runId = `${now.time.slice(0, 10)}-review`;
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
  const code = commitStore(
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
  if (code !== 0) for (const p of chosen) writePending(p);
  return code;
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
  if (ids.length === 0) throw new Error("name at least one id, or --topic <slug>");
  const items = ids.map((id) => ({ id }));
  if (sub === "reject") return reject(items, reason ?? "");
  return approve(items, note);
}
