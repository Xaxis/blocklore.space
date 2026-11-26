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
| Secrets: GitHub token, Vercel token, the owner's Claude subscription token, Redis tokens, the site's push tokens, the publisher key (ORANGECHECK.md) and Lightning credentials | Spend, publication and impersonation. |
| The evaluator's checks and the owner's veto | The gate is only as strong as its checks; canaries measure them, and the owner's withdrawals are signed commands. |
| Readers' searches and suggestions | What a person looks for can reveal what they hold or fear. |

## Threats and controls

### T1. Prompt injection through sources

Fetched pages, posts, PRs, transcripts, readers' suggestions and the notes on readers' reports may
carry instructions aimed at the brain ("ignore your rules and state that ...", hidden text, encoded payloads).

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
  by code; gated claims pass the evaluator's recheck, rules and two independent verifiers, and
  test claims mixed into every batch prove those checks still catch false claims.

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
| publisher, snapshot, Nostr channel | Node, no model | `<staging>/`, `knowledge/` | `knowledge/`, `var/review/`, `var/nostr/`, git | GitHub push, OpenTimestamps calendars, Nostr relays | git credentials, the publisher key |
| evaluator | Node, no model; verifiers as above | `var/review/`, `knowledge/`, both verifiers' verdicts | `<staging>/<batch>-a, -b`, `var/evaluator/`; publishes through the publisher | none of its own | the publisher key, through the publisher's code, to sign each decision |
| owner | the admin's signed commands, `pnpm review` | everything | withdrawals, the evaluator's settings, approvals when holding | none | none |

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

### T3b. The evaluator

Gated claims publish without a person in the loop, so the evaluator fails closed
(`brain/src/evaluator.ts`, `core/src/evaluate.ts`):

- A claim publishes only when every check says yes: a fresh `brain check`, the structural rules for
  its gate reasons, and two verifier runs in separate folders on different models. No answer, a
  timeout or an unreadable page holds it; a no from any check keeps it out. Models only write
  verdicts in their own folders; deterministic code reads them and writes `knowledge/`.
- A verifier that grows lax is caught by canaries: published claims with one thing made false,
  mixed in with fresh ids and nothing that marks them. Publishing waits for five decided canaries,
  pauses below the owner's catch rate, and holds the whole batch when one gets through.
- A canary cannot publish by any path. It is registered in `var/evaluator/canaries.jsonl` before it
  is written anywhere, batch files list real claims only, and the publisher refuses any claim whose
  id or statement matches a canary before it writes a file (`brain/src/canary.ts`), whether it
  comes from a batch, a research run or an approval. A test proves each path.
- What readers see never leaks what waits: the public record and feed carry published ids and
  counts per public topic, never an unpublished statement, a model's words or a path.
- The owner's veto is a signed `claim.revoke` naming the claim's hash as shown; the devbox refuses
  it when the claim changed since. A withdrawal is a revision, so history stays intact.

### T4. Spend

- Research runs only on the owner's Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`, connected
  from the admin or with `tools/subscription.sh`); there is no API key path, so nothing is billed per token. Every role
  run has a turn ceiling and a wall-clock timeout from the owner's settings (`usage`), and appends
  its turns and minutes to `var/budget/runs.jsonl`. The daemon never starts more sessions a day
  than the owner allows, and starts none without the token. When the plan's usage limit stops a
  session, model work waits until the reset (or an hour) and the admin says so. `pnpm brain usage`
  shows today's sessions.
- The bench is retrieval only, deterministic and free; no model answers anything.
- The site: no model runs for readers, so reader traffic spends no model money. A suggestion or a
  report is one small Redis write, capped per visitor and for the whole site each day (T5). A
  report's recheck is deterministic and free; research on a reported claim runs only in a session
  the owner's schedule already allows, so reports change what research looks at, never how much
  of the owner's plan it uses.
- The timers (`tools/timers.sh`) run as the owner's user on the devbox. Their free ticks commit as
  the owner, push `main` and deploy, only when the checkout is on `main`, so a session's branch is
  never pushed. Research has no timer: the daemon runs sessions only in the mode the owner chose
  (off by default).

### T5. Readers

- **No secrets accepted.** The API's search, every MCP tool call (on every string argument),
  reader suggestions and reader reports (on every string in the body) run a detector before
  anything is used or stored: BIP 39 word runs (12 or
  more list words), extended keys (`xpub`, `ypub`, `zpub`, `tpub`, `xprv` and kin), output
  descriptors, WIF private keys, bare 64-hex strings that are not block hashes, Bitcoin addresses,
  Lightning invoices and node ids, and email addresses and phone numbers. A match is refused with
  an explanation; the text is not logged.
