# Blocklore and OrangeCheck

Status: proposed, waiting on the owner's answers to the questions at the end. Nothing here is built.

Blocklore already proves *what* it published and *when*: every claim's hash sits under a Merkle
root that OpenTimestamps anchors in a Bitcoin block (/verify). It cannot yet prove *who* stood
behind it. OrangeCheck fills that gap with Bitcoin keys instead of accounts: BIP-322 signed
envelopes (Stamp), statements about an identity (Attest), and delegated authority for software
agents (Agent), all verifiable offline and publishable on Nostr.

## Why it fits

- **The brain is an agent.** Research is done by models, but only deterministic code publishes.
  An OrangeCheck Agent delegation makes that boundary cryptographic: the owner's key delegates a
  narrow scope to the publisher's key, and every edition the publisher signs carries the chain of
  authority back to the owner.
- **The owner's review is the human gate.** Claims on contested questions, safety advice and named
  people wait for the owner. A Stamp on each approval batch turns "a person reviewed this" from a
  line in a log into a signature anyone can check.
- **Readers bring their own model.** An assistant reading Blocklore over MCP can verify the
  signatures itself, so it never has to trust the site that served the claims.

## The plan, in order

1. **A Stamp on every snapshot** (with `@orangecheck/stamp-core` and `stamp-ots`). Beside the
   OpenTimestamps proof, each snapshot root gets a Stamp v1 envelope signed by the publisher key.
   /verify shows it, and `npx @orangecheck/stamp-cli verify` checks it offline.
2. **The owner's identity, pinned to the domain.** One OrangeCheck attestation at
   `https://blocklore.space/.well-known/orangecheck.txt` (`dns:blocklore.space`) binds the owner's
   key to the site. Every other signature chains to it.
3. **Signed reviews.** When the owner approves or rejects a batch in the admin, the admin shows the
   batch digest and the owner signs it with a hardware wallet (BIP-322, paste the signature back).
   The claim's record then carries the Stamp, and the claim page says "reviewed by the owner,
   signed".
4. **The brain's agent identity.** An Agent v1 delegation from the owner's key to a publisher key
   on the devbox, scoped to `stamp:sign(mime=application/json)`, with an expiry and revocation
   (kind 30085). Only the deterministic publisher holds the key; the research and verifier models
   never see it.
5. **Publishing on Nostr.** Snapshot stamps (kind 30083), agent actions (kind 30084) and the
   attestation (kind 30078) on a few relays, so the record survives the site.
6. **Later:** outside reviewers attest to claims they checked, optional Bonds on the reader
   queue against spam, and `git-stamp` for releases of the code.

## What it shows a grant reviewer

- A public-good knowledge base whose every sentence is sourced, whose every edition is timestamped
  in Bitcoin, and whose every human decision is signed with a Bitcoin key.
- AI used where it helps (finding and drafting) and boxed where it must not act alone
  (publishing), with the boundary enforced by signatures rather than by policy.
- Two open protocols (OpenTimestamps and OrangeCheck) used together in production, MIT and CC BY.

## Questions for the owner

1. Which key is the root: a new key for Blocklore, or your existing OrangeCheck identity?
2. Do you sign reviews with a hardware wallet (paste flow), or accept a hot key on your machine?
3. May the publisher key live on the devbox, in `.env` like the other secrets?
4. Should the attestation be `dns:blocklore.space`, your personal identity, or both?
5. Which Nostr relays?
6. Pin package versions now (stamp-core 1.4.0, stamp-ots 0.7.0, bip322 1.1.3, agent-signer
   0.6.0) or follow the latest?
7. How visible should OrangeCheck be on the site: a quiet "signed" mark, or named and linked?
8. Back-sign the existing snapshots and the reviews already made, or start from the next edition?
