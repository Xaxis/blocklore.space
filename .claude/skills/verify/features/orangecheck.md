# Signing with OrangeCheck

Who stands behind each edition (ORANGECHECK.md): the publisher key on the devbox signs every snapshot with an OC Stamp and every evaluator decision as an OC Agent action; the owner's own Bitcoin key, attested for `dns:blocklore.space`, delegates to it from the admin and can revoke it there. Readers check all of it offline.

<!-- covers: page:/verify/keys, page:/admin/signing, api:GET /.well-known/orangecheck.txt, api:GET /orangecheck/[...path], cli:verify:orangecheck, cli:brain orangecheck -->

## Sub-features

- model (pure): `core/src/orangecheck.ts` builds every canonical message and id (stamp, attestation, delegation, action, revocation), turns pasted signatures into envelopes, checks them (`checkStamp`, `checkAttestation`, `checkDelegation`, `checkRevocation`, `checkRecords`), decides the chain (`authorityAt`: delegated, or alone with a plain reason), the edition signature in the bundle (`readEditionSignature`), the owner commands (`buildAuthorization`, `buildRevocation`, `ocSignatureProblem`), `/.well-known/orangecheck.txt` (`wellKnownText`) and the Nostr templates. `core/src/orangecheck-commands.ts` holds the command schemas the admin and daemon share.
- store: `knowledge/snapshots/<n>.json.stamp` and `knowledge/orangecheck/{attestations,delegations,revocations}/<id>.json` (file name is the id); `pnpm validate`/`bundle` report a record or stamp that does not check as an error. The bundle carries `snapshots[i].signature` and `orangecheck` (only records that check).
- key: `BLOCKLORE_PUBLISHER_KEY` in `.env`, made by `pnpm brain orangecheck keygen` (mode 600, prints only the address and Nostr key, refuses to replace a key). Model roles get `roleEnv` (brain/src/agent.ts), which never carries it.
- signing: `pnpm brain snapshot` signs each new edition (`signSnapshot`); `pnpm brain orangecheck backfill` signs older ones, labelled with the signing time; `stampJson(value)` / `verifyStampedJson(value, envelope)` are the evaluator's API.
- owner commands: `orangecheck.authorize`, `orangecheck.revoke` (core/src/control.ts `Command`), sent from `/admin/signing`; the command route checks the BIP-322 signatures first (`ocSignatureProblem`), the daemon runs them as jobs (`brain/src/jobs.ts` to `applyOrangecheck`): checks again, writes the records, commits as the owner, ships. Each writes a public feed event.
- Nostr: `pnpm brain orangecheck publish [--dry-run]` and the hourly tick's `nostr` step publish what two relays do not yet serve back (`var/orangecheck/published.json`), under a Nostr key derived from the publisher key; kinds 30078, 30083, 30084, 30085. A test run refuses to publish without its own sender.
- readers: `/verify` shows each edition's signature badge and row and the stamp file; `/verify/keys` the chain (owner key, delegation with status, publisher key, editions) with OrangeCheck's CLI commands and `pnpm verify:orangecheck`, listed in the sitemap and llms.txt; `/.well-known/orangecheck.txt` (404 before an attestation); `/orangecheck/<kind>/<id>.json` and `/orangecheck/revocations.json` serve the records as committed; `/snapshots/<n>.json.stamp` (`application/vnd.oc-stamp+json`); `/api/v1/snapshots` carries `signature`; MCP `get_signatures` ([mcp](mcp.md)).
- cli: `pnpm verify:orangecheck [n] [--offline] [--knowledge <dir>]` (`tools/verify-orangecheck.ts`) uses OrangeCheck's libraries only: the stamp against the file, every record, the domain proof (online), the chain; exit 1 on any failure, "signed alone" is a note.

## How to reach it

Never with a test key in the real `knowledge/`, never against public relays. Work in a scratch copy:

