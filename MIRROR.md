# Running a mirror

Blocklore is meant to outlive its owner. The store (`knowledge/`, CC BY 4.0) and the code (MIT)
are public, and the site, the API and the MCP server build from a clone with no account, key or
environment variable. A mirror is such a copy run in production: kept current from the public
repository, and able to prove it serves the same store as https://blocklore.space.

You need Linux, Node 24, pnpm 10, git, about 3 GB of disk for two clones, and outbound HTTPS (to
the npm registry when installing, and to mempool.space and blockstream.info for the chain tip on
the Pulse).

## Run one

A mirror keeps two clones side by side and serves one of them, so an update builds in the other
and never takes the site down:

```sh
mkdir ~/blocklore
git clone https://github.com/Xaxis/blocklore.space ~/blocklore/a
~/blocklore/a/tools/mirror-update.sh ~/blocklore     # installs, builds a, links ~/blocklore/current to it
cd ~/blocklore/current/web && pnpm exec next start --port 3721 --hostname 127.0.0.1
```

The update script runs `pnpm install --frozen-lockfile` and then `pnpm build`, which compiles
`knowledge/` into the site's bundle and prerenders every page (2 to 10 minutes, depending on the
machine). It builds with `BLOCKLORE_BUILD` set to the commit, so every page, every API answer's
`edition` and the MCP server name the commit they were built from. To build by hand instead:

```sh
pnpm install --frozen-lockfile
BLOCKLORE_BUILD=$(git rev-parse --short=7 HEAD) pnpm build
cd web && pnpm exec next start --port 3721 --hostname 127.0.0.1
```

A build without `BLOCKLORE_BUILD` calls itself `dev`, and the mirror check then cannot tell which
commit it serves. The server speaks plain HTTP; put a reverse proxy with TLS in front of it
(Caddy, nginx). It needs no `.env`, and none of the secrets in `.env.example`: those belong to the
owner's services.

Every address the site writes, each claim's `url`, the sitemap, the feeds and `llms.txt`, is
blocklore.space's, so readers and programs that cite from a mirror cite the original record, and a
mirror's answers are the same bytes as the origin's.

## Keep it current

`tools/mirror-update.sh ROOT [-- RESTART...]` fetches the upstream branch (the clone's
`origin/HEAD`, which is `main` on GitHub) into the clone the server is not using. When that is a
newer commit, it installs and builds it there, then points `ROOT/current` at it in one rename and
runs RESTART. A failed fetch, install or build leaves the served clone as it was, and a run with
nothing new to build only says so. The other clone is the script's own: local edits there are
discarded.

With systemd user units (run `loginctl enable-linger $USER` once, so they run without a login):

```ini
# ~/.config/systemd/user/blocklore-mirror.service
[Unit]
Description=Blocklore mirror
After=network-online.target

[Service]
WorkingDirectory=%h/blocklore/current/web
# PATH must reach node and pnpm.
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env pnpm exec next start --port 3721 --hostname 127.0.0.1
Restart=on-failure

[Install]
WantedBy=default.target
```

```ini
# ~/.config/systemd/user/blocklore-mirror-update.service
[Unit]
Description=Update the Blocklore mirror

[Service]
Type=oneshot
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/blocklore/current/tools/mirror-update.sh %h/blocklore -- systemctl --user restart blocklore-mirror.service
```

```ini
# ~/.config/systemd/user/blocklore-mirror-update.timer
[Unit]
Description=Update the Blocklore mirror every hour

[Timer]
OnCalendar=hourly
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now blocklore-mirror.service blocklore-mirror-update.timer
journalctl --user -u blocklore-mirror-update.service    # what each update did
```

With cron instead, give the line a PATH that reaches node and pnpm, and whatever restarts your
server:

```sh
0 * * * * PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin $HOME/blocklore/current/tools/mirror-update.sh $HOME/blocklore -- systemctl --user restart blocklore-mirror.service >>$HOME/blocklore/update.log 2>&1
```

The brain commits to `main` many times a day (new claims, rechecks, the feeds' wire, the security
watches), and the owner deploys at most every few hours unless claims changed, so a mirror that
follows `main` is often a little ahead of the origin, and that is fine.

