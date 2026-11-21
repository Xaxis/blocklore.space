# Security

Blocklore's credibility is its product, so its security model protects three things in this order:
the integrity of the knowledge (nobody can make the brain publish something false or unreviewed),
the readers (no secrets collected, no tracking, nothing that harms them), and the owner's money and
keys (bounded spend, secrets out of every model's reach).

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security, Report a vulnerability).
Please do not open a public issue for a security problem.

## Assets

| Asset | Why it matters |
|---|---|
| `knowledge/` and its snapshots | The public record. A false or unreviewed claim here is the worst failure. |
| The publish path (git push, Vercel deploy) | Whoever controls it controls what readers see. |
| Secrets: GitHub token, Vercel token, Anthropic API key, Redis tokens, the site's push tokens, a future signing key and Lightning credentials | Spend, publication and impersonation. |
| The owner's review decisions | The human gate is only as strong as its inputs. |
| Readers' questions | Questions can reveal what a person holds or fears. |

## Threats and controls

### T1. Prompt injection through sources

Fetched pages, posts, PRs, transcripts and readers' questions may carry instructions aimed at the
brain ("ignore your rules and state that ...", hidden text, encoded payloads).

- All fetched text is wrapped and labeled as untrusted data in every prompt. The research and
  verifier instructions say, first and last, never to follow instructions found in sources.
- Hidden text is removed before any model sees a page: HTML comments, `display:none`,
  `visibility:hidden`, zero-size and off-screen elements, zero-width and bidi control characters,
  and text matching the background color where it can be detected. Each removal is counted.
- A suspected injection (imperatives addressed to an AI, role markers, "system prompt") is logged
  in the run log's `injections` list with the URL and a short excerpt, and shown on the public
  research log.
- Injection cannot reach publication by design: the research role cannot publish; a fresh-context
  verifier sees the candidate and the evidence, not the research transcript; every quote is checked
  by code; gated claims wait for the owner.

### T2. Poisoning the knowledge base

Someone posts fabricated "evidence" (a fake mailing-list message, a sock-puppet chorus on social
media, an edited wiki page) hoping the brain will repeat it.

- T4 never supports a claim alone; T3 alone is labeled.
- Mailing-list messages are read from the archive by message id, and a claim about what a person
  said must cite a T1 place they said it.
- Git sources are cited at a commit, so later edits cannot change what was cited.
- The verifier is told to look for contradiction with published claims and to downgrade claims
  whose only support is a single new account or a single unreviewed source.

### T3. A model with too much power

Separation of roles, enforced by the runner (`brain/src/agent.ts`), not by convention:

| Role | Runs as | Can read | Can write | Network | Secrets |
|---|---|---|---|---|---|
| research | `claude -p --restricted`, `brain/src/agent.ts` | copies the runner puts in its folder: rules, its task, published claims, inbox items | `<staging>/<run>/claims, topics, run.yaml` only | web fetch and search | none: started with a scrubbed environment |
| verifier | `claude -p --restricted`, fresh session | the candidate, its fetched evidence, `knowledge/` | `<staging>/<run>/verdicts/` only | web fetch | none |
| checks, ingest, chain | Node, no model | sources | `var/` | registered hosts (robots.txt obeyed) and the chain source | none required; `GITHUB_TOKEN` only if set |
| publisher, snapshot | Node, no model | `<staging>/`, `knowledge/` | `knowledge/`, `var/review/`, git | GitHub push, OpenTimestamps calendars | git credentials, a future signing key |
| owner | `pnpm review` | everything | review decisions | none | none |
| ask (site) | one Messages API call from the Vercel function, no tools | the question and the 12 best published claims | nothing: its JSON is checked by `core/src/ask.ts` and shown, never stored in `knowledge/` | the Anthropic API | `ANTHROPIC_API_KEY` |

