# The Nostr channel

The account people follow on Nostr (ORANGECHECK.md, "The Nostr channel"). It posts the daily digest as a NIP-23 article, a note for each edition sealed in a Bitcoin block, and the security watch's changes and passing lab runs. Code builds every note from published claims, under its own key, an HKDF sibling of the records key. It posts only while the owner's "Post to Nostr" switch in the admin is on, which it is not by default.

<!-- covers: api:GET /.well-known/nostr.json, cli:brain nostr, cli:nostrcheck -->

## Sub-features

- notes (pure): `core/src/nostr.ts`. `profileNote` (kind 0, `bot: true`, NIP-05 `_@blocklore.space`), `relayListNote` (10002), `digestArticle` (30023, `d` = the date, from the same `digestDays` call as `/digest/<date>`: corrections, then new claims by topic, then other revisions, each claim with `Claim:` and `Source:` links; 48 KB at most, the rest linked), `editionNote` (once the proof names a block), `watchChanges` and `watchNote` (a failed reading is no change), `labNote` (a failing run is held). `channelNotes` orders them and starts at 00:00 UTC the day before the switch went on. `npub` is NIP-19 by hand; `nip05Document` builds `/.well-known/nostr.json`.
- the screen: `noteScreen`. It drops a digest's claims that the disclosure gate would hold now (unless the owner released them), and holds any note that names what the embargo holds (`embargoNeedles` in `brain/src/nostr.ts`: ids, advisory ids, failing test names) or has a dash the house style refuses.
- key: `publisherFrom` (`brain/src/orangecheck.ts`) gives the `channel` key under HKDF label `nostr-channel-key/v1`, beside the records key's `nostr-service-key/v1` (`NOSTR_KEY_LABELS`).
- sending: `brain/src/nostr.ts`. `postPending` signs once, keeps every event in `var/nostr/published.json` (or `BLOCKLORE_NOSTR_DIR`), and resends the same event until two relays serve it back by id. It sends at most 10 an hour and nothing while the switch is off. `relayProblem` refuses relays outside this machine under node:test and in a daemon whose site is on this machine. The relays are `BLOCKLORE_NOSTR_RELAYS`, else OrangeCheck's.
- the switch: the `nostr.post` command (`core/src/control.ts`, `Settings.nostr`). The daemon saves it at once and queues the job (`brain/src/jobs.ts`). The job writes `knowledge/nostr.json` (`syncRecord`, committed as the owner on main), ships it, then posts. The hourly tick's `nostr channel` step does the same.
- the admin: `/admin/settings`, the Nostr section (`web/components/admin/NostrPanel.tsx`): the switch, the npub, the relays, the next notes exactly as they would go out (from `ctl:nostr`, which the daemon posts on sync; `GET /api/admin/poll?nostr=1`), what the screen holds and why, what went out lately, and "Send the waiting notes now".
- readers: `/.well-known/nostr.json` (force-static, any origin) from `knowledge/nostr.json`, with empty `names` until the first switch. "Follow on Nostr" on `/connect#nostr` and the "Follow it on Nostr" section of `/about` show only while posting is on (`followChannel` in `web/lib/data.ts`).
- cli: `pnpm brain nostr status` (key, switch, relays, counts); `pnpm brain nostr preview` (every next note as it would be signed; sends nothing).

## How to reach it

Never against a public relay, never with the devbox's key or `knowledge/`. Work in a scratch copy as in [orangecheck](orangecheck.md) (rsync without `.env`, `git init -b main`, a bare remote, `tools/deploy.sh` stubbed, `pnpm install`, `pnpm brain orangecheck keygen`, `mkdir -p var/loop`), with `web/.env.development.local` as in [admin](admin.md). Then, from the scratch copy, each in the background:

```sh
node brain/test/relay.ts 7461 $SCRATCH/relay-a.jsonl      # two relay stubs on 127.0.0.1
node brain/test/relay.ts 7462 $SCRATCH/relay-b.jsonl
pnpm bundle; rm -rf web/.next; (cd web && ./node_modules/.bin/next dev --port 3723)
# the dev daemon from admin.md, with BLOCKLORE_SITE=http://localhost:3723 and
# BLOCKLORE_NOSTR_RELAYS=ws://127.0.0.1:7461,ws://127.0.0.1:7462 added
```