```sh
S=$SCRATCH/oc; rsync -a --exclude node_modules --exclude .next --exclude var --exclude .git --exclude web/.generated ./ $S/
cd $S && git init -q -b main && git add -- knowledge brain core web tools package.json pnpm-lock.yaml pnpm-workspace.yaml && git -c user.name=Xaxis -c user.email=william.neeley@gmail.com commit -qm base
git init -q --bare ../oc-remote.git && git remote add origin ../oc-remote.git && git push -q origin main
printf '#!/bin/sh\necho "scratch: no deploy"\n' > tools/deploy.sh   # ship() must never deploy from here
pnpm install --prefer-offline --frozen-lockfile
pnpm brain orangecheck keygen && pnpm brain orangecheck backfill && pnpm brain orangecheck status
```

Owner signatures: sign the text or id the admin shows with any key you hold for the address (`signMessage(address, text, key)` from `@orangecheck/bip322` plays the wallet). The site: `pnpm bundle`, then `next dev --port <yours>` in `$S/web`; the admin with the dev daemon from [admin](admin.md), run from `$S` with `BLOCKLORE_CONTROL_DIR=$SCRATCH/control`.

## How to check it

Static: `pnpm lint`; `pnpm test` (core/test/orangecheck.test.ts: the specs' signed vectors, every builder against stamp-core, agent-core and the SDK, the chain, revocations by owner, publisher and stranger, the quick check; brain/test/orangecheck.test.ts: keygen at mode 600 never printing the key, roleEnv without it, stampJson alone and delegated and after a revocation, NIP-01 events, the relays, publishing to a fake sender with a quorum of two).

Runtime, in the scratch copy:

```sh
node tools/verify-orangecheck.ts --offline; echo "exit $?"
(cd knowledge/snapshots && npx -y -p @orangecheck/stamp-cli@0.4.1 stamp verify 1.json.stamp 1.json)
(cd knowledge/orangecheck && npx -y -p @orangecheck/agent-cli@0.3.5 oc-agent verify delegations/*.json --revocations <(echo '[]'))
pnpm brain orangecheck publish --dry-run
B=http://localhost:<port>
for p in /.well-known/orangecheck.txt /snapshots/1.json.stamp /orangecheck/revocations.json /verify /verify/keys /api/v1/snapshots; do echo "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' $B$p) $p"; done
node .claude/skills/verify/mcpcheck.ts $B
```

Proves it when: before a delegation the verifier prints `ok` for the stamp and a `note` that the key signed alone, exit 0; after the owner's authorize (admin or `applyOrangecheck`) it prints `ok` for the attestation, the delegation and the chain, and once rebundled `/verify/keys` shows the delegation `in force` (never `not begun`: statuses are given as of the newest record, not only the store's moment); stamp-cli says `ok: true` with `content_checked: true`; agent-cli `OK · delegation verified` (after a revocation `REJECTED · E_REVOKED`, while `status` still says the owner stands behind editions signed before it); the dry run lists kinds 30078, 30083 and nothing is sent; the routes are 200 with `text/plain`, `application/vnd.oc-stamp+json`, `application/json`, `text/html`; mcpcheck lists eight tools and `get_signatures` covers every edition. In the admin, a pasted signature over the text without its last line break and a signature in the wrong box are both refused before sending, and the right ones end in "recorded and pushed" with a commit by Xaxis in the scratch repo.

## Gotchas

- `oc verify` (OrangeCheck's cli) on the attestation also reads the coins at the address: an empty address reports `sig_ok_bip322, bond_zero` and "invalid". The signature is `sig_ok_bip322`; the owner should attest an address that holds their OrangeCheck bond.
- The admin's records and the edition badges come from the deployed bundle, so they change after the daemon's ship, not when the command finishes.
- `ship()` runs `tools/deploy.sh`: in any scratch copy stub it first.
- A scratch copy needs `var/loop/` (the daemon's jobs take `var/loop/tick.lock`), or the admin's command fails with a flock error.
- The dev admin trusts only `http://localhost:3721` (web/lib/admin/auth.ts), so on another port the sign-in link points at the live site: add your origin in the scratch copy only.
- `core/package.json` has `"sideEffects": false`, which keeps the OrangeCheck libraries in the signing page's chunk alone. Check after a build: `grep -rl BIP0322-signed-message web/.next/static/chunks` should name one chunk, listed only in `admin/(console)/signing`'s client manifest.
