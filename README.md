# Blocklore

**The current, cited, verifiable state of Bitcoin knowledge: what is true, what is contested, what
changed, and how to check it yourself.**

Blocklore is a public, always-learning knowledge base about Bitcoin. Its atomic unit is the claim:
one statement with sources at exact locators, a short quote from each that code has found at the
link, and, where possible, a check against the chain or the code that anyone can repeat with their
own node or clone. Every claim is versioned, so every page has a changelog and the whole store can
be read as of any date or block height.

A research process on the owner's machine (the brain) reads the Bitcoin primaries (BIPs, Bitcoin
Core, the bitcoindev list, Delving Bitcoin, the chain) and expert summaries (Bitcoin Optech, Bitcoin
Stack Exchange, transcripts), writes candidate claims, tries to falsify them with a separate
verifier, and publishes what survives through deterministic code. Contested topics, safety advice
and anything about named people wait for human review.

- Site: https://blocklore.space
- How it works: [ARCHITECTURE.md](ARCHITECTURE.md)
- The claim format: [CLAIMS.md](CLAIMS.md)
- Where it reads: [SOURCES.md](SOURCES.md)
- How it writes and stays evenhanded: [EDITORIAL.md](EDITORIAL.md)
- Threat model: [SECURITY.md](SECURITY.md)
- For programs: [API.md](API.md)
- What is next: [BACKLOG.md](BACKLOG.md)

## Verify it yourself

The store is the YAML in `knowledge/`. Each published snapshot lists every claim's hash and a
Merkle root timestamped on Bitcoin with OpenTimestamps, with a script that recomputes it (planned in
M5; not built yet). Programs can read every claim through the [API](API.md).

## License

Not chosen yet.