`pnpm brain nostr status` and `pnpm brain nostr preview`, with the daemon's environment, show the key and the next notes and send nothing.

## How to check it

Static: `pnpm lint`; `pnpm test`. core/test/nostr.test.ts covers: the NIP-19 vector, NIP-05, the digest article's exact content and tags, claims the gate holds left out, the byte budget, which notes come due and when, watch changes, the screen. brain/test/nostr.test.ts runs against two relay stubs. It covers: the sibling key against an independent HKDF; nothing sent while off; one relay is not enough and two is published; a retry resends the same event id; every event the stubs got checked with node's sha256 and noble's schnorr; a refusing relay; public relays refused in a test; `nostr.post` saving the switch and queueing the job; old settings reading as off.

Runtime: three phases of the driver, with the stubs, the dev site and the dev daemon above. Before `readers` and before `off`, restart `next dev` (with `rm -rf web/.next`) and the dev daemon, as a deploy would. A running dev server keeps the old bundle on routes it compiled before, and its in-memory admin store forgets the daemon's views.

```sh
R="http://localhost:3723 $SCRATCH/relay-a.jsonl $SCRATCH/relay-b.jsonl"
heavy node .claude/skills/verify/nostrcheck.ts on $SCRATCH/nostr-shots $R
# restart the site and the daemon
heavy node .claude/skills/verify/nostrcheck.ts readers $SCRATCH/nostr-shots $R
# restart the site
heavy node .claude/skills/verify/nostrcheck.ts off $SCRATCH/nostr-shots $R
```

Proves it when every line of each phase says `ok` and each exits 0.

- `on`: the preview reached the admin; the switch is off by default, says Not posting and shows the npub; the preview starts with the profile and the relay list (and any article reads as it would go out); no relay heard a thing while it was off; the switch holds the choice while the brain applies it; the brain turned it on, recorded it and posted (the job says "now on two relays"); `knowledge/nostr.json` has posting on with two different keys; every event both stubs got has the right id and signature from the channel key; both got the same events; the admin lists them under "Sent lately".
- `readers`: `nostr.json` is JSON any origin may read and names the channel key for `_` and `blocklore` and another key for `records`, with two relays; every event checks against the key it names; `/connect` and `/about` show the Follow link to `nostr:<npub>`; turned off in the admin, the brain recorded it and sent nothing, and no relay heard more.
- `off`: `/connect` and `/about` no longer show the link, and the key still resolves.

On 2026-11-23 the store's channel began with the profile, the relay list and the lab run of 22 November (3 events on each stub). The scratch copy's `nostrChannelStep` with the switch backdated to 19 November also sent the seed day's article (47,319 bytes, 90 of 228 claims and a link to the rest) and edition 1; `node brain/test/relay.ts check <log> <key>` passed all 5 events. Look at `settings-off-desk-light.png`, `settings-on-desk-light.png` and `connect-follow-desk-light.png` in the out dir.

## Gotchas

- The preview starts at the day before now while the switch is off. So it lists yesterday's digest if the store changed yesterday, plus editions sealed and watch changes since then.
- `/.well-known/nostr.json` and the Follow link read the bundle, so they change after the job's ship and a deploy (in the scratch copy, after `pnpm bundle` and a restart of `next dev`), not when the switch flips.
- In `next dev`, a public page's first load reloads it once, and a screenshot taken before hydration makes React render the root again (Playwright's caret style is a hydration mismatch). The driver settles each page and retries such a race; a page that keeps reloading means a stale `web/.next` (verify.md).
- A production daemon refuses `ws://` relays and a development one refuses anything off this machine. The admin shows the refusal under the switch.
- `NOSTR_DOMAIN` in core must equal `OC_DOMAIN`. It is kept apart so the client bundle never pulls in the OrangeCheck libraries; a test pins the two equal.