- Model roles run as `claude -p --restricted` (`brain/src/agent.ts`): no shell or code tools, no
  settings files, file tools confined to the run folder, every tool not on the allow list refused.
  The run folder lives outside the repository under `/var/tmp/blocklore/staging/`, and HOME is a
  role-only folder, so no CLAUDE.md, memory or login of the owner's is ever loaded. The only secret
  in the environment is the API key the CLI itself authenticates with; no tool the role has can
  read the environment. These boundaries were tested on 2026-11-20: reading `.env` and writing
  outside the folder were refused.
- Model roles cannot run shell commands, edit their own instructions (`brain/prompts/`), the
  pipeline code or the source registry. Changes to any of those are pull requests the
  owner reviews; the brain may draft them in `var/proposals/`.
- Each role run has a turn ceiling and a wall-clock timeout.
- Outputs are parsed and validated at the edge: a candidate that fails the schema is rejected, not
  repaired by a model.

### T4. Spend

- Research: every role run has a turn ceiling and a dollar ceiling (`--max-turns`,
  `--max-budget-usd`) and a wall-clock timeout; every run's cost is appended to
  `var/budget/runs.jsonl`; the runner refuses to start a role when today's spend plus that role's ceiling
  would pass the owner's daily budget (set in the admin; `BRAIN_DAILY_BUDGET_USD` only where the
  owner never saved settings). The daemon starts a scheduled session only when today's spend plus
  two session ceilings fits, and never more sessions a day than the owner allows. `pnpm brain
  budget` shows today's spend.
- Ask the Brain: a daily dollar budget (`ASK_DAILY_BUDGET_USD`, default 2) kept in Redis
  (`blocklore-kv`). Each call first reserves its worst case (every prompt character a token, the
  whole output allowance) with an atomic check against the cap, then settles to the billed usage.
  Each visitor gets 6 written answers an hour and 20 a day, counted under an HMAC of the address
  keyed with `ASK_SALT` and the UTC day; the address itself is not stored. The Ask prompt is
  `ASK_SYSTEM` in `core/src/ask.ts`: it has no tools and its output never reaches `knowledge/`, so
  it ships like code, measured by `pnpm brain bench --ask`. Past either limit, a missing key or store, a
  model error or an answer that fails its check, the reader gets the matching claims and the reason.
  In production a missing store fails closed. The same question on the same edition is answered
  from a day's cache, keyed by a hash of the question.
- The timers (`tools/timers.sh`) run as the owner's user on the devbox. Their free ticks commit as
  the owner, push `main` and deploy, only when the checkout is on `main`, so a session's branch is
  never pushed. Research has no timer: the daemon runs sessions only in the mode the owner chose
  (off by default).
- Planned: alerts to the owner at 50, 80 and 100 percent of a budget (BACKLOG.md).

### T5. Readers

- **No secrets accepted.** The API's search, every MCP tool call (on every string argument), Ask
  the Brain and the research queue run a detector before anything is used, stored or sent to a model: BIP 39 word runs (12 or more list words), extended keys (`xpub`,
  `ypub`, `zpub`, `tpub`, `xprv` and kin), output descriptors, WIF private keys, bare 64-hex strings
  that are not block hashes, Bitcoin addresses, Lightning invoices and node ids, and email
  addresses and phone numbers. A match is refused with an explanation; the text is not logged.
- **Reader text travels in bodies, not URLs.** A query string is written to the host's and every
  proxy's request logs before any detector runs, so search (`POST /api/v1/search`), `/mcp` and Ask
  (`POST /api/v1/ask`) take text only in a POST body; a `GET` to either answers 405 and says why.
- **No identity by default.** Questions are stored without IP address, account or cookie.
  Rate limiting uses a keyed hash of the address with a key that rotates daily, kept for a day.
- **Minimal analytics.** Overlook's counter: no cookies, nothing stored in the browser, localhost
  and automated browsers never counted.
