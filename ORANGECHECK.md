# Blocklore and OrangeCheck

Status: built 2026-11-21. The owner said to go ahead without answering the eight questions, so the
defaults below stand until the owner changes one. Nothing is signed for real until the publisher
key is made on the devbox (`pnpm brain orangecheck keygen`), and no signature is the owner's until
the owner delegates in the admin.

Blocklore already proves *what* it published and *when*: every claim's hash sits under a Merkle
root that OpenTimestamps anchors in a Bitcoin block (/verify). OrangeCheck adds *who* stands behind
it, with Bitcoin keys instead of accounts: BIP-322 signed envelopes (Stamp), statements about an
identity (Attest), and delegated authority for software agents (Agent), all checkable offline and
published on Nostr.

## The chain of authority

1. **The owner's Bitcoin key**, attested for `dns:blocklore.space`. The owner signs OrangeCheck's
   canonical attestation in their own wallet. `/.well-known/orangecheck.txt` names it, which is
   how OrangeCheck ties a key to a domain.
2. **A delegation** (OC Agent v1) from the owner's key to the publisher key, scope
   `stamp:sign(mime=application/json)`, for a year at most. It starts at the publisher key's first
   signature when that is recent, so editions signed after the fact are covered, and the admin
   says so.
3. **The publisher key**, a P2WPKH key in the devbox's `.env`. It signs:
   - every edition: an OC Stamp over the snapshot file's exact bytes, `knowledge/snapshots/<n>.json.stamp`;
   - every evaluator decision: an OC Agent action that names the delegation (`stampJson` in
     `brain/src/orangecheck.ts`). Before a delegation, or after a revocation, the same call makes a
     plain stamp and says the key signed alone. The envelope covers the decision line exactly as
     `var/evaluator/decisions.jsonl` keeps it and sits beside it in `signatures.jsonl`; each batch
     puts the envelopes on Nostr (its own log, `var/evaluator/published.json`). A decision holds
     unpublished text, so only its hash leaves the devbox.
4. **Revocation.** The evaluator publishes in place of a manual review, and the owner's veto is
   revoking the delegation: a signature from their wallet, pasted in the admin. What the key
   signed before the revocation still counts; nothing after does. The checks also accept a
   revocation signed by the publisher key itself (OC Agent section 9.5).

A signature proves that whoever holds the publisher key signed these exact bytes, and while the
owner's delegation is in force, that the owner's own Bitcoin key stood behind that key. The time
in a signature is the signer's own statement; the OpenTimestamps proof is what fixes it on
Bitcoin. A signature does not make a claim true.

## Where things are

| Piece | Where |
|---|---|
| Messages, envelopes, checks, the chain (pure) | `core/src/orangecheck.ts`, `core/src/orangecheck-commands.ts` |
| The key, signing, the owner's commands, Nostr | `brain/src/orangecheck.ts`, `pnpm brain orangecheck <keygen, status, backfill, publish>` |
| The owner's records (public) | `knowledge/orangecheck/{attestations,delegations,revocations}/<id>.json` |
| Each edition's signature | `knowledge/snapshots/<n>.json.stamp`, in the bundle as `snapshots[i].signature` |
| Readers | `/verify` (each edition), `/verify/keys` (the chain, offline commands), `/.well-known/orangecheck.txt`, `/orangecheck/...` (the records as committed), `/api/v1/snapshots`, the MCP tool `get_signatures` |
| The owner | `/admin/signing`: attest, delegate, revoke, by paste |
| The Nostr channel people follow | `core/src/nostr.ts` (the notes, pure), `brain/src/nostr.ts` (sending), `knowledge/nostr.json`, `/.well-known/nostr.json`, `/connect#nostr`, the switch in `/admin/settings` |
| Check it all | `pnpm verify:orangecheck [n]`, with OrangeCheck's libraries only |

Snapshots are signed by `pnpm brain snapshot` as they are taken; `pnpm brain orangecheck backfill`
signs the ones taken before the key existed, labelled with the time of signing. The hourly tick
publishes what is not yet on two relays (`nostr` step); `var/orangecheck/published.json` keeps the
log. Nostr events are signed by a key derived from the publisher key (HKDF, never the key itself).
Test keys never reach a relay: a test run refuses to publish unless it brings its own sender.

## The Nostr channel

The records above are for software that checks Blocklore. The channel is for people: a Nostr
account anyone can follow, which posts what Blocklore learns. Code builds every note from the store
and the bundle (`core/src/nostr.ts`); no model writes any of it.

