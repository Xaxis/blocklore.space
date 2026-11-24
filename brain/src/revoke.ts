// The owner's veto (EDITORIAL.md, "The evaluator"): withdrawing a published claim. Never a silent
// edit: the claim keeps its whole history and gains a `withdrawn` revision that says when and why,
// its status becomes withdrawn (the status before is kept in `before`), every topic drops it, and
// its own page says it was withdrawn. The reason also becomes a lesson for research (the daemon
// adds it, daemon.ts afterJob) and a canary case the evaluator must catch from then on.
//
// Only the owner revokes: from the admin (a signed `claim.revoke` command) or `pnpm review revoke`.
// The owner withdraws a whole debate map the same way (`debate.withdraw`): the map file keeps its
// nodes and gains a `withdrawn` record, every list drops it, its page says when and why, and no map
// publishes under its slug again. Its claims stay published; the reason becomes a lesson.
import path from "node:path";
import {
  type Claim,
  claimHash,
  compile,
  contentOf,
  type Debate,
  type Run,
  type Stamp,
  type Store,
  undash,
} from "@blocklore/core";
import { loadStore } from "@blocklore/core/node";
import { chainSource } from "./chain.ts";
import { debatePath, debateYaml, readWaitingDebates } from "./debates.ts";
import { KNOWLEDGE } from "./env.ts";
import { evaluatorFiles } from "./evaluator.ts";
import { commitStore, publicTopics } from "./publish.ts";
import { loadPolicy, nowStamp, toYaml } from "./store.ts";

/** The owner's reason as the record keeps it: one line, no dashes, at most 500 characters. */
export function revocationNote(reason: string): string {
  const clean = undash(reason.replace(/\s+/g, " ").trim()).replace(/[.\s]+$/, "");
  return `Withdrawn by the owner: ${clean.slice(0, 500)}.`;
}

/** The claim withdrawn at `now`: status withdrawn, a new revision saying why, nothing else changed. */
export function withdrawClaim(old: Claim, now: Stamp, run: string, reason: string): Claim {
  if (old.status === "withdrawn") throw new Error(`${old.id} is already withdrawn`);
  return {
    ...old,
    status: "withdrawn",
    last_verified: { ...now, run, method: "withdrawn by the owner; not checked again" },
    revisions: [
      ...old.revisions,
      {
        rev: old.revisions.length + 1,
        at: now,
        run,
        change: "withdrawn",
        note: revocationNote(reason),
        before: { status: old.status },
      },
    ],
  };
}

/**
 * Withdraws a published claim at `now`. `hash` is the claim's hash as the owner saw it; when given,
 * a claim that changed since is left alone. Returns the exit code and a line for the owner.
 */
export function revokeAt(
  id: string,
  hash: string | null,
  reason: string,
  now: Stamp,
  opts: { commit: boolean; push: boolean },
): { code: number; message: string } {
  if (reason.trim().length < 3) return { code: 1, message: "a revocation says why" };
  const { store } = loadStore(KNOWLEDGE);
  const old = store.claims.find((c) => c.id === id);
  if (!old) return { code: 1, message: `no published claim ${id}` };
  if (old.status === "withdrawn") return { code: 1, message: `${id} is already withdrawn` };
  if (hash && claimHash(old) !== hash)
    return {
      code: 1,
      message: `${id} changed since you looked (it has a newer revision); reload and decide again. Nothing was withdrawn.`,
    };
  const run = `${now.time.slice(0, 10)}-revoke-${id.replace(/\./g, "-")}`.slice(0, 120);
  const claim = withdrawClaim(old, now, run, reason);
  const claims = new Map(store.claims.map((c) => [c.id, c]));
  claims.set(id, claim);
  const newStore: Store = {
    ...store,
    claims: [...claims.values()],
    topics: publicTopics(store, claims, loadPolicy()),
  };
  const note = revocationNote(reason);
  const log: Run = {
    id: run,
    kind: "review",
    started: now,
    finished: now,
    agent: "the owner",
    summary: `The owner withdrew ${id}. ${note}`.slice(0, 1200),
    read: [],
    published: [],
    revised: [{ id, change: "withdrawn", note }],
    rejected: [],
    gated: [],
    open: [],
    injections: [],
  };
  const code = commitStore(
    {
      store: newStore,
      claims,
      writeClaims: [claim],
      extraFiles: [[path.join(KNOWLEDGE, "runs", run.slice(0, 4), `${run}.yaml`), toYaml(log)]],
      message: `Withdraw ${id}, as the owner decided: ${note.replace(/^Withdrawn by the owner: /, "")}`,
    },
    now,
    opts,
  );
  if (code !== 0) {
    // The owner sees this line, not the job's log: say what stopped it.
    const first = compile(newStore, now).issues.find((i) => i.level === "error");
    return {
      code,
      message: `withdrawing ${id} failed; nothing changed${first ? `: ${first.message}` : ""}`,
    };
  }
  evaluatorFiles().addCase({ id, at: now.time, reason: note, claim: contentOf(old) });
  return { code, message: `withdrew ${id}; every topic dropped it and its page says why` };
}

