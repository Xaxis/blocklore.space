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
  would pass `BRAIN_DAILY_BUDGET_USD` (default 60). `pnpm brain budget` shows today's spend.
- Ask the Brain (M4, not built yet): a daily dollar budget kept in Redis and a per-visitor rate
  limit. Past the budget, answers degrade to retrieval-only (the matching claims, no synthesis) and
  say so.
- Planned: alerts to the owner at 50, 80 and 100 percent of a budget (BACKLOG.md).

### T5. Readers

- **No secrets accepted.** Ask the Brain and the research queue run a detector before anything is
  stored or sent to a model: BIP 39 word runs (12 or more list words), extended keys (`xpub`,
  `ypub`, `zpub`, `tpub`, `xprv` and kin), output descriptors, WIF private keys, bare 64-hex strings
  that are not block hashes, Bitcoin addresses, Lightning invoices and node ids, and email
  addresses and phone numbers. A match is refused with an explanation; the text is not logged.
- **No identity by default.** Questions are stored without IP address, account or cookie.
  Rate limiting uses a keyed hash of the address with a key that rotates daily, kept for a day.
- **Minimal analytics.** Overlook's counter: no cookies, nothing stored in the browser, localhost
  and automated browsers never counted.
- **Rendering.** Claim and question text is rendered as text, never as HTML. Strict Content
  Security Policy, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`.
- **Public queue moderation.** A queued question appears publicly only after it passes the detector
  and an on-topic check, with links and contact details stripped.

### T6. Supply chain and infrastructure

- Dependencies pinned by the lockfile; few of them. CI runs on this public repository.
- Vercel holds only what the site needs at runtime: the Anthropic key, Redis tokens, the chain push
  token and the queue pull token. It holds no GitHub write token and no signing key.
- Secrets live in `.env` on the devbox (mode 600, gitignored) and as sensitive variables on Vercel.
  They are never printed, never passed on a command line, never committed.
- The site's write endpoints (chain push, queue pull) need bearer tokens compared in constant time.

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