| Kind | What | When |
|---|---|---|
| 0 | The profile: name, about, `https://blocklore.space`, NIP-05 `_@blocklore.space`, `bot: true` | first, and again when it changes |
| 10002 | The relay list (NIP-65) | first, and again when it changes |
| 30023 | The day's digest as a NIP-23 article, `d` = the date: corrections first, then new claims by topic, then other revisions, each with its statement, its link and its sources' links, from the same data as `/digest/<date>` | once the day is over |
| 1 | An edition sealed in a Bitcoin block, with the snapshot's link | once OpenTimestamps shows the block |
| 1 | A security watch going from one state to another (a failed reading is no change) | as the watch reads it |
| 1 | A lab run that passed (one that failed never goes out: it may be a finding) | after the run |

**The key: a sibling, not the records key.** The channel signs with its own key, derived from the
publisher key by HKDF-SHA256 (salt `blocklore`) under the label `nostr-channel-key/v1`; the records
key keeps `nostr-service-key/v1` (`NOSTR_KEY_LABELS` in `brain/src/orangecheck.ts`). Why:

- *Each key has one job.* OrangeCheck checkers fetch records by their author's key. Digests and
  notes under the same key would be noise to them, and a stream of signed envelopes would be noise
  to a person who follows the account.
- *The channel can change without touching the records.* A public account may get muted or
  spam-filtered, or need a new key. Changing the label (`/v2`) gives it one, while every record
  checker keeps the key it already knows.
- *There is no new secret.* Both keys come from the one publisher key in `.env`. `keygen` and its
  backup cover both, so nothing new can leak or get lost.
- *Each key is a dead end.* One derived key reveals nothing about the other or about the publisher
  key.
- *Both are tied to the domain.* `/.well-known/nostr.json` names the channel key for `_` and
  `blocklore` and the records key for `records`, each with its relays.

**The owner's switch.** "Post to Nostr" in `/admin/settings` is off by default. It is a signed
`nostr.post` command. The daemon saves the switch at once and queues the job, which writes
`knowledge/nostr.json` (the public record that NIP-05 and the site's Follow link read), ships it,
then sends what waits. While the switch is off nothing new is sent, and the OrangeCheck records keep
publishing as before. The channel starts at 00:00 UTC on the day before the owner turned it on, so
the first post is a day's worth, not the store's whole history. Under the switch the admin shows
exactly the notes that would go out next, in order, and what the screen holds back.

**The screen.** Before anything is signed, `noteScreen` holds:

- every claim the disclosure gate would hold now (`core/src/disclosure.ts`), unless the owner
  released it;
- every note that names what the embargo holds: its ids, the advisory ids in it, and the names of
  failing tests;
- every note with a dash that the house style refuses.

A digest drops the claims it holds and counts without them. Other notes wait whole. The admin lists
what is held and why.

**Published means two relays.** Each event is signed once and kept, with the relays that served it
back, in `var/nostr/published.json`. A note counts as published once two relays return it by its id
(each asked alone, signature checked). Until then the hourly tick (`nostr channel` step) sends the
same event again, at most 10 notes an hour, so a follower never sees a note twice. An article fits
in 48 KB; a long day lists whole claims up to that and links the rest. The relays are OrangeCheck's
(question 5), or `BLOCKLORE_NOSTR_RELAYS`.

**Never from a test or a development box.** `relayProblem` refuses any relay outside this machine
while node:test runs, and in a daemon whose site is on this machine. Production posts only to
`wss://` relays. `brain/test/relay.ts` is a local relay stub for the tests and the drive.

`pnpm brain nostr status` shows the key, the switch and the counts. `pnpm brain nostr preview`
prints the next notes exactly as they would go out, and sends nothing.

## The defaults (the eight questions)

1. **Root:** the owner's own Bitcoin identity (an existing OrangeCheck address), supplied in the
   admin. Until then the publisher key signs alone and the site says so.
2. **Owner signatures:** the paste flow, any BIP-322 wallet, hardware included. No owner key on
   the machine.
3. **Publisher key:** on the devbox in `.env` (mode 600), made by `keygen`, which never prints it.
   Only deterministic code holds it; model roles run with `roleEnv`, which never carries it.
4. **Attestation identity:** `dns:blocklore.space`.
5. **Relays:** OrangeCheck's defaults: nos.lol, relay.primal.net, nostr.mom, nostr.oxtr.dev,
   relay.ochk.io. A record counts as published when two relays serve it back.
6. **Versions:** pinned exactly: stamp-core 1.4.0, agent-core 2.10.0, bip322 1.1.3, sdk 1.26.2,
   nostr-core 0.8.3; readers' commands pin stamp-cli 0.4.1, agent-cli 0.3.5 and cli 0.5.6.
7. **Visibility:** named and linked, "Signed with OrangeCheck", in the Proof mode.
8. **Back-signing:** existing snapshots are signed after the fact and labelled with the signing
   time. The OpenTimestamps proofs still date them.

## Later

Outside reviewers attesting to claims they checked, optional Bonds on the reader queue against
spam, `git-stamp` for releases of the code, and anchoring stamp ids with `stamp-ots`.
