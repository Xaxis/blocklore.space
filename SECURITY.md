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
| Secrets: GitHub token, Vercel token, the owner's Claude subscription token, Redis tokens, the site's push tokens, a future signing key and Lightning credentials | Spend, publication and impersonation. |
| The owner's review decisions | The human gate is only as strong as its inputs. |
| Readers' searches and suggestions | What a person looks for can reveal what they hold or fear. |

## Threats and controls

### T1. Prompt injection through sources

Fetched pages, posts, PRs, transcripts and readers' suggestions may carry instructions aimed at the
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

The site runs no model. Since 2026-11-21 a reader who wants written answers connects their own
assistant to `/mcp`, whose tools return published data and nothing else (T5).

- Model roles run as `claude -p --restricted` (`brain/src/agent.ts`): no shell or code tools, no
  settings files, file tools confined to the run folder, every tool not on the allow list refused.
  The run folder lives outside the repository under `/var/tmp/blocklore/staging/`, and HOME is a
  role-only folder, so no CLAUDE.md, memory or login of the owner's is ever loaded. The only secret
  in the environment is the owner's Claude subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) the CLI
  authenticates with; an API key is never passed, even when one is set; no tool the role has can
  read the environment. These boundaries were tested on 2026-11-20: reading `.env` and writing
  outside the folder were refused.
- Model roles cannot run shell commands, edit their own instructions (`brain/prompts/`), the
  pipeline code or the source registry. Changes to any of those are pull requests the
  owner reviews; the brain may draft them in `var/proposals/`.
- Each role run has a turn ceiling and a wall-clock timeout.
- Outputs are parsed and validated at the edge: a candidate that fails the schema is rejected, not
  repaired by a model.

### T4. Spend

- Research runs only on the owner's Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`, from
  `tools/subscription.sh`); there is no API key path, so nothing is billed per token. Every role
  run has a turn ceiling and a wall-clock timeout from the owner's settings (`usage`), and appends
  its turns and minutes to `var/budget/runs.jsonl`. The daemon never starts more sessions a day
  than the owner allows, and starts none without the token. When the plan's usage limit stops a
  session, model work waits until the reset (or an hour) and the admin says so. `pnpm brain usage`
  shows today's sessions.
- The bench is retrieval only, deterministic and free; no model answers anything.
- The site: no model runs for readers, so reader traffic spends no model money. A suggestion is
  one small Redis write, capped per visitor and for the whole site each day (T5).
- The timers (`tools/timers.sh`) run as the owner's user on the devbox. Their free ticks commit as
  the owner, push `main` and deploy, only when the checkout is on `main`, so a session's branch is
  never pushed. Research has no timer: the daemon runs sessions only in the mode the owner chose
  (off by default).

### T5. Readers

- **No secrets accepted.** The API's search, every MCP tool call (on every string argument) and
  reader suggestions run a detector before anything is used or stored: BIP 39 word runs (12 or
  more list words), extended keys (`xpub`, `ypub`, `zpub`, `tpub`, `xprv` and kin), output
  descriptors, WIF private keys, bare 64-hex strings that are not block hashes, Bitcoin addresses,
  Lightning invoices and node ids, and email addresses and phone numbers. A match is refused with
  an explanation; the text is not logged.
- **Reader text travels in bodies, not URLs.** A query string is written to the host's and every
  proxy's request logs before any detector runs, so search (`POST /api/v1/search`), `/mcp` and
  suggestions (`POST /api/v1/queue`) take text only in a POST body; a `GET` to search or `/mcp`
  answers 405 and says why. A search with no match hands its words to the suggestion box in the
  URL fragment (`/gaps#suggest=`), which the browser never sends to a server, and the box clears
  the fragment as soon as it reads it.
- **No identity by default.** Suggestions are stored without IP address, account or cookie.
  Rate limiting uses a keyed hash of the address (keyed with `ASK_SALT`) with a key that rotates
  daily, kept for a day.
- **No model on the site.** Blocklore answers no reader in sentences of its own making. A reader
  who wants that connects their own assistant to `/mcp` (`/connect` shows how). Its seven tools
  are read-only, return published claims and the store's data, keep nothing a model sends them,
  and run the detector on every string argument. What the reader's model writes happens on the
  reader's side, under their model's terms.
- **Minimal analytics.** Overlook's counter: no cookies, nothing stored in the browser, localhost
  and automated browsers never counted.
- **Rendering.** Claim and suggestion text is rendered as text, never as HTML. Strict Content
  Security Policy, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`.
- **Public suggestion moderation.** Any reader can suggest a question for research (the box on
  `/gaps`, or `POST /api/v1/queue` with `{"q"}`). The site runs the detector, strips links, bare
  domains, email addresses, Nostr keys and handles, refuses what is left under 8 characters,
  counts a repeat instead of listing it twice, and takes at most 5 a day from each visitor (under
  the daily-rotating hash) and 200 a day for the whole site, so a flood cannot bury the queue. A
  suggestion appears publicly only after the brain or the owner triages it (`researching` or
  `answered`, through `pnpm brain queue` or the admin's Reader suggestions page); until then the
  page shows a count, and declined suggestions are never shown. Every status change, from the
  brain or the owner, passes the same check at the site's edge (`updateProblem`): a public note
  keeps the house style and holds no secret, and an answer names claims that are published.
- **Suggestions reach a model only as data.** `brain queue research` wraps the reader's words in
  an escaped `<question>` element under an instruction to treat them as data, and the run's
  output still goes through the verifier, the deterministic checks and the gate.

### T6. Supply chain and infrastructure

- Dependencies pinned by the lockfile; few of them. CI runs on this public repository.
- Vercel holds only what the site needs at runtime: Redis tokens, the visitor-hash salt, the
  chain push token, the queue pull token, the control plane's `CONTROL_KEY` and
  `BRAIN_SYNC_TOKEN`, and the login mail key. The site calls no model, so it needs no Anthropic
  key. It holds no GitHub write token and no signing key.
- Secrets live in `.env` on the devbox (mode 600, gitignored) and as sensitive variables on Vercel.
  They are never printed, never passed on a command line, never committed.
- The site's write endpoints (chain push, the queue's pull and status) need bearer tokens compared
  in constant time (`sameSecret` in `web/lib/kv.ts`, over SHA-256 digests so lengths do not leak).

### T6b. The control plane (ADMIN.md)

The admin can publish claims, spend money and change what research does, so it is guarded at
every hop:

- **Signing in.** One address can sign in (`OWNER_EMAIL`, never in the repository). The login form
  answers the same for any address and is rate limited, so it reveals nothing and cannot flood the
  owner's mail. A link's token rides in the URL fragment (never in a server log), works once, for
  15 minutes, and is spent by a POST from a button, so a mail scanner that opens links cannot use
  it. The session id lives only in an `HttpOnly`, `Secure`, `SameSite=Lax` `__Host-` cookie; Redis
  keeps its hash. Every admin page checks the session on the server, every admin route too, and
  every state change must come from the site's own origin (`Origin` and `Sec-Fetch-Site`). The
  devbox fallback, `pnpm brain admin-link`, needs a request signed under `CONTROL_KEY`.
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
- **The subscription token.** Every model role gets `CLAUDE_CODE_OAUTH_TOKEN` and nothing else,
  under the boxing of T3. A role that leaked it could use the owner's plan limits, never money; the
  owner revokes it at claude.ai and runs `tools/subscription.sh` again.

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