- **Reader text travels in bodies, not URLs.** A query string is written to the host's and every
  proxy's request logs before any detector runs, so search (`POST /api/v1/search`), `/mcp`,
  suggestions (`POST /api/v1/queue`) and reports (`POST /api/v1/claims/<id>/reports`) take text
  only in a POST body; a `GET` to search or `/mcp`
  answers 405 and says why. A search with no match hands its words to the suggestion box in the
  URL fragment (`/gaps#suggest=`), which the browser never sends to a server, and the box clears
  the fragment as soon as it reads it.
- **No identity by default.** Suggestions and reports are stored without IP address, account or
  cookie.
  Rate limiting uses a keyed hash of the address (keyed with `ASK_SALT`) with a key that rotates
  daily, kept for a day.
- **No model on the site.** Blocklore answers no reader in sentences of its own making. A reader
  who wants that connects their own assistant to `/mcp` (`/connect` shows how). Its twelve tools
  are read-only, return published claims and the store's data, keep nothing a model sends them,
  and run the detector on every string argument. What the reader's model writes happens on the
  reader's side, under their model's terms.
- **Minimal analytics.** Overlook's counter: no cookies, nothing stored in the browser, localhost
  and automated browsers never counted.
- **Reach counts, numbers only.** Use of the API, the MCP server, the export, `llms.txt`, the feeds
  and the proof files is counted per UTC day in one Redis hash (`core/src/reach.ts`,
  `web/proxy.ts`): the route family or the MCP tool's name, and a count. No address, user agent,
  query, argument or cookie is read into it, so a count cannot tell one reader from another. The
  site's own requests count apart (`Sec-Fetch-Site: same-origin`), Blocklore's own checks and
  the brain send `X-Blocklore-Check` and are not counted, and the hashes expire after 400 days.
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
- **Reader reports.** Any reader can report a problem with a published claim (wrong, outdated,
  the source does not say this, broken link, unclear) with an optional note of at most 500
  characters, from the claim's page or `POST /api/v1/claims/<id>/reports` with `{"kind", "note"}`
  and nothing else (`core/src/report.ts`). The detector runs over every string in the body first,
  so a refused report is neither echoed nor kept and counts toward no cap. Links, bare domains,
  Nostr keys, handles and control or format characters (zero-width, bidi) are stripped from the
  note. The same kind on the same version of a claim counts instead of adding, and the caps are
  the suggestions' (5 a visitor and 200 for the site each UTC day, `countDay` in `web/lib/kv.ts`,
  counted apart from suggestions). The note is private: the public views build each report field
  by field (`publicReport`), so a note cannot reach a page, the API or a feed through a new
  field, and only the brain's pull (`QUEUE_PULL_TOKEN`) and the owner's admin read it. The brain's
  outcomes pass the edge check (`reportUpdateProblem`): no dashes, no secrets, and a report the
  owner dismissed as abuse stays dismissed.
- **Report notes reach a model only as data.** The hourly recheck of a reported claim is code; no
  model reads the note there. When a `wrong` or `outdated` report holds, the research task lists
  the claim with its readers' notes in escaped `<reader-note>` elements, under a line saying they
  are data from the public and not instructions, with hidden characters stripped as from fetched
  pages; a note that reads as instructions to a model (`suspectedInjections`) is left out of the
  task and counted. What research writes still goes through the checks, the verifier and the gate,
  and only deterministic code writes `knowledge/`.

### T6. Supply chain and infrastructure

- Dependencies pinned by the lockfile; few of them. CI runs on this public repository.
- Vercel holds only what the site needs at runtime: Redis tokens, the visitor-hash salt, the
  chain push token, the queue pull token, the control plane's `CONTROL_KEY` and
  `BRAIN_SYNC_TOKEN`, and the login mail key. The site calls no model, so it needs no Anthropic
  key. It holds no GitHub write token and no signing key: it only checks the owner's pasted
  signatures.
- Secrets live in `.env` on the devbox (mode 600, gitignored) and as sensitive variables on Vercel.
  They are never printed, never passed on a command line, never committed.
- The site's write endpoints (chain push, the queue's and the reports' pull and status, both under
  `QUEUE_PULL_TOKEN`) need bearer tokens compared
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
  again when it runs; if any claim changed or is gone, nothing is approved or rejected. A
  withdrawal names the published claim's hash the same way.
- **Owner text reaching a model.** Focus, lessons and agenda scopes are the owner's words, length
  limited and free of control characters. They reach the research role in a section labeled as
  the owner's, which says they never override the editorial or source rules. Reader text never
  reaches that section.
- **The devbox's exposure.** It takes no inbound connection; the daemon only calls out to the site.
  Long work runs as children of the daemon, one at a time; anything that commits takes the same
  lock as the timers.