/** The map withdrawn at `now`: everything kept, a `withdrawn` record added. */
export function withdrawDebateMap(old: Debate, now: Stamp, run: string, reason: string): Debate {
  if (old.withdrawn) throw new Error(`${old.slug} is already withdrawn`);
  return { ...old, withdrawn: { at: now, run, note: revocationNote(reason) } };
}

/** Withdraws a published debate map at `now`. Returns the exit code and a line for the owner. */
export function withdrawDebateAt(
  slug: string,
  reason: string,
  now: Stamp,
  opts: { commit: boolean; push: boolean },
): { code: number; message: string } {
  if (reason.trim().length < 3) return { code: 1, message: "a withdrawal says why" };
  const { store } = loadStore(KNOWLEDGE);
  const old = store.debates.find((d) => d.slug === slug);
  if (!old) return { code: 1, message: `no published debate map ${slug}` };
  if (old.withdrawn) return { code: 1, message: `the map ${slug} is already withdrawn` };
  const run = `${now.time.slice(0, 10)}-withdraw-map-${slug}`.slice(0, 120);
  const map = withdrawDebateMap(old, now, run, reason);
  const note = revocationNote(reason);
  const log: Run = {
    id: run,
    kind: "review",
    started: now,
    finished: now,
    agent: "the owner",
    summary:
      `The owner withdrew the debate map ${slug} ("${old.question}"). Its claims stay published. ${note}`.slice(
        0,
        1200,
      ),
    read: [],
    published: [],
    revised: [],
    rejected: [],
    gated: [],
    open: [],
    injections: [],
  };
  const waiting = readWaitingDebates().some((w) => w.debate.slug === slug);
  const code = commitStore(
    {
      store: { ...store, debates: store.debates.map((d) => (d.slug === slug ? map : d)) },
      claims: new Map(store.claims.map((c) => [c.id, c])),
      writeClaims: [],
      extraFiles: [
        [debatePath(slug), debateYaml(map)],
        [path.join(KNOWLEDGE, "runs", run.slice(0, 4), `${run}.yaml`), toYaml(log)],
      ],
      message: `Withdraw the debate map ${slug}, as the owner decided: ${note.replace(/^Withdrawn by the owner: /, "")}`,
      // Nothing publishes with a withdrawal; a map waiting under the same slug goes with it.
      debates: { publish: [], wait: [], drop: [], settled: waiting ? [slug] : [] },
    },
    now,
    opts,
  );
  if (code !== 0) return { code, message: `withdrawing the map ${slug} failed; nothing changed` };
  return {
    code,
    message: `withdrew the map ${slug}; it left every list, its page says why, and its claims stay published`,
  };
}

export async function withdrawDebate(
  slug: string,
  reason: string,
): Promise<{ code: number; message: string }> {
  return withdrawDebateAt(slug, reason, await nowStamp(chainSource()), {
    commit: true,
    push: false,
  });
}

export async function revoke(
  id: string,
  hash: string | null,
  reason: string,
): Promise<{ code: number; message: string }> {
  return revokeAt(id, hash, reason, await nowStamp(chainSource()), { commit: true, push: false });
}
