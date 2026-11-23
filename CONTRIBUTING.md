# Contributing to Blocklore

Blocklore is only as good as its evidence, so the most useful help is pointing at evidence: a claim
that is wrong or stale, a better primary source, a question it cannot answer yet.

## Point out a problem with a claim

The quickest way is "Report a problem" on the claim's page: say whether it is wrong, out of date,
not what the source says, a broken link or unclear, and add a note if you like. No account is
needed. The brain rechecks a reported claim within the hour, and what it found is public on the
claim and at [/changes/corrections](https://blocklore.space/changes/corrections). Your note is read
only by the owner and the brain, never published.

When you have a better source, open an issue as well, with the claim's link
(`https://blocklore.space/claims/<id>`), the link to the source and a quote of at most 50 words
from it.

Please do not edit `knowledge/` by hand, even for a typo. Claims change only through the brain's
checks: the quote is found at the link by code, the revision keeps what the claim said before, and
the change is sealed in the next edition. A hand edit would skip all of that, so a pull request
that changes a claim is closed with a pointer to an issue instead. The issue is not lost: the
brain rechecks the claim, and when the evidence holds, the correction publishes as a revision with
its sources.

## Suggest a question

Ask at [/gaps](https://blocklore.space/gaps). It also shows what Blocklore does not cover yet, and
what readers asked for that it is researching now.

## Propose a source

Sources are tiered, from the primary record (BIPs, Bitcoin Core, the mailing list, the chain) to
expert summaries and community answers. [SOURCES.md](SOURCES.md) lists them and says what a
proposal needs: what it covers that the registry lacks, its tier and why, its license, how to
fetch it, and three example items.

## Run a mirror

A copy of Blocklore that anyone can reach keeps the record alive without its owner. [MIRROR.md](MIRROR.md)
shows how to run one in production from a fresh clone, with no keys, how to keep it current, and
how `pnpm mirror:check` proves it serves the same store as blocklore.space.

## Change the code

You need Node 24 and pnpm 10.

```sh
pnpm install
pnpm dev      # the site at http://localhost:3721, from your clone, no keys needed
pnpm lint     # biome, types, the style check and the store's validation
pnpm test     # core and brain
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) first, then the doc for the area you touch:
[CLAIMS.md](CLAIMS.md), [EDITORIAL.md](EDITORIAL.md) or [SECURITY.md](SECURITY.md). A few rules
the checks enforce, and a few they cannot:

- **No em dashes, en dashes or horizontal bars**, anywhere: docs, interface, code and generated
  text. Write ranges as "2 to 4". `node tools/style.ts` checks.
- **No hidden inputs in `core/src`.** No `Date.now()`, no `new Date()` without an argument and no
  randomness outside `core/src/node/`. Time and block heights come in as arguments, so the same
  store always compiles to the same result.
- **Readers' text is checked for secrets first.** Anything that accepts reader text runs
  `detectSecrets` before it reads, logs or keeps anything.
- **Models never publish.** No change may let a model write to `knowledge/` or decide what
  publishes. The instructions the models follow, in `brain/prompts/`, change only through a pull
  request the owner reviews with extra care.
- **Tests assert behavior.** A test that would still pass with the code removed proves nothing.
- **Commit messages lead with why**, in short sentences.

## Report a security problem

Privately, through GitHub's vulnerability reporting on this repository, as
[SECURITY.md](SECURITY.md) explains. Please do not open a public issue for it.

## How we talk

Argue with evidence, not with people. Contested questions in Bitcoin are real, and Blocklore keeps
every side attributed, dated and in its proponents' own words; issues and pull requests work the
same way. Personal attacks and harassment are removed.

## License of contributions

Code you contribute is licensed under [MIT](LICENSE). Evidence and wording that end up in the store
are licensed under [CC BY 4.0](knowledge/LICENSE), like the rest of it.
