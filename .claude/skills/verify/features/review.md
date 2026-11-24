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
- batch (`brain/src/evaluator.ts`, `evaluateBatch`): recheck and rules on due claims in order until
  `batchSize` pass (at most 4 times that many scanned; a claim code fails is decided in the batch
  without taking a verifier's place, and the live feed says how many), then the verifier prompt twice
  in `<staging>/<batch>-a` and `-b` on the research model and the other of opus and sonnet; private
  decisions in `var/evaluator/`, each signed by the publisher key when there is one
  (`signatures.jsonl`, `stampJson`; the batch message ends "signed by <address>" or "not signed:
  no publisher key"); `applyBatch` publishes items whose candidate hash is unchanged, writes the
  run log (kind review), `knowledge/evaluator.json`, and feed events; the job then puts the
  envelopes on Nostr (`publishDecisions`).
- revision (`requeueRevision`, from 2026-11-24): a real claim that code passed and that the
  verifiers only asked to revise (both gave a verdict, neither reject) keeps the first verifier's
  own rewording in the private batch file (`items[].revision`); `applyBatch` runs it through the
  disclosure gate and writes it to the queue with `revisedIn` {batch, stage, model}, the same id,
  gate reasons and research run. The public run log says "its revision waits to be checked
  afresh", never its words. It is due at once, read by two fresh verifiers, and publishes with the
  review check "worded by the second verifier (sonnet) of <batch>, then checked afresh". A claim
  with `revisedIn` is never revised again: its next revise is a plain reject, and research gets it
  ([loop](loop.md), "a verifier judged fixable"). Test claims never go back. To see one live:
  `grep -l revisedIn var/review/claims/*.yaml` after a batch applies.
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
publishes with the evaluator's record and no canary reaches `knowledge/`; the disclosure gate runs
first, so an embargoed claim in the queue is never evaluated and one embargoed by apply time never
publishes, neither leaving a trace in `knowledge/` or the feed; every decision is signed
and its signature checks, an edited one fails, and without a key none is; a missed canary holds the
batch; the publisher refuses a canary from a research run, a commit and an approval; every failing
check keeps a claim out; a claim code fails never counts against the batch size, and a passing claim
beyond it waits for the next batch; a claim only asked to revise goes back once in the verifier's
words and publishes on two fresh accepts with a record of whose words, while a reject from either
verifier, a test claim or a second revise sends nothing back; no token or owner mode runs nothing;
owner approval; revocation).

Runtime (read-only): `pnpm -s brain evaluate` prints the state (waiting for the token, calibrating,
paused or ready), the backlog, the catch rate and recent decisions.

The admin flow end to end, without touching any checkout's `var/`, `knowledge/` or dev site, all
in a scratch clone:

```sh
git clone -q --branch <this branch> . $SCRATCH/clone && cd $SCRATCH/clone
git remote set-url --push origin /nonexistent && git checkout -q -b evaluator-proof
pnpm install --offline --frozen-lockfile
node .claude/skills/verify/evaluatorcheck.ts seed .   # env file, fixtures, one fake-verified batch
(cd web && node ../core/cli.ts bundle && npx next dev --port 3722)   # in the background
set -a; . <(grep -E '^(CONTROL_KEY|BRAIN_SYNC_TOKEN)=' web/.env.development.local); set +a
BLOCKLORE_SITE=http://localhost:3722 node brain/cli.ts daemon   # in the background, no token
heavy node .claude/skills/verify/evaluatorcheck.ts drive . $SCRATCH/shots
```

Proves it when every line says `ok` and the exit code is 0: the page says it waits for the token,
lists test claims and every check, says the last batch was signed (seed signs with a throwaway key
held in memory) and every signature in the clone's `var/evaluator/` checks against its decision, the threshold saves, "Evaluate a batch now" says it waits, the
held claim is approved by hand (ship refuses off main), two claims are withdrawn and become
lessons, and the public scorecard, claim pages, API, topic and search agree. Look at
`evaluator-desk-light.png`, `scorecard-desk-light.png` and `withdrawn-claim-desk-light.png`.

## Gotchas

- Never run approve, reject or revoke, nor `brain evaluate run`, on the real queue: those are the
  owner's and the evaluator's (CLAUDE.md).
- Held text never enters the public repo; only per-topic counts and published ids do.
- `ship()` refuses on any branch but main, so a job run from a worktree or a scratch clone commits
  there and never pushes.
