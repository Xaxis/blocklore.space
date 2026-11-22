# Review and the evaluator

The gate marks claims for closer checks; the evaluator decides them as code and publishes what
passes every check. The owner can withdraw any published claim, or hold gated claims for their own
approval (EDITORIAL.md, "The evaluator").

<!-- covers: cli:review, cli:brain evaluate -->

## Sub-features

- gate (`core/src/gate.ts`): reasons with a scrutiny each (contested, safety, position, person).
- rules (`core/src/evaluate.ts`, `structuralRules`): pure code per scrutiny; `decide` fails closed
  (any false rejects, any null or missing stage holds); `calibration` and `batchPublishing`.
- canaries (`makeCanaries`, `mutate`): number, name, hedge, quote, stance, revoked; deterministic
  by seed, fresh ids, well formed. Registered in `var/evaluator/canaries.jsonl` before any write
  (`brain/src/canary.ts`); `commitStore` and `publish` refuse a canary's id or statement (the claim
  a canary was copied from keeps its own words).
- batch (`brain/src/evaluator.ts`, `evaluateBatch`): recheck, rules, then the verifier prompt twice
  in `<staging>/<batch>-a` and `-b` on the research model and the other of opus and sonnet; private
  decisions in `var/evaluator/`; `applyBatch` publishes items whose candidate hash is unchanged,
  writes the run log (kind review), `knowledge/evaluator.json`, and feed events.
- job (`brain/src/evaljob.ts`): `evaluator.run` from the schedule (a session slot, when due claims
  and the subscription token exist) or the admin; apply and ship under the tick lock.
- revoke (`brain/src/revoke.ts`): `claim.revoke` or `pnpm review revoke <id> --reason ...`; a
  `withdrawn` revision, out of topics, a canary case, a lesson.
- owner's hand (`brain/src/review.ts`): list, show, approve, reject, revoke; `approveAt` writes a
  `by: owner` review record.

## How to reach it

- `pnpm review list|show|approve|reject|revoke`, `pnpm brain evaluate [run | apply <batch>]`.
- The admin's Evaluator page ([admin](admin.md)); the public scorecard `/verify/evaluator`
  ([verify](verify.md)).

## How to check it

Static: `pnpm lint`. Behaviour: `pnpm test`; `core/test/evaluate.test.ts` (each rule, decide,
both verifiers, calibration, canaries well formed, withdrawn hidden from the bundle) and
`brain/test/evaluator.test.ts` (in temp dirs with a fake check and verifier: a passing batch
publishes with the evaluator's record and no canary reaches `knowledge/`; a missed canary holds the
batch; the publisher refuses a canary from a research run, a commit and an approval; every failing
check keeps a claim out; no token or owner mode runs nothing; owner approval; revocation).

Runtime (read-only): `pnpm -s brain evaluate` prints the state (waiting for the token, calibrating,
paused or ready), the backlog, the catch rate and recent decisions.

The admin flow end to end, without touching this checkout's `var/` or `knowledge/`: a scratch
clone on a branch other than main with no push URL, seeded with fixture pending claims and one
batch decided by a fake verifier, its daemon synced to the dev site; then
`heavy node .claude/skills/verify/evaluatorcheck.ts <clone> <out>` (see the script's header).

## Gotchas

- Never run approve, reject or revoke, nor `brain evaluate run`, on the real queue: those are the
  owner's and the evaluator's (CLAUDE.md).
- Held text never enters the public repo; only per-topic counts and published ids do.
- `ship()` refuses on any branch but main, so a job run from a worktree or a scratch clone commits
  there and never pushes.