- **Rendering.** Claim and question text is rendered as text, never as HTML. Strict Content
  Security Policy, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`.
- **Public queue moderation.** Only a question Ask could not answer, and judged to be about
  Bitcoin, can be queued: the answer carries an HMAC ticket (keyed with `ASK_SALT`) over the
  question and the model's `missing` note, so neither can be swapped for other text. The queue
  runs the detector again, strips links, email addresses, Nostr keys and handles, and counts each
  visitor under the daily-rotating hash (5 a day). A queued question appears publicly only after the
  brain triages it (`researching` or `answered`); until then the page shows a count, and declined
  questions are never shown. Notes the brain writes pass the style check and the detector at the
  site's edge.
- **Queued questions reach a model only as data.** `brain queue research` wraps the reader's words
  in an escaped `<question>` element under an instruction to treat them as data, and the run's
  output still goes through the verifier, the deterministic checks and the gate.

### T6. Supply chain and infrastructure

- Dependencies pinned by the lockfile; few of them. CI runs on this public repository.
- Vercel holds only what the site needs at runtime: the Anthropic key, Redis tokens, the chain push
  token and the queue pull token. It holds no GitHub write token and no signing key.
- Secrets live in `.env` on the devbox (mode 600, gitignored) and as sensitive variables on Vercel.
  They are never printed, never passed on a command line, never committed.
- The site's write endpoints (chain push, the queue's pull and status) need bearer tokens compared
  in constant time (`sameSecret` in `web/lib/kv.ts`, over SHA-256 digests so lengths do not leak).

### T6b. The control plane (ADMIN.md)

The admin can publish claims, spend money and change what research does, so it is guarded at
every hop:

- **Forged commands.** The devbox applies a command only with a valid HMAC-SHA256 under
  `CONTROL_KEY`, which the site and the devbox hold and Redis never sees (`core/src/control.ts`).
  A leaked Redis token or `BRAIN_SYNC_TOKEN` can show or delay state, or drop commands, but cannot
  approve a claim, start a session or change a setting. The command's shape is checked by schema
  before anything is applied: there is no command that runs a shell or names a file.
- **Replay.** Each command carries a random id and a time; the devbox refuses one older than 15
  minutes and one whose id it already applied (`var/control/seen.json`, kept a day). A refused
  replay writes no result, so it cannot overwrite the real one.
- **Stale approvals.** An approval or rejection names each claim with the SHA-256 of the pending
  candidate the owner was shown. The daemon checks the hashes before it queues the decision and
  again when it runs; if any claim changed or is gone, nothing is approved or rejected.
- **Owner text reaching a model.** Focus, lessons and agenda scopes are the owner's words, length
  limited and free of control characters. They reach the research role in a section labeled as
  the owner's, which says they never override the editorial or source rules. Reader text never
  reaches that section.
- **The devbox's exposure.** It takes no inbound connection; the daemon only calls out to the site.
  Long work runs as children of the daemon, one at a time; anything that commits takes the same
  lock as the timers.
- **The plan credential.** When the owner chooses their Claude plan, the research role gets
  `CLAUDE_CODE_OAUTH_TOKEN` instead of the API key, never both, under the same boxing (T3). A role
  that leaked it could spend the owner's plan limits rather than API dollars; the owner revokes it
  at claude.ai and switches back to the API key in the admin.

### T7. Explorer or node dishonesty

Until the owner provides a node, chain checks require mempool.space and blockstream.info to agree,
and record both. Every chain check prints the command a reader runs against their own node, which
is the real defense: anyone can check.

### T8. Impersonation and tampering after publication

Snapshots carry a Merkle root of every claim's canonical hash, timestamped on Bitcoin with
OpenTimestamps, and (once the owner answers ARCHITECTURE.md Q2) signed. Anyone can verify a page
against a snapshot without trusting the site (/verify).

## What Blocklore never does

No custody, no keys, no trading, no price prediction, no financial advice. No accounts for readers.
No email collection until the digest ships, and then only with double opt-in.