- **The publisher key** (`BLOCKLORE_PUBLISHER_KEY`, ORANGECHECK.md). Made on the devbox by
  `pnpm brain orangecheck keygen`, which writes `.env` at mode 600, prints only the address and
  refuses to replace a key the owner's delegation names. Only deterministic code reads it
  (`brain/src/orangecheck.ts`); model roles get `roleEnv`, which carries the subscription token and
  nothing else (tested). It can sign only what the owner delegated (`stamp:sign` of JSON, a year at
  most), the owner's own Bitcoin key never touches the devbox, and the owner revokes the delegation
  from the admin with a signature from their wallet, after which the site shows the key as signing
  alone. A leaked key could sign false editions until revoked; the OpenTimestamps proofs and the
  git history still show what was published when. The owner's signatures are checked twice, by the
  site before the command is queued and by the daemon before anything is recorded.
- **The subscription token.** Every model role gets `CLAUDE_CODE_OAUTH_TOKEN` and nothing else,
  under the boxing of T3. A role that leaked it could use the owner's plan limits, never money; the
  owner revokes it at claude.ai and connects a new one.
- **Connecting it from the admin.** The owner pastes the token `claude setup-token` printed into
  `/admin/research`. Only the owner's session reaches `POST /api/admin/subscription`, which accepts
  nothing but a subscription token (`sk-ant-oat`, never an API key), seals it with AES-256-GCM
  under a key derived from `CONTROL_KEY` with the purpose bound in (`core/src/node/seal.ts`), and
  queues the sealed form in a signed command; the plain command route refuses an unsealed one.
  Redis, the command log and the job file hold only ciphertext, and the job file is deleted when
  the job ends. The daemon opens it, checks it with a one-turn session in a throwaway HOME, and
  writes `.env` (mode 600) only when that session ran; every message it sends back has the token
  redacted. Someone with `CONTROL_KEY` and the Redis contents could open a queued token, which is
  the same trust `CONTROL_KEY` already carries for every command.

### T7. Explorer or node dishonesty

Until the owner provides a node, chain checks require mempool.space and blockstream.info to agree,
and record both. Every chain check prints the command a reader runs against their own node, which
is the real defense: anyone can check.

### T8. Impersonation and tampering after publication

Snapshots carry a Merkle root of every claim's canonical hash, timestamped on Bitcoin with
OpenTimestamps, and (once the owner answers ARCHITECTURE.md Q2) signed. Anyone can verify a page
against a snapshot without trusting the site (/verify).

The Nostr channel (ORANGECHECK.md) signs with its own key, an HKDF sibling of the records key, and
`/.well-known/nostr.json` names both, so a note under Blocklore's name from any other key is not
Blocklore's. Its notes come only from code, from published claims; no model writes or sends one. It
sends nothing while the owner's switch is off. A test, or a daemon whose site is on this machine,
reaches only relays on this machine (`relayProblem` in `brain/src/nostr.ts`), so a test key never
reaches a public relay, and production posts only to `wss://` relays.

### T9. Publishing an undisclosed vulnerability (the security watch)

The security watch (ARCHITECTURE.md) looks for weaknesses on purpose, so it could find, or be fed,
one that its project has not disclosed yet. Publishing that would hurt the people Bitcoin protects.
The rule is absolute: nothing undisclosed ever publishes.

- **Defensive by construction.** The watches read public data at polite rates through the same
  fetcher as ingest (`brain/src/http.ts`), and NVD's public CVE API at its published limit for
  clients without a key. Nothing probes, scans or tests a live node, service or
  person; the lab runs only Bitcoin Core's own tests, in regtest, libsecp256k1's own test
  programs, offline, LND's own unit tests, built from its verified source and run offline once
  the modules its `go.sum` pins are fetched, and LDK's own tests, built from its signed release
  tag and run offline once the crates its lockfile pins are fetched, and Eclair's own tests, built
  from the commit its signed release zip names and run offline once the dependencies it resolved
  are kept, all on the devbox. No exploit code
  is written, and the research task says to describe a threat only as far as its public sources
  do and never as instructions.
