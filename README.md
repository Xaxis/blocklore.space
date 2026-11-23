# Blocklore

**A public library of Bitcoin facts that checks itself.** Every sentence carries its source and the
exact quote that supports it, every change is kept, and every edition is sealed in a Bitcoin block,
so you can check Blocklore instead of trusting it.

https://blocklore.space

## Why it exists

What is true about Bitcoin lives in places that are hard to read and easy to misquote: the BIPs,
Bitcoin Core's code and release notes, the bitcoindev mailing list, Delving Bitcoin and the chain
itself. Summaries go stale without saying so. More and more people ask an AI assistant instead,
and assistants state Bitcoin facts with confidence and no source.

Blocklore keeps one open record of what is known, what is contested and what changed, with the
evidence attached to each sentence. A person can read it. A program or an assistant can cite it.
Anyone can check it with their own clone and their own node.

## How it stays honest

- **Claims, not pages.** Every sentence a reader sees is a claim: one statement with its sources.
  Each source carries an exact quote of at most 50 words, and code finds that quote at the link
  before anything publishes. Code is cited at a commit, and numbers about the chain are checked
  against two explorers that must agree.
- **Models draft, code decides.** A research model reads the primary sources and drafts claims; a
  second model in a fresh context tries to prove each one wrong. Neither can publish. They write
  only into a staging folder outside the repository, and only deterministic code writes the store.
- **Closer checks where it matters.** Claims on contested questions, safety advice, positions and
  named people go to the evaluator. It rechecks every quote and chain fact, applies the editorial
  rules as code, and needs two verifiers on different models to accept. To prove those checks
  still work, it mixes in test claims with one thing made false, and it stops publishing if it
  catches too few. [Its record is public](https://blocklore.space/verify/evaluator).
- **Nothing is edited silently.** A change to a published claim is a new revision that keeps what
  it said before. Corrections are logged in public, and every claim is rechecked on a schedule.
- **Sealed in Bitcoin.** Each edition's Merkle root is timestamped with OpenTimestamps and signed
  with OrangeCheck, so anyone can prove what Blocklore said and when.
- **Evenhanded.** Facts and values are kept apart. A contested position is attributed, dated and
  quoted in its proponents' own words, and Blocklore never declares a winner on a question of
  values.

## The security watch

[Security](https://blocklore.space/security) maps 40 known ways Bitcoin can be attacked, across 8
layers from consensus to social engineering, with what defends against each. Seven watches read
the chain and the network every hour. Each week the newest Bitcoin Core release has its signatures
checked and its own attack tests run in a regtest lab. The watch is defensive only: it reads public
data, never probes a node or a person, and a disclosure gate keeps anything that might be an
undisclosed vulnerability out of public view.

## Use it

- **Read** at https://blocklore.space. Readers need no account, and nothing tracks them.
- **Ask your own AI.** Blocklore runs no model for readers. Connect your assistant to its MCP
  server instead, and its answers can cite claims:
  `claude mcp add --transport http blocklore https://blocklore.space/mcp`.
  [/connect](https://blocklore.space/connect) shows the setup for Claude, Cursor and VS Code.
- **Build on it.** The [API](API.md) needs no key. Every claim is in one file,
  `https://blocklore.space/exports/claims.jsonl`, and `/llms.txt` indexes the store for language models.
- **Follow it** with RSS (`/rss.xml`) or Atom (`/changes.xml`).
- **Ask for research.** Suggest a question at [/gaps](https://blocklore.space/gaps), which also
  shows what Blocklore does not cover yet.

## Verify it yourself

You need Node 24 and pnpm 10. No account, key or environment variable is needed.

```sh
git clone https://github.com/Xaxis/blocklore.space && cd blocklore.space
pnpm install
pnpm verify:snapshot                         # every claim's hash, the Merkle root, the Bitcoin timestamp
pnpm verify:orangecheck                      # each edition's signature, and who stood behind the key
pnpm brain check taproot.activation-height   # fetch one claim's sources again and find its quotes
```

Each month's work is counted from this public record at
[/progress](https://blocklore.space/progress): new claims, corrections, research runs, the
evaluator's decisions, sealed editions, lab runs, and how much programs and assistants used it.

`verify:snapshot` reads the block header from your own node when `bitcoin-cli` answers, and
otherwise from two block explorers that must agree. [/verify](https://blocklore.space/verify) explains each step.

## Run your own copy

```sh
pnpm dev    # the whole site, API and MCP server at http://localhost:3721, from your clone
```

The site, the API and the MCP server run from the store in your clone. The store is plain YAML in
`knowledge/`, under CC BY 4.0, so you can mirror it, fork it or build your own index on it.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). In short:

- Suggest a question at [/gaps](https://blocklore.space/gaps).
- Report a problem on any claim from its page: wrong, out of date, not what the source says, a
  broken link or unclear. No account is needed. The brain rechecks a reported claim within the
  hour, and the outcome is public on the claim and at [/changes/corrections](https://blocklore.space/changes/corrections).
- Point out a better source: open an issue, and link the claim.
- Propose a source for the registry ([SOURCES.md](SOURCES.md)) or a change to the code as a pull request.
- Report a security problem privately, as [SECURITY.md](SECURITY.md) explains.

## What Blocklore never does

It holds no one's bitcoin, keys or accounts. It does not trade, predict prices or give financial
advice. It never asks for seeds, keys, xpubs or addresses, and it refuses a search or a suggestion
that looks like it holds one. It shows no ads, does no tracking and charges no one: the site, the API, the export, MCP and the
feeds are free for people and programs, with no account.

## How it is built

- How it works: [ARCHITECTURE.md](ARCHITECTURE.md)
- The claim format: [CLAIMS.md](CLAIMS.md)
- Where it reads: [SOURCES.md](SOURCES.md)
- How it writes, decides and stays evenhanded: [EDITORIAL.md](EDITORIAL.md)
- Signatures: [ORANGECHECK.md](ORANGECHECK.md)
- Threat model: [SECURITY.md](SECURITY.md)
- For programs: [API.md](API.md)
- What is next: [BACKLOG.md](BACKLOG.md)

The code is TypeScript: `core/` is the pure model, `brain/` the research and checking processes,
`web/` the site, API and MCP server. `pnpm lint` and `pnpm test` run every check.

## License

The code is [MIT](LICENSE), the same license as Bitcoin Core. The knowledge store in `knowledge/` is
[CC BY 4.0](knowledge/LICENSE): reuse it for anything, crediting Blocklore and linking each claim.
The short quotes inside sources stay their authors' and are included as citations.