## What a mirror serves, and what it leaves out

Everything that comes from the store works with no environment at all: every page (topics,
claims, the time machine, proposals and BIPs, changes and corrections, digests, the research log,
Security, Proof, progress), the read API, search, the export, `llms.txt` and `llms-full.txt`, the
feeds, the MCP server and its ten tools, the snapshot files with their proofs and signatures, and
the OrangeCheck records. The chain tip on the Pulse is read by the mirror's own server from two
explorers that must agree.

What needs the owner's services is left out, and each part fails closed and quietly: no error
page, no stack trace, nothing written. Checked on a production mirror built from a fresh clone with
an empty environment:

| Part | What it needs | On a mirror |
| --- | --- | --- |
| The admin (`/admin`, `/api/admin/*`) | the owner's address, Redis, mail | `/admin` sends to `/admin/login` (307); the form answers 403, since a sign-in is only taken on blocklore.space; every admin route answers 401 |
| The brain (research, rechecks, publishing, sealing, Nostr) | the owner's devbox | nothing runs; the mirror serves what the brain committed. `/api/control/sync` and `/api/control/link` answer 401; `/api/v1/brain` answers 200 with `{"online":false,"feed":null}`, and the Brain view says the brain is not reporting |
| Reader suggestions (`/api/v1/queue`) | Redis and `ASK_SALT` | 503 "Suggestions are not available right now."; the box on `/gaps` shows that, and lists no suggestions |
| Reader reports (`/api/v1/claims/<id>/reports`, `/api/v1/reports`) | Redis and `ASK_SALT` | 503 "Reports are not available right now."; a claim's page says its reports are not available rather than that there are none, and offers no form |
| The brain's pulls (`/api/v1/queue/pull`, `/api/v1/reports/pull`, their `status`) | `QUEUE_PULL_TOKEN` | 401 |
| Reach counts (`/progress/<month>`) | Redis | nothing is counted, and the month says the counts cannot be read |

Suggest a question and report a problem at https://blocklore.space; the brain reads only the
origin's queue.

Pages also load the owner's cookieless page counter (Overlook, named in `web/lib/site.ts`), so a
mirror's page views reach it under blocklore.space's site.

## Prove it is faithful

From a clone of the repository (`git fetch` first, so it knows the origin's newest commit):

```sh
pnpm mirror:check https://mirror.example.org                  # against https://blocklore.space
pnpm mirror:check http://127.0.0.1:3721 --origin https://blocklore.space --sample 50
```

It reads both sites and prints one line per check:

| Check | Compares |
| --- | --- |
| `edition` | the claim count, the store's own latest moment (the same commit always compiles to the same), the newest sealed edition and its Merkle root, and the build |
| `snapshots/<n>.json` | every sealed edition's file, byte for byte |
| `exports/claims.jsonl` | the whole export by SHA-256, and when it differs, every claim in it one by one, naming the ones that differ |
| `api/v1/claims` | a random sample of claims from the API (the seed is printed; `--seed` repeats a run), each by the hash it names and its content as served |
| `llms.txt` | byte for byte, with the first line that differs |
| `mcp initialize` | the MCP server's answer, which names its build |

Each line is `ok`, `behind`, `ahead` or `differs`. Behind is not a softer word for different: a
mirror is behind only when what it serves is exactly what the origin served earlier, an older
store or an older commit (git orders the two builds when the clone holds both), and a claim is
behind only when it says exactly what the origin's said at an earlier revision. A sealed snapshot
file is never rewritten, so a different file under the same number differs however far behind the
mirror is. The run exits 0 when every line is ok, 1 on any difference, 2 when the mirror is only
behind or only ahead, and 3 when the origin could not be read.

Every request carries `X-Blocklore-Check: 1`, so neither site counts the check as use. It sends
only GETs, and one POST of `initialize` to each MCP server.

The mirror check compares a mirror with the origin. To check the store itself against Bitcoin,
trusting no site at all, run `pnpm verify:snapshot` in your clone (README.md, "Verify it
yourself").