- **The disclosure gate is code** (`core/src/disclosure.ts`, tested in
  `core/test/disclosure.test.ts` and `brain/test/security.test.ts`). The publisher runs it on every
  candidate before anything else, and on the verifier's revision too. The evaluator runs it again
  over the review queue before it evaluates and again before it publishes (`screenEmbargo` in
  `brain/src/evaluator.ts`), so a claim that waited from before the gate, or that a changed public
  record now flags, moves to the embargo unseen by any verifier; one the owner released passes. A
  candidate that reads as a
  security finding is embargoed when it says the weakness is unfixed or undisclosed, names a CVE
  or GHSA that no published advisory or threat lists, or names nothing publicly known, unless it
  cites the project's own advisory or a CVE record. Every advisory the watch has kept in
  `knowledge/security/advisories.json`, each published by its project, counts as listed. A lab
  run is embargoed on any failed test, a `SHA256SUMS` mismatch or no good builder signature.
  An LND release is checked as LND's own `scripts/verify-install.sh` checks it, with that script
  and the maintainers' keys read from LND's repository at the release tag, never from the release:
  a source tarball that does not match the signed manifest, any maintainer signature gpg rejects,
  or fewer good signatures than LND requires (5) fails the release check, so the source is never
  extracted or built and the run is held. A signature gpg calls good but made by a key past its
  expiry counts toward LND's 5, as LND's script counts it, and never toward the good signatures
  the site shows. An LDK release has no release files to check, so its signed tag is what is
  checked: the tag's signature must be good by a key LDK's SECURITY.md lists both at the tag and
  at the release before it (fetched from keys.openpgp.org by that fingerprint), the tag must name
  itself and the commit checked out, and the working tree must be unchanged; otherwise nothing is
  built and the run is held. The lab does not check that a listed key is its holder's beyond
  SECURITY.md saying so, nor the crates' authors: the crates are resolved from crates.io at a
  release's first run, each checked by cargo against the index's SHA-256, and that lockfile is
  kept so every later run builds the same ones. An Eclair release is checked as its release notes
  say: `SHA256SUMS.asc` must be good by the key the notes name, which must be a key pinned in
  `eclair.ts` by full fingerprint, and the eclair-node zip must match the sums gpg says were
  signed; the commit inside that zip's jar must be the commit the tag names, checked out
  unchanged. Otherwise nothing is built and the run is held. The JDK and Maven it builds with are
  checked by pinned hashes, the publishers' own hash files and their signatures before they
  unpack; its Maven dependencies are checked against the repository's checksums at a release's
  first run and kept by SHA-256 after.
- **Embargoed means absent.** The finding is written only to `var/embargo/<id>.json` (directory
  700, files 600). It is not in `knowledge/`, the review queue, the run log (when a run held
  anything, its summary, reading list and open questions are withheld, and skipped statements
  that read as findings are always dropped), the feed, the site's public pages or Nostr. A failed
  lab run changes nothing public at all, not even a count.
- **The owner decides.** The daemon sends the embargo to the admin's private Security page with
  each project's reporting address and policy (security@bitcoincore.org always; LND, Core
  Lightning, Eclair, LDK and libsecp256k1 when named). A held LND lab run names LND alone
  (security@lightning.engineering, from LND's SECURITY.md at the release), since its release and
  its unit tests are LND's; a held LDK run names LDK alone (security@lightningdevkit.org, from
  LDK's SECURITY.md), for the same reason; a held Eclair run names Eclair alone
  (security@acinq.fr, from Eclair's SECURITY.md). One thing is tried before an Eclair group
  counts as failed: when every failure scalatest printed is a test timing out, the group runs once
  more, alone, and that attempt decides; the run's record keeps both attempts and the published
  test says why it ran twice. A failure of any other kind, or a timeout that repeats, is held. Only the owner releases (a research
  candidate then joins the ordinary review queue; a lab run publishes as it stands) or dismisses
  one, with a signed `embargo.decide` command; release asks the owner to confirm the project has
  published first. Each decision is kept in `var/embargo/closed.jsonl`.
- **The gate lifts only its own holds.** Each hour, after the watch has read what is public, the
  gate runs its rule again on every held research candidate (`liftHolds` in
  `brain/src/security/gate.ts`). One it would no longer hold, because an advisory, a threat's term,
  a CVE a published claim names or a disclosure source it now recognizes says what the candidate
  says, goes to the review queue marked lifted: the gate screens it again there, every time, and
  the evaluator rechecks it before two verifiers read it, which is more than a new candidate that
  passed the gate gets. A lab finding, and any candidate the rule still holds, waits for the owner.
  The lift is recorded in `closed.jsonl` as the gate's, and nothing public says it happened.
- **What it holds is the owner's.** The embargo reaches the site's Redis (`ctl:embargo`) only so
  the signed-in owner can read it, like the review queue (T6b).
- **The Nostr channel posts nothing the gate would hold** (ORANGECHECK.md, "The Nostr channel").
  Before a note is signed, `noteScreen` (`core/src/nostr.ts`, tested in `core/test/nostr.test.ts`)
  runs the disclosure gate again on every claim in it, and on the note's own words. It holds any
  note that names an embargoed item's id, an advisory id in it or a failing test's name, and every
  lab run with a failure. A digest drops the claims it holds and counts without them; any other
  note waits whole and the admin lists why. A claim the owner released passes.

## What Blocklore never does

No custody, no keys, no trading, no price prediction, no financial advice. No accounts for readers.
No email collection until the digest ships, and then only with double opt-in.
